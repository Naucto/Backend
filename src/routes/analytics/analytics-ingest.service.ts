import { Injectable } from '@nestjs/common';
import { AnalyticsLiveState, Prisma } from '@prisma/client';

import { getOptionalEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { AnalyticsTallyService } from './analytics-tally.service';
import {
  MAX_EVENT_AGE_MS,
  minuteOfDay,
  minuteStart,
  PROGRESS_SLACK_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  utcDay,
  VISITOR_COOKIE_MS,
} from './analytics-time';
import {
  AnalyticsBeatDto,
  AnalyticsContextDto,
  AnalyticsEventsDto,
  AnalyticsIdentityDto,
  AnalyticsPingDto,
  AnalyticsPlayDto,
  AnalyticsPlayReportDto,
  PlayEndReason,
} from './dto/analytics-ingest.dto';
import {
  AnalyticsEventsResponseDto,
  AnalyticsLinkResponseDto,
  AnalyticsPlayResponseDto,
  AnalyticsRotationDto,
} from './dto/analytics-ingest-response.dto';
import { GeoIpService } from './geo-ip.service';
import { lockAccount, lockPurgeGate, lockVisitors } from './identity-locks';
import { PublishedReleasesService } from './published-releases.service';
import {
  isBotUserAgent,
  primaryLanguage,
  referrerDomain,
  sanitizeUtm,
  screenBucket,
  summarizeUserAgent,
} from './request-context';

/** What analytics reads of the request itself, beyond its body. */
export interface IngestRequest {
  userAgent: string | undefined;
  ip: string | undefined;
  acceptLanguage: string | undefined;
}

type SessionCheck = 'ok' | 'rotateVisitor' | 'rotateSession';

const PROCEED: AnalyticsRotationDto = {
  rotateVisitor: false,
  rotateSession: false,
  disabled: false,
};
const DISABLED: AnalyticsRotationDto = {
  rotateVisitor: false,
  rotateSession: false,
  disabled: true,
};

const rotationFor = (check: SessionCheck): AnalyticsRotationDto => ({
  rotateVisitor: check === 'rotateVisitor',
  rotateSession: check !== 'ok',
  disabled: false,
});

/**
 * Stores what browsers report. Consented reports run in one transaction under the visitor's
 * shared identity lock, so an erasure holding it exclusively can never be undone by them.
 */
@Injectable()
export class AnalyticsIngestService {
  private readonly frontendUrl = getOptionalEnv('FRONTEND_URL', 'http://localhost:3001');

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly geo: GeoIpService,
    private readonly releases: PublishedReleasesService,
    private readonly tally: AnalyticsTallyService,
  ) {}

  /** Whether a request is to be stored at all: analytics on, and not a bot. */
  private admits(request: IngestRequest): boolean {
    return this.features.features.analytics && !isBotUserAgent(request.userAgent);
  }

  async recordEvents(
    dto: AnalyticsEventsDto,
    request: IngestRequest,
    now = new Date(),
  ): Promise<AnalyticsEventsResponseDto> {
    if (!this.features.features.analytics) {
      return { ...DISABLED, accepted: [], rejected: [] };
    }
    if (isBotUserAgent(request.userAgent)) {
      return { ...PROCEED, accepted: [], rejected: [] };
    }

    const fresh = dto.events.filter((event) => event.ageMs <= MAX_EVENT_AGE_MS);
    const rejected = dto.events
      .filter((event) => event.ageMs > MAX_EVENT_AGE_MS)
      .map((event) => ({ eventId: event.eventId, reason: 'too_old' as const }));

    const check = await this.inSession(dto, request, now, dto.context, async (tx) => {
      if (fresh.length === 0) {
        return;
      }
      const inserted = await tx.analyticsPageView.createManyAndReturn({
        data: fresh.map((event) => ({
          id: event.eventId,
          sessionId: dto.sessionId,
          occurredAt: new Date(now.getTime() - event.ageMs),
          route: event.route,
        })),
        skipDuplicates: true,
        select: { occurredAt: true },
      });
      // Only the rows this attempt inserted count, so a retried batch adds nothing twice.
      for (const view of inserted) {
        await touchSessionDay(tx, dto.sessionId, view.occurredAt, { pageViews: 1 });
      }
    });

    if (check !== 'ok') {
      return { ...rotationFor(check), accepted: [], rejected: [] };
    }
    this.tally.count('accepted', now, fresh.length);
    this.tally.count('rejected', now, rejected.length);
    return { ...PROCEED, accepted: fresh.map((event) => event.eventId), rejected };
  }

  async recordPlay(
    dto: AnalyticsPlayDto,
    request: IngestRequest,
    now = new Date(),
  ): Promise<AnalyticsPlayResponseDto> {
    if (!this.features.features.analytics) {
      return { ...DISABLED, status: 'ok' };
    }
    if (isBotUserAgent(request.userAgent)) {
      return { ...PROCEED, status: 'ok' };
    }
    if (!(await this.releases.isPublished(dto.play.releaseId))) {
      this.tally.count('rejected', now);
      return { ...PROCEED, status: 'rejected' };
    }

    const outcome: { status: AnalyticsPlayResponseDto['status'] } = { status: 'ok' };
    const check = await this.inSession(dto, request, now, undefined, async (tx) => {
      outcome.status = await reportPlay(
        tx,
        dto.sessionId,
        dto.play,
        now,
        dto.phase === 'END' ? (dto.endReason ?? 'stopped') : null,
      );
    });

    if (check !== 'ok') {
      return { ...rotationFor(check), status: 'ok' };
    }
    this.tally.count(outcome.status === 'rejected' ? 'rejected' : 'accepted', now);
    return { ...PROCEED, status: outcome.status };
  }

  async recordBeat(
    dto: AnalyticsBeatDto,
    request: IngestRequest,
    now = new Date(),
  ): Promise<AnalyticsRotationDto> {
    if (!this.features.features.analytics) {
      return DISABLED;
    }
    if (isBotUserAgent(request.userAgent)) {
      return PROCEED;
    }
    const releaseId =
      dto.releaseId !== undefined && (await this.releases.isPublished(dto.releaseId))
        ? dto.releaseId
        : null;
    const play =
      dto.play && (await this.releases.isPublished(dto.play.releaseId)) ? dto.play : undefined;

    const check = await this.inSession(dto, request, now, undefined, async (tx) => {
      await touchSessionDay(tx, dto.sessionId, now, {
        build: dto.state === AnalyticsLiveState.BUILDING,
      });
      await tx.$executeRaw`
        INSERT INTO "AnalyticsLiveMinute" ("minute", "visitorId", "state", "releaseId")
        VALUES (${minuteStart(now)}, ${dto.visitorId}::uuid, ${dto.state}::"AnalyticsLiveState", ${releaseId})
        ON CONFLICT ("minute", "visitorId") DO UPDATE
        SET "releaseId" = CASE
              WHEN EXCLUDED."state" > "AnalyticsLiveMinute"."state" THEN EXCLUDED."releaseId"
              WHEN EXCLUDED."state" = "AnalyticsLiveMinute"."state"
                THEN COALESCE(EXCLUDED."releaseId", "AnalyticsLiveMinute"."releaseId")
              ELSE "AnalyticsLiveMinute"."releaseId"
            END,
            "state" = GREATEST("AnalyticsLiveMinute"."state", EXCLUDED."state")`;
      if (play) {
        await reportPlay(tx, dto.sessionId, play, now, null);
      }
    });

    if (check === 'ok') {
      this.tally.count('accepted', now);
    }
    return rotationFor(check);
  }

  async recordPing(dto: AnalyticsPingDto, request: IngestRequest, now = new Date()): Promise<void> {
    if (!this.admits(request)) {
      return;
    }
    const releaseId =
      dto.releaseId !== undefined && (await this.releases.isPublished(dto.releaseId))
        ? dto.releaseId
        : 0;
    this.tally.recordPing(
      {
        kind: dto.kind,
        state: dto.state,
        signedIn: dto.signedIn,
        releaseId,
        // Running time only counts against a published game.
        playMs: releaseId === 0 ? 0 : (dto.playMs ?? 0),
      },
      now,
    );
    this.tally.count('accepted', now);
  }

  /**
   * Links a consenting browser to the signed-in account. Never takes a visitor another account
   * holds, and never revives an erased one: either answer tells the client to mint a new visitor.
   */
  async link(
    userId: number,
    visitorId: string,
    now = new Date(),
  ): Promise<AnalyticsLinkResponseDto> {
    if (!this.features.features.analytics) {
      return { status: 'disabled' };
    }
    const status = await this.prisma.$transaction(
      async (tx): Promise<AnalyticsLinkResponseDto['status']> => {
        await lockPurgeGate(tx, 'shared');
        await lockAccount(tx, userId, 'exclusive');
        await lockVisitors(tx, [visitorId], 'exclusive');

        if (await tx.analyticsVisitorTombstone.findUnique({ where: { id: visitorId } })) {
          return 'erased';
        }
        const visitor = await tx.analyticsVisitor.findUnique({
          where: { id: visitorId },
          select: { userId: true, firstSeenAt: true },
        });
        if (visitor && now.getTime() - visitor.firstSeenAt.getTime() > VISITOR_COOKIE_MS) {
          return 'erased';
        }
        if (visitor?.userId === userId) {
          return 'linked';
        }
        if (visitor && visitor.userId !== null) {
          return 'conflict';
        }

        if (visitor) {
          await tx.analyticsVisitor.update({
            where: { id: visitorId },
            data: { userId, linkedAt: now },
          });
        } else {
          await tx.analyticsVisitor.create({
            data: { id: visitorId, userId, linkedAt: now, firstSeenAt: now, lastSeenAt: now },
          });
        }
        // Queued in the link's own transaction, so a committed link always has its projection due.
        await tx.analyticsProjectionWork.createMany({
          data: [{ visitorId, userId, enqueuedAt: now, nextAttemptAt: now }],
          skipDuplicates: true,
        });
        return 'linked';
      },
    );
    return { status };
  }

  /**
   * Runs `write` in one transaction once the visitor and session are known good, creating them
   * on first sight. Answers how the client must rotate instead when they are not.
   */
  private async inSession(
    identity: AnalyticsIdentityDto,
    request: IngestRequest,
    now: Date,
    context: AnalyticsContextDto | undefined,
    write: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<SessionCheck> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const check = await this.openSession(tx, identity, request, now, context);
        if (check === 'ok') {
          await write(tx);
        }
        return check;
      });
    } catch (error) {
      this.tally.count('writeErrors', now);
      throw error;
    }
  }

  private async openSession(
    tx: Prisma.TransactionClient,
    { visitorId, sessionId }: AnalyticsIdentityDto,
    request: IngestRequest,
    now: Date,
    context: AnalyticsContextDto | undefined,
  ): Promise<SessionCheck> {
    await lockVisitors(tx, [visitorId], 'shared');

    if (await tx.analyticsVisitorTombstone.findUnique({ where: { id: visitorId } })) {
      return 'rotateVisitor';
    }
    await tx.analyticsVisitor.createMany({
      data: [{ id: visitorId, firstSeenAt: now, lastSeenAt: now }],
      skipDuplicates: true,
    });
    const visitor = await tx.analyticsVisitor.findUnique({
      where: { id: visitorId },
      select: { firstSeenAt: true },
    });
    if (!visitor || now.getTime() - visitor.firstSeenAt.getTime() > VISITOR_COOKIE_MS) {
      return 'rotateVisitor';
    }
    await tx.analyticsVisitor.update({ where: { id: visitorId }, data: { lastSeenAt: now } });

    await tx.analyticsSession.createMany({
      data: [this.newSession(visitorId, sessionId, request, now, context)],
      skipDuplicates: true,
    });
    const session = await tx.analyticsSession.findUnique({
      where: { id: sessionId },
      select: { visitorId: true, startedAt: true, lastSeenAt: true, closedAt: true },
    });
    if (!session || session.visitorId !== visitorId || session.closedAt) {
      return 'rotateSession';
    }
    const idle = now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS;
    const tooLong = now.getTime() - session.startedAt.getTime() > SESSION_MAX_MS;
    if (idle || tooLong) {
      const cap = new Date(session.startedAt.getTime() + SESSION_MAX_MS);
      await tx.analyticsSession.update({
        where: { id: sessionId },
        data: { closedAt: session.lastSeenAt < cap ? session.lastSeenAt : cap },
      });
      return 'rotateSession';
    }
    await tx.analyticsSession.update({ where: { id: sessionId }, data: { lastSeenAt: now } });
    return 'ok';
  }

  private newSession(
    visitorId: string,
    sessionId: string,
    request: IngestRequest,
    now: Date,
    context: AnalyticsContextDto | undefined,
  ): Prisma.AnalyticsSessionCreateManyInput {
    const agent = summarizeUserAgent(request.userAgent);
    return {
      id: sessionId,
      visitorId,
      startedAt: now,
      lastSeenAt: now,
      referrerDomain: referrerDomain(context?.referrer, this.frontendUrl),
      utmSource: sanitizeUtm(context?.utmSource),
      utmMedium: sanitizeUtm(context?.utmMedium),
      utmCampaign: sanitizeUtm(context?.utmCampaign),
      device: agent.device,
      browser: agent.browser,
      os: agent.os,
      country: this.geo.countryOf(request.ip),
      screen: screenBucket(context?.viewportWidth),
      language: primaryLanguage(request.acceptLanguage),
    };
  }
}

const EMPTY_DAY_BITS = Prisma.sql`decode(repeat('00', 180), 'hex')`;

/**
 * Adds to one session's row for the day of `at`: page views, running time, and the minute of
 * `at` as active, and as building when it was.
 */
async function touchSessionDay(
  tx: Prisma.TransactionClient,
  sessionId: string,
  at: Date,
  {
    pageViews = 0,
    build = false,
    playMs = 0,
  }: { pageViews?: number; build?: boolean; playMs?: number },
): Promise<void> {
  const day = utcDay(at);
  const minute = minuteOfDay(at);
  await tx.$executeRaw`
    INSERT INTO "AnalyticsSessionDay" ("sessionId", "day", "pageViews", "activeBits", "buildBits", "playMs")
    VALUES (
      ${sessionId}::uuid, ${day}::date, ${pageViews}::int,
      set_bit(${EMPTY_DAY_BITS}, ${minute}::int, 1),
      CASE WHEN ${build} THEN set_bit(${EMPTY_DAY_BITS}, ${minute}::int, 1) ELSE ${EMPTY_DAY_BITS} END,
      ${playMs}::bigint
    )
    ON CONFLICT ("sessionId", "day") DO UPDATE
    SET "pageViews" = "AnalyticsSessionDay"."pageViews" + EXCLUDED."pageViews",
        "activeBits" = set_bit("AnalyticsSessionDay"."activeBits", ${minute}::int, 1),
        "buildBits" = CASE
          WHEN ${build} THEN set_bit("AnalyticsSessionDay"."buildBits", ${minute}::int, 1)
          ELSE "AnalyticsSessionDay"."buildBits"
        END,
        "playMs" = "AnalyticsSessionDay"."playMs" + EXCLUDED."playMs"`;
}

interface PlayRow {
  sessionId: string;
  startedAt: Date;
  lastSeenAt: Date;
  activeMs: bigint;
  baselineMs: bigint;
  endedAt: Date | null;
}

/**
 * Applies one report of a play, whichever message carries it, so a lost START is recovered by
 * the next report. Running time only grows: a repeated or older report credits nothing, and a
 * report claiming more time than could have passed is credited up to what could, the rest kept
 * as a baseline that is never credited. Every interval is credited at most once.
 */
async function reportPlay(
  tx: Prisma.TransactionClient,
  sessionId: string,
  report: AnalyticsPlayReportDto,
  now: Date,
  endReason: PlayEndReason | null,
): Promise<AnalyticsPlayResponseDto['status']> {
  const startEstimate = new Date(
    now.getTime() - Math.min(report.startAgeMs ?? report.activeMs, MAX_EVENT_AGE_MS),
  );
  const created = await tx.analyticsPlay.createMany({
    data: [
      {
        id: report.playId,
        sessionId,
        releaseId: report.releaseId,
        continued: report.continued,
        startedAt: startEstimate,
        lastSeenAt: now,
      },
    ],
    skipDuplicates: true,
  });
  const [row] = await tx.$queryRaw<PlayRow[]>`
    SELECT "sessionId", "startedAt", "lastSeenAt", "activeMs", "baselineMs", "endedAt"
    FROM "AnalyticsPlay" WHERE id = ${report.playId}::uuid FOR UPDATE`;
  if (!row || row.sessionId !== sessionId) {
    return 'rejected';
  }
  if (row.endedAt) {
    return 'ended';
  }

  // Only a stated start age moves a known play's start: its running time says nothing of when it began.
  const startedAt =
    report.startAgeMs !== undefined && startEstimate < row.startedAt
      ? startEstimate
      : row.startedAt;
  const old = Number(row.activeMs);
  const baseline = Number(row.baselineMs);
  const reported = report.activeMs - baseline;
  const sinceLast = now.getTime() - (created.count === 1 ? startedAt : row.lastSeenAt).getTime();
  const ceiling = Math.min(
    old + sinceLast + PROGRESS_SLACK_MS,
    now.getTime() - startedAt.getTime() + PROGRESS_SLACK_MS,
  );
  const credited = reported <= old ? old : Math.min(reported, ceiling);
  const unverifiable = Math.max(0, reported - credited);
  const delta = credited - old;

  await tx.analyticsPlay.update({
    where: { id: report.playId },
    data: {
      startedAt,
      activeMs: BigInt(credited),
      baselineMs: BigInt(baseline + unverifiable),
      ...(delta > 0 || created.count === 1 ? { lastSeenAt: now } : {}),
      ...(endReason ? { endedAt: now, endReason } : {}),
    },
  });
  if (delta > 0) {
    await tx.$executeRaw`
      INSERT INTO "AnalyticsPlayDay" ("playId", "day", "activeMs")
      VALUES (${report.playId}::uuid, ${utcDay(now)}::date, ${delta}::bigint)
      ON CONFLICT ("playId", "day") DO UPDATE
      SET "activeMs" = "AnalyticsPlayDay"."activeMs" + EXCLUDED."activeMs"`;
    await touchSessionDay(tx, sessionId, now, { playMs: delta });
  }
  return 'ok';
}
