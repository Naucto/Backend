/**
 * Fills a local database with 60 days of synthetic analytics, so the admin panel has something
 * to chart: consenting visitors with sessions, page views and plays on the published games,
 * anonymous tallies, minute presence, business facts and multiplayer rooms. Every value comes
 * from a seeded generator, so two runs draw the same charts. Re-running it replaces what it
 * wrote. Then it finalizes every due period, as the server would.
 *
 *   npm run seed:analytics
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { AnalyticsFactType, AnalyticsLiveState, Prisma, PrismaClient } from '@prisma/client';

import { databaseUrl } from '../src/prisma/database-url';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsFinalizeService } from '../src/routes/analytics/analytics-finalize.service';
import { assertLocalDatabase } from './local-database';

const DAYS = 60;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Every synthetic visitor id starts with this, so a re-run finds what it wrote. */
const SEED_PREFIX = '5eed';
const BATCH = 1_000;

const connectionString = databaseUrl();
if (!connectionString) {
  throw new ReferenceError(
    'Set DATABASE_URL, or POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB in .env',
  );
}
assertLocalDatabase(connectionString, 'seed:analytics');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** mulberry32: small, fast and seeded. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const random = generator(276);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1));

let counter = 0;
/** A version 4 uuid under the seed prefix; the counter in its last group keeps it unique. */
function seedUuid(): string {
  counter += 1;
  const group = (): string =>
    Math.floor(random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${SEED_PREFIX}${group()}-${group()}-4${group().slice(1)}-8${group().slice(1)}-${counter
    .toString(16)
    .padStart(12, '0')}`;
}

const DEVICES = ['desktop', 'desktop', 'desktop', 'mobile', 'mobile', 'tablet'] as const;
const BROWSERS = ['Chrome', 'Chrome', 'Firefox', 'Safari', 'Edge', 'Mobile Safari'] as const;
const OSES = ['Windows', 'Mac OS', 'Linux', 'iOS', 'Android'] as const;
const COUNTRIES = ['FR', 'FR', 'FR', 'BE', 'CH', 'CA', 'US', 'DE', 'GB', null] as const;
const LANGUAGES = ['fr', 'fr', 'en', 'en', 'de'] as const;
const SCREENS = ['lg', 'lg', 'xl', 'md', 'xs'] as const;
const REFERRERS = [null, null, null, 'google.com', 'reddit.com', 'itch.io', 'discord.com'] as const;
const ROUTES = [
  'hub',
  'play/:id',
  'play/:id',
  'learn',
  'u/:username',
  'games',
  'edit/:id/code',
] as const;

/** Visits on a day: more on weekends and in the evening, a slow upward trend. */
function sessionsOn(day: Date, index: number): number {
  const weekday = day.getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 1.4 : 1;
  return Math.round((25 + index * 0.6) * weekend * (0.85 + random() * 0.3));
}

function eveningHour(): number {
  return pick([8, 10, 12, 12, 14, 16, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22]);
}

function bitsFor(minutes: number[]): Uint8Array<ArrayBuffer> {
  const bits = new Uint8Array(180);
  for (const minute of minutes) {
    const byte = bits[minute >> 3] ?? 0;
    bits[minute >> 3] = byte | (1 << (minute & 7));
  }
  return bits;
}

async function inBatches<T>(rows: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    await write(rows.slice(start, start + BATCH));
  }
}

async function clearPrevious(from: Date, to: Date): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "AnalyticsVisitor" WHERE id::text LIKE ${`${SEED_PREFIX}%`}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsAnonTally" WHERE "minute" >= ${from} AND "minute" < ${to}`;
  await prisma.$executeRaw`DELETE FROM "ConcurrencySample" WHERE "at" >= ${from} AND "at" < ${to}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsFact" WHERE "dedupeKey" LIKE 'seed:%'`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsMpDay" WHERE "sessionId"::text LIKE ${`${SEED_PREFIX}%`}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsMpSeat" WHERE "sessionId"::text LIKE ${`${SEED_PREFIX}%`}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsMpSession" WHERE id::text LIKE ${`${SEED_PREFIX}%`}`;
  // Periods are recomputed below from what is now stored.
  await prisma.analyticsRollup.deleteMany({});
  await prisma.analyticsRollupStatus.deleteMany({});
  await prisma.analyticsCohort.deleteMany({});
}

async function main(): Promise<void> {
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const from = new Date(today.getTime() - DAYS * DAY_MS);
  const releases = (
    await prisma.project.findMany({ where: { publishedAt: { not: null } }, select: { id: true } })
  ).map((project) => project.id);
  if (releases.length === 0) {
    console.warn('seed:analytics: no published game, so no plays are generated');
  }

  await clearPrevious(from, today);

  const visitors: Prisma.AnalyticsVisitorCreateManyInput[] = [];
  const sessions: Prisma.AnalyticsSessionCreateManyInput[] = [];
  const sessionDays: Prisma.AnalyticsSessionDayCreateManyInput[] = [];
  const pageViews: Prisma.AnalyticsPageViewCreateManyInput[] = [];
  const plays: Prisma.AnalyticsPlayCreateManyInput[] = [];
  const playDays: Prisma.AnalyticsPlayDayCreateManyInput[] = [];
  const tallies: Prisma.AnalyticsAnonTallyCreateManyInput[] = [];
  const facts: Prisma.AnalyticsFactCreateManyInput[] = [];
  const pool: { id: string; firstSeenAt: Date; lastSeenAt: Date }[] = [];

  for (let index = 0; index < DAYS; index++) {
    const day = new Date(from.getTime() + index * DAY_MS);
    for (let visit = 0; visit < sessionsOn(day, index); visit++) {
      const start = new Date(
        day.getTime() + eveningHour() * 3_600_000 + between(0, 59) * MINUTE_MS,
      );
      const returning = pool.length > 20 && random() < 0.45;
      let visitor = returning ? pick(pool) : undefined;
      if (!visitor) {
        visitor = { id: seedUuid(), firstSeenAt: start, lastSeenAt: start };
        pool.push(visitor);
      }
      const minutes = between(1, 40);
      const end = new Date(start.getTime() + minutes * MINUTE_MS);
      visitor.lastSeenAt = end > visitor.lastSeenAt ? end : visitor.lastSeenAt;

      const sessionId = seedUuid();
      sessions.push({
        id: sessionId,
        visitorId: visitor.id,
        startedAt: start,
        lastSeenAt: end,
        closedAt: end,
        referrerDomain: pick(REFERRERS),
        utmSource: random() < 0.1 ? 'newsletter' : null,
        utmMedium: null,
        utmCampaign: random() < 0.05 ? 'launch' : null,
        device: pick(DEVICES),
        browser: pick(BROWSERS),
        os: pick(OSES),
        country: pick(COUNTRIES),
        screen: pick(SCREENS),
        language: pick(LANGUAGES),
      });

      const first = start.getUTCHours() * 60 + start.getUTCMinutes();
      const active = Array.from({ length: minutes }, (_, i) => Math.min(first + i, 1_439));
      const views = random() < 0.3 ? 1 : between(2, 6);
      for (let view = 0; view < views; view++) {
        pageViews.push({
          id: seedUuid(),
          sessionId,
          occurredAt: new Date(start.getTime() + Math.floor((view * minutes * MINUTE_MS) / views)),
          route: view === 0 ? 'hub' : pick(ROUTES),
        });
      }
      let playMs = 0;
      if (releases.length > 0 && views > 1 && random() < 0.65) {
        const playMinutes = between(1, Math.max(1, minutes - 1));
        playMs = playMinutes * MINUTE_MS - between(0, 30_000);
        const playId = seedUuid();
        plays.push({
          id: playId,
          sessionId,
          releaseId: pick(releases),
          continued: false,
          startedAt: new Date(start.getTime() + MINUTE_MS),
          lastSeenAt: end,
          activeMs: BigInt(playMs),
          endedAt: end,
          endReason: 'leave',
        });
        playDays.push({ playId, day, activeMs: BigInt(playMs) });
      }
      sessionDays.push({
        sessionId,
        day,
        pageViews: views,
        activeBits: bitsFor(active),
        buildBits: bitsFor(random() < 0.1 ? active.slice(0, 5) : []),
        playMs: BigInt(playMs),
      });
    }

    for (let hour = 8; hour < 24; hour++) {
      const minute = new Date(day.getTime() + hour * 3_600_000 + 30 * MINUTE_MS);
      tallies.push({
        minute,
        state: AnalyticsLiveState.BROWSING,
        signedIn: false,
        releaseId: 0,
        beats: between(2, 12),
        playsStarted: 0,
        playMs: 0n,
      });
      if (releases.length > 0) {
        tallies.push({
          minute,
          state: AnalyticsLiveState.PLAYING,
          signedIn: false,
          releaseId: pick(releases),
          beats: between(1, 8),
          playsStarted: between(0, 3),
          playMs: BigInt(between(1, 8) * 60_000),
        });
      }
    }

    for (let signup = 0; signup < between(0, 4); signup++) {
      facts.push({
        dedupeKey: `seed:signup:${String(index)}:${String(signup)}`,
        at: new Date(day.getTime() + eveningHour() * 3_600_000),
        type: AnalyticsFactType.SIGNUP,
      });
    }
    for (let created = 0; created < between(0, 3); created++) {
      facts.push({
        dedupeKey: `seed:project:${String(index)}:${String(created)}`,
        at: new Date(day.getTime() + eveningHour() * 3_600_000),
        type: AnalyticsFactType.PROJECT_CREATED,
      });
    }
    if (random() < 0.3) {
      facts.push({
        dedupeKey: `seed:release:${String(index)}`,
        at: new Date(day.getTime() + 20 * 3_600_000),
        type: AnalyticsFactType.RELEASE_PUBLISHED,
      });
    }

    if (releases.length > 0) {
      for (let room = 0; room < between(0, 3); room++) {
        const id = seedUuid();
        const startedAt = new Date(day.getTime() + eveningHour() * 3_600_000);
        const seats = between(1, 4);
        const minutesTogether = seats >= 2 ? between(5, 40) : 0;
        await prisma.analyticsMpSession.create({
          data: {
            id,
            projectId: pick(releases),
            createdAt: startedAt,
            classifiedAt: startedAt,
            firstConnectedAt: startedAt,
            reachedMultiAt: seats >= 2 ? new Date(startedAt.getTime() + MINUTE_MS) : null,
            endedAt: new Date(startedAt.getTime() + (minutesTogether + 2) * MINUTE_MS),
            peakConnected: seats,
            multiMs: BigInt(minutesTogether * MINUTE_MS),
            playerMs: BigInt(minutesTogether * seats * MINUTE_MS),
          },
        });
        await prisma.analyticsMpSeat.createMany({
          data: Array.from({ length: seats }, () => ({
            sessionId: id,
            seatToken: seedUuid(),
            firstConnectedAt: startedAt,
          })),
        });
        await prisma.analyticsMpDay.create({
          data: {
            sessionId: id,
            day,
            multiMs: BigInt(minutesTogether * MINUTE_MS),
            playerMs: BigInt(minutesTogether * seats * MINUTE_MS),
          },
        });
      }
    }
  }

  visitors.push(...pool);
  await inBatches(visitors, (batch) => prisma.analyticsVisitor.createMany({ data: batch }));
  await inBatches(sessions, (batch) => prisma.analyticsSession.createMany({ data: batch }));
  await inBatches(sessionDays, (batch) => prisma.analyticsSessionDay.createMany({ data: batch }));
  await inBatches(pageViews, (batch) => prisma.analyticsPageView.createMany({ data: batch }));
  await inBatches(plays, (batch) => prisma.analyticsPlay.createMany({ data: batch }));
  await inBatches(playDays, (batch) => prisma.analyticsPlayDay.createMany({ data: batch }));
  await inBatches(tallies, (batch) =>
    prisma.analyticsAnonTally.createMany({ data: batch, skipDuplicates: true }),
  );
  await prisma.analyticsFact.createMany({ data: facts, skipDuplicates: true });

  // Minute presence: a daily wave peaking in the evening, more on weekends.
  await prisma.$executeRaw`
    INSERT INTO "ConcurrencySample" ("at", "activeBrowsers", "activeBrowsersPlaying", "activeBrowsersBuilding",
      "activeBrowsersHosting", "anonTabs", "anonTabsPlaying", "anonTabsBuilding", "anonTabsHosting",
      "accounts", "accountsPlaying", "accountsBuilding", "accountsHosting")
    SELECT at, b, b / 2, b / 8, b / 20, a, a / 2, 0, 0, c, c / 2, c / 6, c / 20
    FROM (
      SELECT at,
        GREATEST(0, round(6 + 5 * sin(2 * pi() * (EXTRACT(HOUR FROM at) - 14) / 24)
          * (CASE WHEN EXTRACT(ISODOW FROM at) >= 6 THEN 1.5 ELSE 1 END) + random() * 2))::int AS b,
        GREATEST(0, round(4 + 4 * sin(2 * pi() * (EXTRACT(HOUR FROM at) - 14) / 24) + random() * 2))::int AS a,
        GREATEST(0, round(3 + 3 * sin(2 * pi() * (EXTRACT(HOUR FROM at) - 14) / 24) + random()))::int AS c
      FROM generate_series(${from}::timestamp, ${today}::timestamp - interval '1 minute', interval '1 minute') AS at
    ) AS wave
    ON CONFLICT ("at") DO NOTHING`;

  const finalized = await new AnalyticsFinalizeService(
    prisma as unknown as PrismaService,
  ).finalizeDue(new Date());
  console.log(
    `seed:analytics: ${String(pool.length)} visitors, ${String(sessions.length)} sessions, ` +
      `${String(pageViews.length)} page views, ${String(plays.length)} plays over ${String(DAYS)} days; ` +
      `${String(finalized)} periods finalized`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
