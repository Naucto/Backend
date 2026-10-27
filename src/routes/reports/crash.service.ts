import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrashSource, Prisma, ReportStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { summarizeUserAgent } from '../analytics/request-context';
import { crashGroupKey } from './crash-group';
import { CRASH_MILESTONES, CrashNoticeKind, CrashNotifier } from './crash-notifier';
import { scrubMessage, scrubRoute, scrubStack } from './crash-scrub';
import {
  CRASH_MESSAGE_MAX_LENGTH,
  CRASH_NAME_MAX_LENGTH,
  CRASH_STACK_MAX_LENGTH,
} from './dto/crash-report.dto';
import { StackResolver } from './stack-resolver';

/** The occurrences kept per crash. The count goes on past them. */
export const CRASH_OCCURRENCES_KEPT = 20;

/**
 * New crashes opened per hour from browser reports. The ingest is public, so a message changed a
 * little on each report would otherwise open a report each time. Counted in memory, which holds
 * while the backend runs as one instance.
 */
export const CRASH_NEW_PER_HOUR = 100;

/** A resolved or ignored crash is deleted once it has not happened for this long. */
export const CRASH_CLOSED_RETENTION_DAYS = 90;
/** A new crash seen only once is deleted once it has not happened again for this long. */
export const CRASH_SINGLE_RETENTION_DAYS = 30;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const UNIQUE_VIOLATION = 'P2002';

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

interface CountedCrash {
  id: number;
  count: number;
  notice: CrashNoticeKind | null;
}

/** Keeps one report per crash, by its message, with the latest occurrences of each. */
@Injectable()
export class CrashService {
  private readonly logger = new Logger(CrashService.name);
  private openedAt: number[] = [];
  private refusing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: CrashNotifier,
    private readonly stacks: StackResolver,
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
    const name = input.name.slice(0, CRASH_NAME_MAX_LENGTH) || 'Error';
    const message = scrubMessage(input.message).slice(0, CRASH_MESSAGE_MAX_LENGTH);
    const route = scrubRoute(input.route);
    const groupKey = crashGroupKey(input.source, name, message);
    const now = new Date();

    if (input.source !== 'BACKEND' && !(await this.mayOpen(groupKey, now.getTime()))) {
      return;
    }
    const scrubbed = scrubStack(input.stack);
    const stack = (
      input.source === 'BACKEND' ? scrubbed : await this.stacks.resolve(scrubbed)
    ).slice(0, CRASH_STACK_MAX_LENGTH);
    const appRelease = input.appRelease ?? null;

    const crash = await this.count(groupKey, {
      source: input.source,
      name,
      message,
      stack,
      appRelease,
      now,
    });

    const userAgent = input.userAgent ? summarizeUserAgent(input.userAgent) : null;
    await this.prisma.reportOccurrence.create({
      data: {
        reportId: crash.id,
        createdAt: now,
        route,
        stack,
        appRelease,
        device: userAgent?.device ?? null,
        browser: userAgent?.browser ?? null,
        os: userAgent?.os ?? null,
        ...(input.extra ? { extra: input.extra } : {}),
      },
    });
    await this.prune(crash.id);

    if (crash.notice) {
      void this.notifier.notify({
        kind: crash.notice,
        reportId: crash.id,
        source: input.source,
        name,
        message,
        stack,
        route,
        count: crash.count,
        appRelease,
      });
    }
  }

  /** Deletes the crashes nobody needs any more, with their occurrences. */
  @Cron('0 45 2 * * *', { timeZone: 'UTC' })
  async purgeStale(now = new Date()): Promise<void> {
    try {
      const { count } = await this.prisma.report.deleteMany({
        where: {
          kind: 'CRASH',
          OR: [
            {
              status: { in: ['RESOLVED', 'IGNORED'] },
              lastSeen: { lt: new Date(now.getTime() - CRASH_CLOSED_RETENTION_DAYS * DAY_MS) },
            },
            {
              status: 'NEW',
              count: 1,
              lastSeen: { lt: new Date(now.getTime() - CRASH_SINGLE_RETENTION_DAYS * DAY_MS) },
            },
          ],
        },
      });
      if (count > 0) {
        this.logger.log(`Deleted ${String(count)} stale crash reports`);
      }
    } catch (error) {
      this.logger.warn(`Crash purge stopped: ${String(error)}`);
    }
  }

  /** Whether a report may count: always into a known crash, into a new one within the budget. */
  private async mayOpen(groupKey: string, now: number): Promise<boolean> {
    const known = await this.prisma.report.findUnique({
      where: { kind_groupKey: { kind: 'CRASH', groupKey } },
      select: { id: true },
    });
    if (known) {
      return true;
    }
    this.openedAt = this.openedAt.filter((at) => now - at < HOUR_MS);
    if (this.openedAt.length < CRASH_NEW_PER_HOUR) {
      this.openedAt.push(now);
      this.refusing = false;
      return true;
    }
    if (!this.refusing) {
      this.refusing = true;
      this.logger.warn(
        `More than ${String(CRASH_NEW_PER_HOUR)} new crashes in an hour, new ones are dropped`,
      );
    }
    return false;
  }

  private async count(
    groupKey: string,
    fields: {
      source: CrashSource;
      name: string;
      message: string;
      stack: string;
      appRelease: string | null;
      now: Date;
    },
  ): Promise<CountedCrash> {
    const upsert = (): Promise<{ id: number; status: ReportStatus; count: number }> =>
      this.prisma.report.upsert({
        where: { kind_groupKey: { kind: 'CRASH', groupKey } },
        create: {
          kind: 'CRASH',
          groupKey,
          source: fields.source,
          title: fields.name,
          message: fields.message,
          stack: fields.stack,
          appRelease: fields.appRelease,
          createdAt: fields.now,
          lastSeen: fields.now,
        },
        update: {
          count: { increment: 1 },
          message: fields.message,
          stack: fields.stack,
          appRelease: fields.appRelease,
          lastSeen: fields.now,
        },
        select: { id: true, status: true, count: true },
      });

    let crash: { id: number; status: ReportStatus; count: number };
    try {
      crash = await upsert();
    } catch (error) {
      // Two first reports of a crash raced to create it, and the loser now finds it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        crash = await upsert();
      } else {
        throw error;
      }
    }

    const counted = { id: crash.id, count: crash.count };
    if (crash.status === 'RESOLVED') {
      const reopened = await this.prisma.report.updateMany({
        where: { id: crash.id, status: 'RESOLVED' },
        data: { status: 'NEW', regressedAt: fields.now },
      });
      return { ...counted, notice: reopened.count > 0 ? 'regressed' : null };
    }
    if (crash.status === 'IGNORED') {
      return { ...counted, notice: null };
    }
    if (crash.count === 1) {
      return { ...counted, notice: 'new' };
    }
    return { ...counted, notice: CRASH_MILESTONES.has(crash.count) ? 'milestone' : null };
  }

  private async prune(reportId: number): Promise<void> {
    const stale = await this.prisma.reportOccurrence.findMany({
      where: { reportId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: CRASH_OCCURRENCES_KEPT,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.reportOccurrence.deleteMany({
        where: { id: { in: stale.map((occurrence) => occurrence.id) } },
      });
    }
  }
}
