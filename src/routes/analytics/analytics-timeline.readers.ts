import { AnalyticsAnonConsent, AnalyticsFactType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { TimelineMetric, TimelineSource } from './analytics-timeline';

/**
 * What every timeline metric counts in `[from, to)`, read through the Prisma client. A reader
 * answers samples, each an instant with a value and, for a distinct count, whose it is. The service
 * puts them in buckets, so a reader knows nothing of bucket sizes.
 */

export interface TimelineRange {
  from: Date;
  to: Date;
}

export interface TimelineFilters {
  releaseId?: number;
  source?: TimelineSource;
}

export interface Sample {
  at: Date;
  value: number;
  /** Whom it counts, for a metric counting each one once. */
  who?: string;
}

type Reader = (
  prisma: PrismaService,
  range: TimelineRange,
  filters: TimelineFilters,
) => Promise<Sample[]>;

/** Where a session came from, as stored on it. */
export interface SessionSource {
  referrerDomain: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
}

export interface FirstSession extends SessionSource {
  visitorId: string;
  country: string | null;
  device: string;
}

/** Ids per `in` filter, well under the bind parameters one statement takes. */
const ID_CHUNK = 5_000;

const between = (range: TimelineRange): Prisma.DateTimeFilter => ({
  gte: range.from,
  lt: range.to,
});

const once = (at: Date): Sample => ({ at, value: 1 });

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += ID_CHUNK) {
    out.push(items.slice(start, start + ID_CHUNK));
  }
  return out;
}

const textMatch = (value: string | null): Prisma.StringNullableFilter | null =>
  value === null ? null : { equals: value, mode: 'insensitive' };

/** Sessions from the source, or every session without one. */
export function sessionsFrom(
  source: TimelineSource | undefined,
): Prisma.AnalyticsSessionWhereInput {
  if (!source) {
    return {};
  }
  switch (source.kind) {
    case 'referrer':
      return { referrerDomain: textMatch(source.value) };
    case 'utmSource':
      return { utmSource: textMatch(source.value) };
    case 'utmCampaign':
      return { utmCampaign: textMatch(source.value) };
  }
}

/** Whether a session's columns name the source, ignoring case as the filter does. */
export function cameFrom(session: SessionSource, source: TimelineSource): boolean {
  const value = {
    referrer: session.referrerDomain,
    utmSource: session.utmSource,
    utmCampaign: session.utmCampaign,
  }[source.kind];
  return source.value === null
    ? value === null
    : value !== null && value.toLowerCase() === source.value.toLowerCase();
}

/** The first session of each visitor, which tells where the visitor came from. */
export async function firstSessions(
  prisma: PrismaService,
  visitorIds: readonly string[],
): Promise<Map<string, FirstSession>> {
  const firsts = new Map<string, FirstSession>();
  for (const ids of chunks([...new Set(visitorIds)])) {
    const rows = await prisma.analyticsSession.findMany({
      where: { visitorId: { in: ids } },
      orderBy: [{ visitorId: 'asc' }, { startedAt: 'asc' }],
      distinct: ['visitorId'],
      select: {
        visitorId: true,
        referrerDomain: true,
        utmSource: true,
        utmCampaign: true,
        country: true,
        device: true,
      },
    });
    for (const row of rows) {
      firsts.set(row.visitorId, row);
    }
  }
  return firsts;
}

/** The visitors among these whose first session came from the source. */
async function acquiredFrom(
  prisma: PrismaService,
  visitorIds: readonly string[],
  source: TimelineSource,
): Promise<Set<string>> {
  const firsts = await firstSessions(prisma, visitorIds);
  return new Set(
    [...firsts.values()].filter((first) => cameFrom(first, source)).map((first) => first.visitorId),
  );
}

/** The accounts among these linked to a consenting browser whose first session came from it. */
async function accountsFrom(
  prisma: PrismaService,
  accountIds: readonly number[],
  source: TimelineSource,
): Promise<Set<number>> {
  const visitors = await linkedVisitors(prisma, accountIds);
  const acquired = await acquiredFrom(
    prisma,
    visitors.map((visitor) => visitor.id),
    source,
  );
  return new Set(
    visitors.filter((visitor) => acquired.has(visitor.id)).map((visitor) => visitor.userId),
  );
}

/** The consenting browsers linked to these accounts, the earliest first. */
export async function linkedVisitors(
  prisma: PrismaService,
  accountIds: readonly number[],
): Promise<{ id: string; userId: number }[]> {
  const linked: { id: string; userId: number }[] = [];
  for (const ids of chunks([...new Set(accountIds)])) {
    const rows = await prisma.analyticsVisitor.findMany({
      where: { userId: { in: ids } },
      orderBy: { firstSeenAt: 'asc' },
      select: { id: true, userId: true },
    });
    for (const row of rows) {
      if (row.userId !== null) {
        linked.push({ id: row.id, userId: row.userId });
      }
    }
  }
  return linked;
}

const fact =
  (type: AnalyticsFactType, byProject: boolean, bySource: boolean): Reader =>
  async (prisma, range, { releaseId, source }) => {
    const facts = await prisma.analyticsFact.findMany({
      where: {
        type,
        at: between(range),
        ...(byProject && releaseId !== undefined ? { projectId: releaseId } : {}),
      },
      select: { at: true, actorUserId: true },
    });
    if (!bySource || !source) {
      return facts.map((one) => once(one.at));
    }
    const accounts = await accountsFrom(
      prisma,
      facts.flatMap((one) => (one.actorUserId === null ? [] : [one.actorUserId])),
      source,
    );
    return facts
      .filter((one) => one.actorUserId !== null && accounts.has(one.actorUserId))
      .map((one) => once(one.at));
  };

const anonymousPlays =
  (only: Prisma.AnalyticsAnonTallyWhereInput): Reader =>
  async (prisma, range, { releaseId }) => {
    const minutes = await prisma.analyticsAnonTally.groupBy({
      by: ['minute'],
      where: {
        ...only,
        minute: between(range),
        playsStarted: { gt: 0 },
        releaseId: releaseId ?? { not: 0 },
      },
      _sum: { playsStarted: true },
    });
    return minutes.map((row) => ({ at: row.minute, value: row._sum.playsStarted ?? 0 }));
  };

const anonymousTabs =
  (consent: AnalyticsAnonConsent): Reader =>
  async (prisma, range) => {
    const minutes = await prisma.analyticsAnonTally.groupBy({
      by: ['minute'],
      where: { consent, minute: between(range) },
      _sum: { beats: true },
    });
    return minutes.map((row) => ({ at: row.minute, value: row._sum.beats ?? 0 }));
  };

type PresenceColumn =
  | 'activeBrowsers'
  | 'activeBrowsersPlaying'
  | 'anonTabs'
  | 'anonTabsPlaying'
  | 'accounts';

const presence =
  (column: PresenceColumn): Reader =>
  async (prisma, range) => {
    const samples = await prisma.concurrencySample.findMany({ where: { at: between(range) } });
    return samples.map((sample) => ({ at: sample.at, value: sample[column] }));
  };

/** Plays started in the range by consenting browsers, with whose they are. */
async function consentedPlays(
  prisma: PrismaService,
  range: TimelineRange,
  { releaseId, source }: TimelineFilters,
  countedOnly: boolean,
): Promise<{ startedAt: Date; visitorId: string }[]> {
  const plays = await prisma.analyticsPlay.findMany({
    where: {
      startedAt: between(range),
      ...(countedOnly ? { continued: false } : {}),
      ...(releaseId === undefined ? {} : { releaseId }),
      ...(source ? { session: sessionsFrom(source) } : {}),
    },
    select: { startedAt: true, session: { select: { visitorId: true } } },
  });
  return plays.map((play) => ({ startedAt: play.startedAt, visitorId: play.session.visitorId }));
}

export const TIMELINE_READERS: Record<TimelineMetric, Reader> = {
  visitors_new: async (prisma, range, { source }) => {
    const visitors = await prisma.analyticsVisitor.findMany({
      where: { firstSeenAt: between(range) },
      select: { id: true, firstSeenAt: true },
    });
    if (!source) {
      return visitors.map((visitor) => once(visitor.firstSeenAt));
    }
    const acquired = await acquiredFrom(
      prisma,
      visitors.map((visitor) => visitor.id),
      source,
    );
    return visitors
      .filter((visitor) => acquired.has(visitor.id))
      .map((visitor) => once(visitor.firstSeenAt));
  },

  sessions: async (prisma, range, { source }) => {
    const sessions = await prisma.analyticsSession.findMany({
      where: { startedAt: between(range), ...sessionsFrom(source) },
      select: { startedAt: true },
    });
    return sessions.map((session) => once(session.startedAt));
  },

  pageviews: async (prisma, range, { source }) => {
    const views = await prisma.analyticsPageView.findMany({
      where: { occurredAt: between(range), ...(source ? { session: sessionsFrom(source) } : {}) },
      select: { occurredAt: true },
    });
    return views.map((view) => once(view.occurredAt));
  },

  plays_consented: async (prisma, range, filters) =>
    (await consentedPlays(prisma, range, filters, true)).map((play) => once(play.startedAt)),

  plays_anonymous: anonymousPlays({}),
  plays_declined: anonymousPlays({ consent: 'DECLINED' }),
  plays_unanswered: anonymousPlays({ consent: 'UNANSWERED' }),
  plays_anonymous_signed_in: anonymousPlays({ signedIn: true }),

  players: async (prisma, range, filters) =>
    (await consentedPlays(prisma, range, filters, false)).map((play) => ({
      at: play.startedAt,
      value: 1,
      who: play.visitorId,
    })),

  players_new: async (prisma, range, { releaseId, source }) => {
    const inRange = await consentedPlays(
      prisma,
      range,
      releaseId === undefined ? {} : { releaseId },
      false,
    );
    const candidates = [...new Set(inRange.map((play) => play.visitorId))];
    const first = new Map<string, Date>();
    for (const ids of chunks(candidates)) {
      const plays = await prisma.analyticsPlay.findMany({
        where: {
          startedAt: { lt: range.to },
          session: { visitorId: { in: ids } },
          ...(releaseId === undefined ? {} : { releaseId }),
        },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true, session: { select: { visitorId: true } } },
      });
      for (const play of plays) {
        if (!first.has(play.session.visitorId)) {
          first.set(play.session.visitorId, play.startedAt);
        }
      }
    }
    const firsts = [...first.entries()].filter(([, at]) => at >= range.from);
    const acquired = source
      ? await acquiredFrom(
          prisma,
          firsts.map(([visitorId]) => visitorId),
          source,
        )
      : null;
    return firsts
      .filter(([visitorId]) => acquired === null || acquired.has(visitorId))
      .map(([, at]) => once(at));
  },

  signups: fact('SIGNUP', false, true),

  signups_unlinked: async (prisma, range) => {
    const signups = await prisma.analyticsFact.findMany({
      where: { type: 'SIGNUP', at: between(range) },
      select: { at: true, actorUserId: true },
    });
    const linked = new Set(
      (
        await linkedVisitors(
          prisma,
          signups.flatMap((one) => (one.actorUserId === null ? [] : [one.actorUserId])),
        )
      ).map((visitor) => visitor.userId),
    );
    return signups
      .filter((one) => one.actorUserId === null || !linked.has(one.actorUserId))
      .map((one) => once(one.at));
  },

  projects_created: fact('PROJECT_CREATED', false, true),

  projects_forked: async (prisma, range, { releaseId, source }) => {
    const created = await prisma.analyticsFact.findMany({
      where: { type: 'PROJECT_CREATED', at: between(range), projectId: { not: null } },
      select: { at: true, actorUserId: true, projectId: true },
    });
    const forks = new Set<number>();
    for (const ids of chunks(
      created.flatMap((one) => (one.projectId === null ? [] : [one.projectId])),
    )) {
      const projects = await prisma.project.findMany({
        where: {
          id: { in: ids },
          forkedFromId: releaseId === undefined ? { not: null } : releaseId,
        },
        select: { id: true },
      });
      for (const project of projects) {
        forks.add(project.id);
      }
    }
    const forked = created.filter((one) => one.projectId !== null && forks.has(one.projectId));
    if (!source) {
      return forked.map((one) => once(one.at));
    }
    const accounts = await accountsFrom(
      prisma,
      forked.flatMap((one) => (one.actorUserId === null ? [] : [one.actorUserId])),
      source,
    );
    return forked
      .filter((one) => one.actorUserId !== null && accounts.has(one.actorUserId))
      .map((one) => once(one.at));
  },

  releases_published: fact('RELEASE_PUBLISHED', true, true),
  releases_updated: fact('RELEASE_UPDATED', true, false),

  mp_sessions: async (prisma, range, { releaseId }) => {
    const rooms = await prisma.analyticsMpSession.findMany({
      where: {
        editorTest: false,
        reachedMultiAt: between(range),
        ...(releaseId === undefined ? {} : { projectId: releaseId }),
      },
      select: { reachedMultiAt: true },
    });
    return rooms.flatMap((room) => (room.reachedMultiAt ? [once(room.reachedMultiAt)] : []));
  },

  mp_participants: async (prisma, range, { releaseId }) => {
    const seats = await prisma.analyticsMpSeat.findMany({
      where: { firstConnectedAt: between(range) },
      select: { sessionId: true, firstConnectedAt: true },
    });
    const counted = new Set<string>();
    for (const ids of chunks([...new Set(seats.map((seat) => seat.sessionId))])) {
      const rooms = await prisma.analyticsMpSession.findMany({
        where: {
          id: { in: ids },
          editorTest: false,
          ...(releaseId === undefined ? {} : { projectId: releaseId }),
        },
        select: { id: true },
      });
      for (const room of rooms) {
        counted.add(room.id);
      }
    }
    return seats
      .filter((seat) => counted.has(seat.sessionId))
      .map((seat) => once(seat.firstConnectedAt));
  },

  active_browsers: presence('activeBrowsers'),
  browsers_playing: presence('activeBrowsersPlaying'),
  anon_tabs: presence('anonTabs'),
  anon_tabs_playing: presence('anonTabsPlaying'),
  anon_tabs_declined: anonymousTabs('DECLINED'),
  anon_tabs_unanswered: anonymousTabs('UNANSWERED'),
  accounts_online: presence('accounts'),
};
