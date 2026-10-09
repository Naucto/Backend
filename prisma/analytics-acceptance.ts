/**
 * Acceptance harness for analytics, run by hand against the local Postgres; never in CI.
 *
 *   npm run analytics:acceptance
 *
 * Creates a scratch database, applies the migrations, and drives the real services over two
 * separate connections, so locks and transactions behave as in production: a scenario holds a
 * lock on one connection at a named point while the other runs. Each scenario starts from empty
 * tables and compares what is stored against values worked out by hand. The scratch database is
 * dropped at the end. Exits non-zero when any check fails.
 */
import 'dotenv/config';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { AnalyticsLiveState, Prisma, PrismaClient } from '@prisma/client';
import { Client } from 'pg';

import { PresenceService } from '../src/presence/presence.service';
import { databaseUrl } from '../src/prisma/database-url';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsErasureService } from '../src/routes/analytics/analytics-erasure.service';
import { AnalyticsFactService } from '../src/routes/analytics/analytics-fact.service';
import { AnalyticsFinalizeService } from '../src/routes/analytics/analytics-finalize.service';
import {
  AnalyticsIngestService,
  IngestRequest,
} from '../src/routes/analytics/analytics-ingest.service';
import { periodOf } from '../src/routes/analytics/analytics-periods';
import { AnalyticsProjectionService } from '../src/routes/analytics/analytics-projection.service';
import { AnalyticsPurgeService } from '../src/routes/analytics/analytics-purge.service';
import { AnalyticsQueryService } from '../src/routes/analytics/analytics-query.service';
import { AnalyticsSamplerService } from '../src/routes/analytics/analytics-sampler.service';
import { AnalyticsTallyService } from '../src/routes/analytics/analytics-tally.service';
import { AnalyticsPlayReportDto } from '../src/routes/analytics/dto/analytics-ingest.dto';
import { AnalyticsRotationDto } from '../src/routes/analytics/dto/analytics-ingest-response.dto';
import { GeoIpService } from '../src/routes/analytics/geo-ip.service';
import { lockPurgeGate, lockVisitors } from '../src/routes/analytics/identity-locks';
import { PublishedReleasesService } from '../src/routes/analytics/published-releases.service';
import { FeaturesService } from '../src/routes/features/features.service';
import { MultiplayerAccountingService } from '../src/routes/multiplayer/multiplayer-accounting.service';
import { assertLocalDatabase } from './local-database';

const SCRATCH = 'naucto_analytics_acceptance';
const MIGRATIONS = join(__dirname, 'migrations');

interface Services {
  tally: AnalyticsTallyService;
  erasure: AnalyticsErasureService;
  ingest: AnalyticsIngestService;
  finalize: AnalyticsFinalizeService;
  projection: AnalyticsProjectionService;
  purge: AnalyticsPurgeService;
  query: AnalyticsQueryService;
  sampler: AnalyticsSamplerService;
  facts: AnalyticsFactService;
  multiplayer: MultiplayerAccountingService;
}
const BROWSER: IngestRequest = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
  ip: '203.0.113.9',
  acceptLanguage: 'fr-FR',
};

const at = (iso: string): Date => new Date(iso);
let uuidCounter = 0;
/** A distinct, readable version 4 uuid per call. */
const uuid = (): string => {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
};

interface Check {
  scenario: string;
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
let currentScenario = '';
function expectEqual(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({
    scenario: currentScenario,
    name,
    ok,
    detail: ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  });
}

/** Resolves to whether `promise` settled within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

/** Opens a transaction that runs `hold`, then keeps it open until `release` is called. */
function holdOpen(
  client: PrismaClient,
  hold: (tx: Prisma.TransactionClient) => Promise<void>,
): { ready: Promise<void>; release: () => void; done: Promise<void> } {
  let release: () => void = () => undefined;
  let ready: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  const isReady = new Promise<void>((resolve) => (ready = resolve));
  const done = client.$transaction(
    async (tx) => {
      await hold(tx);
      ready();
      await released;
    },
    { timeout: 30_000 },
  );
  return { ready: isReady, release, done };
}

async function main(): Promise<void> {
  const base = databaseUrl();
  if (!base) {
    throw new ReferenceError('Set DATABASE_URL, or POSTGRES_* in .env');
  }
  assertLocalDatabase(base, 'analytics:acceptance');
  const scratchUrl = Object.assign(new URL(base), { pathname: `/${SCRATCH}` }).toString();

  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${SCRATCH}`);
  const scratch = new Client({ connectionString: scratchUrl });
  await scratch.connect();
  for (const migration of readdirSync(MIGRATIONS)
    .filter((name) => /^\d/.test(name))
    .sort()) {
    await scratch.query(readFileSync(join(MIGRATIONS, migration, 'migration.sql'), 'utf-8'));
  }
  await scratch.end();

  const one = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
  const two = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
  const asService = (client: PrismaClient): PrismaService => client as unknown as PrismaService;
  const features = { features: { monetization: false, analytics: true } } as FeaturesService;
  const geo = { countryOf: () => 'FR' } as unknown as GeoIpService;
  const presence = {
    countsByKind: () => ({ IDLE: 0, PLAYING: 0, BUILDING: 0, HOSTING: 0 }),
  } as unknown as PresenceService;

  const services = (client: PrismaClient): Services => {
    const tally = new AnalyticsTallyService(asService(client));
    const erasure = new AnalyticsErasureService(asService(client));
    return {
      tally,
      erasure,
      ingest: new AnalyticsIngestService(
        asService(client),
        features,
        geo,
        new PublishedReleasesService(asService(client)),
        tally,
      ),
      finalize: new AnalyticsFinalizeService(asService(client)),
      projection: new AnalyticsProjectionService(asService(client)),
      purge: new AnalyticsPurgeService(asService(client)),
      query: new AnalyticsQueryService(asService(client), presence),
      sampler: new AnalyticsSamplerService(asService(client), presence, features),
      facts: new AnalyticsFactService(),
      multiplayer: new MultiplayerAccountingService(asService(client)),
    };
  };
  const a = services(one);
  const b = services(two);

  const reset = async (): Promise<void> => {
    const tables = await one.$queryRaw<{ name: string }[]>`
      SELECT tablename AS name FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await one.$executeRawUnsafe(
      `TRUNCATE ${tables.map((table) => `"${table.name}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  };
  const user = async (name: string): Promise<number> =>
    (await one.user.create({ data: { email: `${name}@test.invalid`, username: name } })).id;
  const release = async (owner: number): Promise<number> =>
    (
      await one.project.create({
        data: {
          name: 'Game',
          shortDesc: 'x',
          userId: owner,
          publishedAt: at('2026-01-01T00:00:00Z'),
        },
      })
    ).id;
  const rollup = async (
    metric: string,
    grain: 'DAY' | 'WEEK',
    day: string,
    dimension = '',
  ): Promise<number | null> =>
    (
      await one.analyticsRollup.findFirst({
        where: { metric, grain, periodStart: at(`${day}T00:00:00Z`), dimension },
        select: { value: true },
      })
    )?.value ?? null;
  const beat = (
    visitorId: string,
    sessionId: string,
    now: Date,
    extra: Partial<Parameters<AnalyticsIngestService['recordBeat']>[0]> = {},
  ): Promise<AnalyticsRotationDto> =>
    a.ingest.recordBeat(
      { visitorId, sessionId, state: AnalyticsLiveState.BROWSING, ...extra },
      BROWSER,
      now,
    );

  const scenarios: [string, () => Promise<void>][] = [
    [
      '1 same visitor on Mon, Wed and Fri',
      async () => {
        const visitor = uuid();
        for (const day of ['2026-09-07', '2026-09-09', '2026-09-11']) {
          await beat(visitor, uuid(), at(`${day}T10:00:00Z`));
        }
        await a.finalize.finalizeDue(at('2026-09-16T02:00:00Z'));
        expectEqual('Monday visitors', await rollup('visitors', 'DAY', '2026-09-07'), 1);
        expectEqual('Wednesday visitors', await rollup('visitors', 'DAY', '2026-09-09'), 1);
        expectEqual('week visitors', await rollup('visitors', 'WEEK', '2026-09-07'), 1);
        const cohort = await one.analyticsCohort.findFirst({
          where: { kind: 'VISITOR', cohortDay: at('2026-09-07T00:00:00Z'), offsetDays: 1 },
        });
        expectEqual('Monday D1', [cohort?.size, cohort?.retained], [1, 0]);
      },
    ],
    [
      '2 a paused play across midnight',
      async () => {
        const game = await release(await user('owner2'));
        const [visitor, session, play] = [uuid(), uuid(), uuid()];
        const report = (activeMs: number): AnalyticsPlayReportDto => ({
          playId: play,
          releaseId: game,
          continued: false,
          activeMs,
        });
        await a.ingest.recordPlay(
          { visitorId: visitor, sessionId: session, phase: 'START', play: report(0) },
          BROWSER,
          at('2026-09-07T23:58:00Z'),
        );
        await beat(visitor, session, at('2026-09-07T23:58:40Z'), { play: report(40_000) });
        await beat(visitor, session, at('2026-09-08T00:00:10Z'), { play: report(70_000) });
        const days = await one.analyticsPlayDay.findMany({ orderBy: { day: 'asc' } });
        expectEqual(
          'credit per receipt day',
          days.map((day) => Number(day.activeMs)),
          [40_000, 30_000],
        );
        await a.finalize.finalizeDue(at('2026-09-10T02:00:00Z'));
        expectEqual(
          'plays on the first day only',
          [await rollup('plays', 'DAY', '2026-09-07'), await rollup('plays', 'DAY', '2026-09-08')],
          [1, 0],
        );
      },
    ],
    [
      '3 a 20 s anonymous play ended by a FLUSH ping',
      async () => {
        const game = await release(await user('owner3'));
        const now = at('2026-09-07T12:00:00Z');
        await a.ingest.recordPing(
          { kind: 'PLAY_START', state: 'PLAYING', signedIn: false, releaseId: game },
          BROWSER,
          now,
        );
        await a.ingest.recordPing(
          { kind: 'FLUSH', state: 'PLAYING', signedIn: false, releaseId: game, playMs: 20_000 },
          BROWSER,
          at('2026-09-07T12:00:20Z'),
        );
        await a.tally.flush();
        await a.finalize.finalizeDue(at('2026-09-09T02:00:00Z'));
        expectEqual('plays', await rollup('plays', 'DAY', '2026-09-07'), 1);
        expectEqual('playtime', await rollup('playtime_ms', 'DAY', '2026-09-07'), 20_000);
        expectEqual('no visitor stored', await one.analyticsVisitor.count(), 0);
      },
    ],
    [
      '4 progress 30, 30, 20, 50 s with the 20 last',
      async () => {
        const game = await release(await user('owner4'));
        const [visitor, session, play] = [uuid(), uuid(), uuid()];
        const report = (activeMs: number): AnalyticsPlayReportDto => ({
          playId: play,
          releaseId: game,
          continued: false,
          activeMs,
          startAgeMs: 0,
        });
        const t0 = at('2026-09-07T12:00:00Z').getTime();
        await a.ingest.recordPlay(
          { visitorId: visitor, sessionId: session, phase: 'START', play: report(0) },
          BROWSER,
          new Date(t0),
        );
        await beat(visitor, session, new Date(t0 + 30_000), { play: report(30_000) });
        await beat(visitor, session, new Date(t0 + 31_000), { play: report(30_000) });
        await beat(visitor, session, new Date(t0 + 50_000), { play: report(50_000) });
        await beat(visitor, session, new Date(t0 + 51_000), { play: report(20_000) });
        const stored = await one.analyticsPlay.findUnique({ where: { id: play } });
        const credited = await one.analyticsPlayDay.aggregate({ _sum: { activeMs: true } });
        expectEqual('activeMs', Number(stored?.activeMs), 50_000);
        expectEqual('play-day sum', Number(credited._sum.activeMs), 50_000);
      },
    ],
    [
      '5 consent granted mid-play',
      async () => {
        const game = await release(await user('owner5'));
        const t0 = at('2026-09-07T12:00:00Z').getTime();
        await a.ingest.recordPing(
          { kind: 'PLAY_START', state: 'PLAYING', signedIn: false, releaseId: game },
          BROWSER,
          new Date(t0),
        );
        await a.ingest.recordPing(
          { kind: 'FLUSH', state: 'PLAYING', signedIn: false, releaseId: game, playMs: 10_000 },
          BROWSER,
          new Date(t0 + 10_000),
        );
        const [visitor, session, play] = [uuid(), uuid(), uuid()];
        const report = (activeMs: number): AnalyticsPlayReportDto => ({
          playId: play,
          releaseId: game,
          continued: true,
          activeMs,
          startAgeMs: 0,
        });
        await a.ingest.recordPlay(
          { visitorId: visitor, sessionId: session, phase: 'START', play: report(0) },
          BROWSER,
          new Date(t0 + 10_000),
        );
        await beat(visitor, session, new Date(t0 + 30_000), { play: report(20_000) });
        await a.tally.flush();
        await a.finalize.finalizeDue(at('2026-09-09T02:00:00Z'));
        expectEqual('one play', await rollup('plays', 'DAY', '2026-09-07'), 1);
        expectEqual(
          'playtime, both modes',
          await rollup('playtime_ms', 'DAY', '2026-09-07'),
          30_000,
        );
      },
    ],
    [
      '6 withdrawal with a 120 s update in flight',
      async () => {
        const game = await release(await user('owner6'));
        const t0 = at('2026-09-07T12:00:00Z').getTime();
        const run = async (lateCommit: boolean): Promise<number> => {
          const [visitor, session, play] = [uuid(), uuid(), uuid()];
          const report = (activeMs: number): AnalyticsPlayReportDto => ({
            playId: play,
            releaseId: game,
            continued: false,
            activeMs,
            startAgeMs: 0,
          });
          await a.ingest.recordPlay(
            { visitorId: visitor, sessionId: session, phase: 'START', play: report(0) },
            BROWSER,
            new Date(t0),
          );
          await beat(visitor, session, new Date(t0 + 60_000), { play: report(60_000) });
          // Withdrawn at 125 s: the client sends what passed since its dispatched watermark, 120 s.
          await a.ingest.recordPing(
            { kind: 'FLUSH', state: 'PLAYING', signedIn: false, releaseId: game, playMs: 5_000 },
            BROWSER,
            new Date(t0 + 125_000),
          );
          if (lateCommit) {
            await beat(visitor, session, new Date(t0 + 126_000), { play: report(120_000) });
          }
          const stored = await one.analyticsPlay.findUnique({ where: { id: play } });
          return Number(stored?.activeMs);
        };
        const committed = await run(true);
        const failed = await run(false);
        await a.tally.flush();
        const anonymous = await one.analyticsAnonTally.aggregate({ _sum: { playMs: true } });
        expectEqual('late commit, consented part', committed, 120_000);
        expectEqual('failure, consented part', failed, 60_000);
        expectEqual('anonymous part of each', Number(anonymous._sum.playMs), 10_000);
      },
    ],
    [
      '7 a session from Mon 23:50 to Tue 02:00 with a play at 01:30',
      async () => {
        const game = await release(await user('owner7'));
        const [visitor, session] = [uuid(), uuid()];
        for (let minute = 0; minute <= 130; minute += 10) {
          const now = new Date(at('2026-09-07T23:50:00Z').getTime() + minute * 60_000);
          const play =
            minute === 100
              ? { playId: uuid(), releaseId: game, continued: false, activeMs: 0, startAgeMs: 0 }
              : undefined;
          await beat(visitor, session, now, play ? { play } : {});
        }
        await a.finalize.finalizeDue(at('2026-09-08T01:06:00Z'));
        const statusAt = async (metric: string): Promise<string | null> =>
          (
            await one.analyticsRollupStatus.findFirst({
              where: { metric, grain: 'DAY', periodStart: at('2026-09-07T00:00:00Z') },
            })
          )?.status ?? null;
        expectEqual('Monday activity final Tue 01:05', await statusAt('visitors'), 'FINAL');
        expectEqual('Monday sessions not final yet', await statusAt('sessions'), null);
        await a.finalize.finalizeDue(at('2026-09-09T01:06:00Z'));
        expectEqual('Monday sessions final Wed 01:05', await statusAt('sessions'), 'FINAL');
        expectEqual('one session', await rollup('sessions', 'DAY', '2026-09-07'), 1);
        expectEqual('not bounced', await rollup('sessions_bounced', 'DAY', '2026-09-07'), 0);
        expectEqual(
          '130 minutes long',
          await rollup('session_seconds_total', 'DAY', '2026-09-07'),
          7_800,
        );
      },
    ],
    [
      '8 activity before a late link survives the raw purge',
      async () => {
        const account = await user('late');
        const visitor = uuid();
        const now = at('2026-10-08T12:00:00Z');
        await beat(visitor, uuid(), at('2026-06-01T10:00:00Z'));
        await a.finalize.finalizeDue(now);
        expectEqual('link', (await a.ingest.link(account, visitor, now)).status, 'linked');
        expectEqual('projected', await a.projection.project(visitor, account), 'projected');
        expectEqual('purge', await a.purge.purgeDay('2026-06-01'), 'purged');
        const history = await one.analyticsUserDaily.findMany({ where: { userId: account } });
        expectEqual(
          'history kept',
          history.map((row) => [row.day.toISOString().slice(0, 10), row.activeMinutes]),
          [['2026-06-01', 1]],
        );
        expectEqual('raw gone', await one.analyticsSessionDay.count(), 0);
      },
    ],
    [
      '9 projection down for days while finalization goes on',
      async () => {
        const account = await user('outage');
        const visitor = uuid();
        const now = at('2026-10-08T12:00:00Z');
        await a.ingest.link(account, visitor, at('2026-06-01T09:00:00Z'));
        await one.analyticsProjectionWork.deleteMany({});
        for (const day of ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']) {
          await beat(visitor, uuid(), at(`${day}T10:00:00Z`));
        }
        await a.finalize.finalizeDue(now);
        expectEqual('purge held', await a.purge.purgeDay('2026-06-01'), 'not-projected');
        expectEqual('scan queues it', await a.projection.recoveryScan(now), 1);
        await a.projection.processDue(now);
        expectEqual(
          'five days projected',
          await one.analyticsUserDaily.count({ where: { userId: account } }),
          5,
        );
        expectEqual('purge then', await a.purge.purgeDay('2026-06-01'), 'purged');
      },
    ],
    [
      '10 two tabs in one minute, PLAYING and BROWSING',
      async () => {
        const game = await release(await user('owner10'));
        const [visitor, session] = [uuid(), uuid()];
        await beat(visitor, session, at('2026-09-07T12:00:10Z'), {
          state: AnalyticsLiveState.PLAYING,
          releaseId: game,
        });
        await beat(visitor, session, at('2026-09-07T12:00:40Z'));
        const live = await one.analyticsLiveMinute.findMany();
        expectEqual(
          'one browser, PLAYING its game',
          live.map((row) => [row.state, row.releaseId]),
          [['PLAYING', game]],
        );
        const [minutes] = await one.$queryRaw<
          [{ active: number }]
        >`SELECT bit_count("activeBits")::int AS active FROM "AnalyticsSessionDay"`;
        expectEqual('one active minute', minutes.active, 1);
      },
    ],
    [
      '11 a page view for 12:01 after a beat for 12:02',
      async () => {
        const [visitor, session] = [uuid(), uuid()];
        await beat(visitor, session, at('2026-09-07T12:02:05Z'));
        await a.ingest.recordEvents(
          {
            visitorId: visitor,
            sessionId: session,
            events: [{ eventId: uuid(), type: 'PAGE_VIEW', ageMs: 60_000, route: 'hub' }],
          },
          BROWSER,
          at('2026-09-07T12:02:10Z'),
        );
        const [minutes] = await one.$queryRaw<
          [{ active: number }]
        >`SELECT bit_count("activeBits")::int AS active FROM "AnalyticsSessionDay"`;
        expectEqual('both minutes counted', minutes.active, 2);
      },
    ],
    [
      '13 erase on one device while another holds a linked visitor',
      async () => {
        const account = await user('devices');
        const [deviceA, deviceB] = [uuid(), uuid()];
        const now = at('2026-09-07T12:00:00Z');
        await a.ingest.link(account, deviceA, now);
        await a.ingest.link(account, deviceB, now);
        await a.erasure.erase(account);
        const answer = await beat(deviceB, uuid(), now);
        expectEqual('device B told to rotate', answer.rotateVisitor, true);
        expectEqual(
          'fresh id relinks',
          (await a.ingest.link(account, uuid(), now)).status,
          'linked',
        );
      },
    ],
    [
      '14 erase waits for an ingest holding the visitor lock',
      async () => {
        const account = await user('racer');
        const visitor = uuid();
        const now = at('2026-09-07T12:00:00Z');
        await a.ingest.link(account, visitor, now);
        const held = holdOpen(one, (tx) => lockVisitors(tx, [visitor], 'shared'));
        await held.ready;
        const erasing = b.erasure.erase(account);
        expectEqual('erase blocked', await settlesWithin(erasing, 300), false);
        held.release();
        await held.done;
        await erasing;
        expectEqual('old id refused', (await beat(visitor, uuid(), now)).rotateVisitor, true);
        expectEqual(
          'not recreated',
          await one.analyticsVisitor.count({ where: { id: visitor } }),
          0,
        );
      },
    ],
    [
      '15 a release view resolving the account while erase starts',
      async () => {
        const account = await user('viewer');
        const game = await release(account);
        const visitor = uuid();
        const now = at('2026-09-07T12:00:00Z');
        await a.ingest.link(account, visitor, now);
        const held = holdOpen(one, async (tx) => {
          await lockVisitors(tx, [visitor], 'shared');
          await tx.releaseView.create({
            data: {
              projectId: game,
              viewerKey: `u:${String(account)}`,
              day: at('2026-09-07T00:00:00Z'),
            },
          });
        });
        await held.ready;
        const erasing = b.erasure.erase(account);
        expectEqual('erase blocked', await settlesWithin(erasing, 300), false);
        held.release();
        await held.done;
        await erasing;
        expectEqual('no view key left', await one.releaseView.count(), 0);
      },
    ],
    [
      '16 links of an old and of a fresh visitor around an erase',
      async () => {
        const account = await user('linker');
        const [old, fresh] = [uuid(), uuid()];
        const now = at('2026-09-07T12:00:00Z');
        await a.ingest.link(account, old, now);
        await a.erasure.erase(account);
        expectEqual('old after erase', (await a.ingest.link(account, old, now)).status, 'erased');
        expectEqual(
          'fresh after erase',
          (await a.ingest.link(account, fresh, now)).status,
          'linked',
        );
        expectEqual(
          'fresh linked',
          (await one.analyticsVisitor.findUnique({ where: { id: fresh } }))?.userId,
          account,
        );
      },
    ],
    [
      '17 erase removes the account and visitor view keys, not the counters',
      async () => {
        const account = await user('keys');
        const game = await release(account);
        const visitor = uuid();
        await a.ingest.link(account, visitor, at('2026-09-07T12:00:00Z'));
        await one.releaseView.createMany({
          data: [
            { projectId: game, viewerKey: `u:${String(account)}`, day: at('2026-09-06T00:00:00Z') },
            { projectId: game, viewerKey: `v:${visitor}`, day: at('2026-09-07T00:00:00Z') },
            { projectId: game, viewerKey: 'v:someone-else', day: at('2026-09-07T00:00:00Z') },
          ],
        });
        await one.project.update({ where: { id: game }, data: { viewCount: 3, uniquePlayers: 2 } });
        await a.erasure.erase(account);
        expectEqual(
          'only the other key left',
          (await one.releaseView.findMany()).map((row) => row.viewerKey),
          ['v:someone-else'],
        );
        const counters = await one.project.findUnique({
          where: { id: game },
          select: { viewCount: true, uniquePlayers: true },
        });
        expectEqual('counters unchanged', counters, { viewCount: 3, uniquePlayers: 2 });
      },
    ],
    [
      '19 a start lost and 30 minutes of progress lost, then the first report',
      async () => {
        const game = await release(await user('owner19'));
        const [visitor, session, play] = [uuid(), uuid(), uuid()];
        const t0 = at('2026-09-07T12:30:00Z').getTime();
        const report = (activeMs: number, startAgeMs: number): AnalyticsPlayReportDto => ({
          playId: play,
          releaseId: game,
          continued: false,
          activeMs,
          startAgeMs,
        });
        await beat(visitor, session, new Date(t0), { play: report(1_800_000, 1_800_000) });
        const first = await one.analyticsPlay.findUnique({ where: { id: play } });
        expectEqual('credited what could be verified', Number(first?.activeMs), 905_000);
        expectEqual('the rest kept aside', Number(first?.baselineMs), 895_000);
        await beat(visitor, session, new Date(t0 + 45_000), { play: report(1_845_000, 1_845_000) });
        const next = await one.analyticsPlay.findUnique({ where: { id: play } });
        expectEqual('later progress credited normally', Number(next?.activeMs), 950_000);
      },
    ],
    [
      '20 a multiplayer checkpoint retried after its acknowledgement was lost',
      async () => {
        const game = await release(await user('owner20'));
        const room = uuid();
        const t0 = at('2026-09-07T12:00:00Z').getTime();
        await a.multiplayer.roomCreated(room, game, false);
        a.multiplayer.seatConnected(room, 1, t0);
        a.multiplayer.seatConnected(room, 2, t0);
        a.multiplayer.checkpointAll(t0 + 60_000);
        await a.multiplayer.settled();
        // The same totals written again, as a retry would.
        a.multiplayer.checkpointAll(t0 + 60_000);
        await a.multiplayer.settled();
        const day = await one.analyticsMpDay.findFirst({ where: { sessionId: room } });
        expectEqual(
          'credited once',
          [Number(day?.multiMs), Number(day?.playerMs)],
          [60_000, 120_000],
        );
      },
    ],
    [
      '21 an editor self-join after the room was classified',
      async () => {
        const game = await release(await user('owner21'));
        const room = uuid();
        await a.multiplayer.roomCreated(room, game, false);
        a.multiplayer.seatConnected(room, 1, at('2026-09-07T12:00:00Z').getTime());
        await a.multiplayer.settled();
        await a.multiplayer.editorJoined(room);
        expectEqual(
          'still a real game',
          (await one.analyticsMpSession.findUnique({ where: { id: room } }))?.editorTest,
          false,
        );
      },
    ],
    [
      '22 a project deleted before its day is finalized',
      async () => {
        const owner = await user('owner22');
        const game = await one.project.create({
          data: { name: 'Doomed', shortDesc: 'x', userId: owner },
        });
        await one.$transaction((tx) =>
          a.facts.record(tx, {
            type: 'PROJECT_CREATED',
            dedupeKey: `project:${String(game.id)}`,
            actorUserId: owner,
            projectId: game.id,
          }),
        );
        await one.analyticsFact.updateMany({ data: { at: at('2026-09-07T12:00:00Z') } });
        await one.project.delete({ where: { id: game.id } });
        await a.finalize.finalizeDue(at('2026-09-09T02:00:00Z'));
        expectEqual('still counted', await rollup('projects_created', 'DAY', '2026-09-07'), 1);
      },
    ],
    [
      '23 the sampler runs after another instance flushed late',
      async () => {
        const minute = at('2026-09-07T12:00:00Z');
        await b.ingest.recordPing(
          { kind: 'BEAT', state: 'BROWSING', signedIn: false },
          BROWSER,
          new Date(minute.getTime() + 20_000),
        );
        await b.tally.flush();
        await a.sampler.sample(minute);
        expectEqual(
          'anonymous tab included',
          (await one.concurrencySample.findUnique({ where: { at: minute } }))?.anonTabs,
          1,
        );
      },
    ],
    [
      '24 an observed zero against data gone before it was finalized',
      async () => {
        await beat(uuid(), uuid(), at('2026-09-07T10:00:00Z'));
        const now = at('2026-09-10T12:00:00Z');
        await a.finalize.finalizeDue(now);
        const zero = await a.query.pointOf('visitors', '', periodOf('DAY', '2026-09-08'), now);
        const gone = await a.query.pointOf('visitors', '', periodOf('DAY', '2026-05-01'), now);
        expectEqual('observed zero', [zero.value, zero.status], [0, 'final']);
        expectEqual('never computed', [gone.value, gone.status], [null, 'unavailable']);
      },
    ],
    [
      '25 120 referrers in one day',
      async () => {
        for (let i = 0; i < 120; i++) {
          await a.ingest.recordEvents(
            {
              visitorId: uuid(),
              sessionId: uuid(),
              context: { referrer: `https://site-${String(i)}.example/x` },
              events: [],
            },
            BROWSER,
            at('2026-09-07T10:00:00Z'),
          );
        }
        await a.finalize.finalizeDue(at('2026-09-10T02:00:00Z'));
        const referrers = await one.analyticsRollup.count({
          where: { metric: 'sessions', grain: 'DAY', dimension: { startsWith: 'referrer:' } },
        });
        expectEqual('top 100 and (other)', referrers, 101);
        expectEqual(
          '(other) holds the rest',
          await rollup('sessions', 'DAY', '2026-09-07', 'referrer:(other)'),
          20,
        );
      },
    ],
    [
      '27 a browser returning on day 100 with a valid cookie',
      async () => {
        const account = await user('returner');
        const visitor = uuid();
        await a.ingest.link(account, visitor, at('2026-06-01T10:00:00Z'));
        await one.analyticsVisitor.update({
          where: { id: visitor },
          data: { firstSeenAt: at('2026-06-01T10:00:00Z'), lastSeenAt: at('2026-06-01T10:00:00Z') },
        });
        await a.purge.expireVisitors(at('2026-09-09T10:00:00Z'));
        const answer = await beat(visitor, uuid(), at('2026-09-09T10:00:00Z'));
        const row = await one.analyticsVisitor.findUnique({ where: { id: visitor } });
        expectEqual('accepted', answer.rotateVisitor, false);
        expectEqual(
          'same first sight, link kept',
          [row?.firstSeenAt.toISOString(), row?.userId],
          ['2026-06-01T10:00:00.000Z', account],
        );
      },
    ],
    [
      '28 a first beat of 45 s twice, and a first END, without START',
      async () => {
        const game = await release(await user('owner28'));
        const now = at('2026-09-07T12:00:00Z');
        const [visitor, session] = [uuid(), uuid()];
        const [byBeat, byEnd] = [uuid(), uuid()];
        const report = (playId: string): AnalyticsPlayReportDto => ({
          playId,
          releaseId: game,
          continued: false,
          activeMs: 45_000,
        });
        await beat(visitor, session, now, { play: report(byBeat) });
        await beat(visitor, session, now, { play: report(byBeat) });
        await a.ingest.recordPlay(
          { visitorId: visitor, sessionId: session, phase: 'END', play: report(byEnd) },
          BROWSER,
          now,
        );
        await a.ingest.recordPlay(
          { visitorId: visitor, sessionId: session, phase: 'END', play: report(byEnd) },
          BROWSER,
          now,
        );
        const credited = await one.analyticsPlayDay.findMany({ orderBy: { playId: 'asc' } });
        expectEqual(
          '45 s each, once',
          credited.map((day) => Number(day.activeMs)),
          [45_000, 45_000],
        );
      },
    ],
    [
      '29 a fact racing an account deletion, and one after an analytics erasure',
      async () => {
        const deleted = await user('gone');
        const erased = await user('erased');
        await one.user.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
        await a.erasure.erase(erased);
        for (const [actor, key] of [
          [deleted, 'a'],
          [erased, 'b'],
        ] as const) {
          await one.$transaction((tx) =>
            a.facts.record(tx, {
              type: 'PROJECT_CREATED',
              dedupeKey: `project:${key}`,
              actorUserId: actor,
            }),
          );
        }
        const actors = await one.analyticsFact.findMany({
          orderBy: { dedupeKey: 'asc' },
          select: { actorUserId: true },
        });
        expectEqual(
          'deleted: no actor; erased: actor kept',
          actors.map((fact) => fact.actorUserId),
          [null, erased],
        );
      },
    ],
    [
      '30 a purge and a link of a visitor active that day, in both orders',
      async () => {
        const now = at('2026-10-08T12:00:00Z');
        const [linkedFirst, purgedFirst] = [uuid(), uuid()];
        await beat(linkedFirst, uuid(), at('2026-06-01T10:00:00Z'));
        await beat(purgedFirst, uuid(), at('2026-06-01T11:00:00Z'));
        await a.finalize.finalizeDue(now);

        // A link that lands first is seen by the purge, which keeps the day.
        await a.ingest.link(await user('first'), linkedFirst, now);
        expectEqual('link first: day kept', await b.purge.purgeDay('2026-06-01'), 'not-projected');

        // A purge holding the gate makes a link wait until it is done.
        const purging = holdOpen(one, (tx) => lockPurgeGate(tx, 'exclusive'));
        await purging.ready;
        const linking = b.ingest.link(await user('second'), purgedFirst, now);
        expectEqual('purge first: the link waits', await settlesWithin(linking, 300), false);
        purging.release();
        await purging.done;
        expectEqual('then the link lands', (await linking).status, 'linked');
      },
    ],
  ];

  for (const [name, scenario] of scenarios) {
    currentScenario = name;
    await reset();
    try {
      await scenario();
    } catch (error) {
      checks.push({ scenario: name, name: 'ran', ok: false, detail: String(error) });
    }
  }

  await one.$disconnect();
  await two.$disconnect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.end();

  const failed = checks.filter((check) => !check.ok);
  for (const [name] of scenarios) {
    const mine = checks.filter((check) => check.scenario === name);
    const bad = mine.filter((check) => !check.ok);
    console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'}  ${name}`);
    for (const check of bad) {
      console.log(`        ${check.name}: ${check.detail}`);
    }
  }
  console.log(
    `\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed. ` +
      'Not here: cross-tab account switching (client logic, frontend specs), release transitions ' +
      '(project-content specs), the keyless view limit (its spec).',
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
