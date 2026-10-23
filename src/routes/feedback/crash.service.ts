import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrashSource, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { summarizeUserAgent } from '../analytics/request-context';
import { FeaturesService } from '../features/features.service';
import { crashFingerprint } from './crash-fingerprint';
import { CRASH_MILESTONES, CrashNoticeKind, CrashNotifier } from './crash-notifier';
import { scrubMessage, scrubRoute, scrubStack } from './crash-scrub';
import {
  CRASH_MESSAGE_MAX_LENGTH,
  CRASH_NAME_MAX_LENGTH,
  CRASH_STACK_MAX_LENGTH,
} from './dto/crash-report.dto';

/** The occurrences kept per group. The count goes on past them. */
export const CRASH_EVENTS_KEPT = 20;

/**
 * New groups opened per hour from browser reports. The ingest is public, so a message changed a
 * little on each report would otherwise open a group each time. Counted in memory, which holds
 * while the backend runs as one instance.
 */
export const CRASH_NEW_GROUPS_PER_HOUR = 100;

/** A resolved or ignored group is deleted once it has not happened for this long. */
export const CRASH_CLOSED_RETENTION_DAYS = 90;
/** An open group seen only once is deleted once it has not happened again for this long. */
export const CRASH_SINGLE_RETENTION_DAYS = 30;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface CrashInput {
  source: CrashSource;
  name: string;
  message: string;
  stack: string;
  route: string;
  appRelease?: string | undefined;
  userAgent?: string | undefined;
  extra?: Prisma.InputJsonObject | undefined;
}

const UNIQUE_VIOLATION = 'P2002';

/** Groups crashes by fingerprint and keeps the latest occurrences of each. */
@Injectable()
export class CrashService {
  private readonly logger = new Logger(CrashService.name);
  private openedAt: number[] = [];
  private refusing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly notifier: CrashNotifier,
  ) {}

  /** Records a crash, logging rather than throwing: reporting one failure must not cause another. */
  async recordSafely(input: CrashInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.warn(
        `Could not record a ${input.source} crash: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async record(input: CrashInput): Promise<void> {
    if (!this.features.features.feedback) {
      return;
    }
    const name = input.name.slice(0, CRASH_NAME_MAX_LENGTH) || 'Error';
    const message = scrubMessage(input.message).slice(0, CRASH_MESSAGE_MAX_LENGTH);
    const stack = scrubStack(input.stack).slice(0, CRASH_STACK_MAX_LENGTH);
    const route = scrubRoute(input.route);
    const fingerprint = crashFingerprint(input.source, name, message, stack);
    const now = new Date();

    if (input.source !== 'BACKEND' && !(await this.mayOpen(fingerprint, now.getTime()))) {
      return;
    }

    const group = await this.upsertGroup(fingerprint, {
      source: input.source,
      name,
      message,
      stack,
      appRelease: input.appRelease ?? null,
      now,
    });

    const userAgent = input.userAgent ? summarizeUserAgent(input.userAgent) : null;
    await this.prisma.crashEvent.create({
      data: {
        groupId: group.id,
        createdAt: now,
        route,
        stack,
        appRelease: input.appRelease ?? null,
        device: userAgent?.device ?? null,
        browser: userAgent?.browser ?? null,
        os: userAgent?.os ?? null,
        ...(input.extra ? { extra: input.extra } : {}),
      },
    });
    await this.prune(group.id);

    if (group.notice) {
      void this.notifier.notify({
        kind: group.notice,
        groupId: group.id,
        source: input.source,
        name,
        message,
        stack,
        route,
        count: group.count,
        appRelease: input.appRelease ?? null,
      });
    }
  }

  /** Deletes the groups nobody needs any more, with their occurrences. */
  @Cron('0 45 2 * * *', { timeZone: 'UTC' })
  async purgeStale(now = new Date()): Promise<void> {
    try {
      const { count } = await this.prisma.crashGroup.deleteMany({
        where: {
          OR: [
            {
              status: { in: ['RESOLVED', 'IGNORED'] },
              lastSeen: { lt: new Date(now.getTime() - CRASH_CLOSED_RETENTION_DAYS * DAY_MS) },
            },
            {
              status: 'OPEN',
              count: 1,
              lastSeen: { lt: new Date(now.getTime() - CRASH_SINGLE_RETENTION_DAYS * DAY_MS) },
            },
          ],
        },
      });
      if (count > 0) {
        this.logger.log(`Deleted ${String(count)} stale crash groups`);
      }
    } catch (error) {
      this.logger.warn(`Crash purge stopped: ${String(error)}`);
    }
  }

  /** Whether a report may count: always into a known group, into a new one within the budget. */
  private async mayOpen(fingerprint: string, now: number): Promise<boolean> {
    const known = await this.prisma.crashGroup.findUnique({
      where: { fingerprint },
      select: { id: true },
    });
    if (known) {
      return true;
    }
    this.openedAt = this.openedAt.filter((at) => now - at < HOUR_MS);
    if (this.openedAt.length < CRASH_NEW_GROUPS_PER_HOUR) {
      this.openedAt.push(now);
      this.refusing = false;
      return true;
    }
    if (!this.refusing) {
      this.refusing = true;
      this.logger.warn(
        `More than ${String(CRASH_NEW_GROUPS_PER_HOUR)} new crashes in an hour, new ones are dropped`,
      );
    }
    return false;
  }

  private async upsertGroup(
    fingerprint: string,
    fields: {
      source: CrashSource;
      name: string;
      message: string;
      stack: string;
      appRelease: string | null;
      now: Date;
    },
  ): Promise<{ id: number; count: number; notice: CrashNoticeKind | null }> {
    const upsert = (): Promise<{ id: number; status: string; count: number }> =>
      this.prisma.crashGroup.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          source: fields.source,
          name: fields.name,
          message: fields.message,
          lastStack: fields.stack,
          lastRelease: fields.appRelease,
          firstSeen: fields.now,
          lastSeen: fields.now,
        },
        update: {
          count: { increment: 1 },
          message: fields.message,
          lastStack: fields.stack,
          lastRelease: fields.appRelease,
          lastSeen: fields.now,
        },
        select: { id: true, status: true, count: true },
      });

    let group: { id: number; status: string; count: number };
    try {
      group = await upsert();
    } catch (error) {
      // Two first reports of a crash raced to create its group, and the loser now finds it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        group = await upsert();
      } else {
        throw error;
      }
    }

    const counted = { id: group.id, count: group.count };
    if (group.status === 'RESOLVED') {
      const reopened = await this.prisma.crashGroup.updateMany({
        where: { id: group.id, status: 'RESOLVED' },
        data: { status: 'OPEN', regressedAt: fields.now },
      });
      return { ...counted, notice: reopened.count > 0 ? 'regressed' : null };
    }
    if (group.status === 'IGNORED') {
      return { ...counted, notice: null };
    }
    if (group.count === 1) {
      return { ...counted, notice: 'new' };
    }
    return { ...counted, notice: CRASH_MILESTONES.has(group.count) ? 'milestone' : null };
  }

  private async prune(groupId: number): Promise<void> {
    const stale = await this.prisma.crashEvent.findMany({
      where: { groupId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: CRASH_EVENTS_KEPT,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.crashEvent.deleteMany({
        where: { id: { in: stale.map((event) => event.id) } },
      });
    }
  }
}
