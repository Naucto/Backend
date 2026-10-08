import { AnalyticsLiveState } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { AnalyticsIngestService, IngestRequest } from './analytics-ingest.service';
import { AnalyticsTallyService } from './analytics-tally.service';
import { MINUTE_MS, SESSION_MAX_MS, VISITOR_COOKIE_MS } from './analytics-time';
import { AnalyticsPlayReportDto } from './dto/analytics-ingest.dto';
import { GeoIpService } from './geo-ip.service';
import { PublishedReleasesService } from './published-releases.service';

const VISITOR = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const PLAY = '33333333-3333-4333-8333-333333333333';
const NOW = new Date(Date.UTC(2026, 9, 8, 12, 0, 0));
const BROWSER: IngestRequest = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  ip: '203.0.113.9',
  acceptLanguage: 'fr-FR,fr;q=0.9',
};
const BOT: IngestRequest = { ...BROWSER, userAgent: 'Googlebot/2.1' };

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

type MockTx = {
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  analyticsVisitorTombstone: { findUnique: jest.Mock };
  analyticsVisitor: {
    createMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  analyticsSession: { createMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  analyticsPageView: { createManyAndReturn: jest.Mock };
  analyticsPlay: { createMany: jest.Mock; update: jest.Mock };
  analyticsProjectionWork: { createMany: jest.Mock };
};

describe('AnalyticsIngestService', () => {
  let tx: MockTx;
  let prisma: { $transaction: jest.Mock };
  let features: { features: { monetization: boolean; analytics: boolean } };
  let releases: { isPublished: jest.Mock };
  let tally: { count: jest.Mock; recordPing: jest.Mock };
  let geo: { countryOf: jest.Mock };
  let service: AnalyticsIngestService;

  function makeTx(): MockTx {
    return {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      analyticsVisitorTombstone: { findUnique: jest.fn() },
      analyticsVisitor: {
        createMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      analyticsSession: { createMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      analyticsPageView: { createManyAndReturn: jest.fn() },
      analyticsPlay: { createMany: jest.fn(), update: jest.fn() },
      analyticsProjectionWork: { createMany: jest.fn() },
    };
  }

  /** A known visitor first seen `visitorAge` ago, and a session with the given timings. */
  function given({
    visitorAge = MINUTE_MS,
    sessionOwner = VISITOR,
    startedAgo = 5 * MINUTE_MS,
    lastSeenAgo = MINUTE_MS,
    closedAt = null as Date | null,
  } = {}): void {
    tx.analyticsVisitorTombstone.findUnique.mockResolvedValue(null);
    tx.analyticsVisitor.findUnique.mockResolvedValue({
      firstSeenAt: ago(visitorAge),
      userId: null,
    });
    tx.analyticsSession.findUnique.mockResolvedValue({
      visitorId: sessionOwner,
      startedAt: ago(startedAgo),
      lastSeenAt: ago(lastSeenAgo),
      closedAt,
    });
  }

  /** The play row the progress statement reads back. */
  function playRow(row: Partial<Record<string, unknown>> = {}): void {
    tx.$queryRaw.mockResolvedValue([
      {
        sessionId: SESSION,
        startedAt: ago(45_000),
        lastSeenAt: NOW,
        activeMs: 0n,
        baselineMs: 0n,
        endedAt: null,
        ...row,
      },
    ]);
  }

  const playUpdate = (): Record<string, unknown> =>
    (tx.analyticsPlay.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;

  const creditedToDay = (): number[] =>
    tx.$executeRaw.mock.calls
      .filter((call) => sqlOf(call).includes('INSERT INTO "AnalyticsPlayDay"'))
      .map((call) => call[3] as number);

  beforeEach(() => {
    tx = makeTx();
    prisma = { $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)) };
    features = { features: { monetization: false, analytics: true } };
    releases = { isPublished: jest.fn().mockResolvedValue(true) };
    tally = { count: jest.fn(), recordPing: jest.fn() };
    geo = { countryOf: jest.fn().mockReturnValue('FR') };
    service = new AnalyticsIngestService(
      prisma as unknown as PrismaService,
      features as unknown as FeaturesService,
      geo as unknown as GeoIpService,
      releases as unknown as PublishedReleasesService,
      tally as unknown as AnalyticsTallyService,
    );
    given();
    tx.analyticsPlay.createMany.mockResolvedValue({ count: 0 });
  });

  describe('admission', () => {
    it('stores nothing and tells the client to stop while analytics is off', async () => {
      features.features.analytics = false;

      const answer = await service.recordBeat(
        { visitorId: VISITOR, sessionId: SESSION, state: AnalyticsLiveState.BROWSING },
        BROWSER,
        NOW,
      );

      expect(answer.disabled).toBe(true);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('stores nothing from a bot', async () => {
      await service.recordBeat(
        { visitorId: VISITOR, sessionId: SESSION, state: AnalyticsLiveState.BROWSING },
        BOT,
        NOW,
      );
      await service.recordPing({ kind: 'BEAT', state: 'BROWSING', signedIn: false }, BOT, NOW);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tally.recordPing).not.toHaveBeenCalled();
    });
  });

  describe('visitor and session checks', () => {
    const beat = (): ReturnType<AnalyticsIngestService['recordBeat']> =>
      service.recordBeat(
        { visitorId: VISITOR, sessionId: SESSION, state: AnalyticsLiveState.BROWSING },
        BROWSER,
        NOW,
      );

    it('holds the visitor lock shared before reading anything', async () => {
      await beat();

      expect(sqlOf(tx.$executeRaw.mock.calls[0] ?? [])).toContain('pg_advisory_xact_lock_shared(');
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.analyticsVisitorTombstone.findUnique.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('refuses an erased visitor without writing, so nothing queued recreates it', async () => {
      tx.analyticsVisitorTombstone.findUnique.mockResolvedValue({ id: VISITOR });

      expect(await beat()).toEqual({ rotateVisitor: true, rotateSession: true, disabled: false });
      expect(tx.analyticsVisitor.createMany).not.toHaveBeenCalled();
    });

    it('refuses a visitor whose cookie should have expired', async () => {
      given({ visitorAge: VISITOR_COOKIE_MS + 1 });

      expect((await beat()).rotateVisitor).toBe(true);
      expect(tx.analyticsSession.createMany).not.toHaveBeenCalled();
    });

    it("refuses another visitor's session", async () => {
      given({ sessionOwner: '44444444-4444-4444-8444-444444444444' });

      expect(await beat()).toEqual({ rotateVisitor: false, rotateSession: true, disabled: false });
    });

    it('closes an idle session at its last activity and asks for a new one', async () => {
      given({ lastSeenAgo: 36 * MINUTE_MS });

      expect((await beat()).rotateSession).toBe(true);
      expect(tx.analyticsSession.update).toHaveBeenCalledWith({
        where: { id: SESSION },
        data: { closedAt: ago(36 * MINUTE_MS) },
      });
    });

    it('closes a session at its twelve-hour cap', async () => {
      given({ startedAgo: SESSION_MAX_MS + MINUTE_MS, lastSeenAgo: 1_000 });

      expect((await beat()).rotateSession).toBe(true);
      expect(tx.analyticsSession.update).toHaveBeenCalledWith({
        where: { id: SESSION },
        data: { closedAt: ago(MINUTE_MS) },
      });
    });

    it('opens a session with the request context, bucketed', async () => {
      await service.recordEvents(
        {
          visitorId: VISITOR,
          sessionId: SESSION,
          context: {
            referrer: 'https://www.reddit.com/r/x',
            utmSource: 'Reddit',
            viewportWidth: 1280,
          },
          events: [],
        },
        BROWSER,
        NOW,
      );

      expect(tx.analyticsSession.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: SESSION,
            visitorId: VISITOR,
            referrerDomain: 'reddit.com',
            utmSource: 'reddit',
            device: 'desktop',
            browser: 'Chrome',
            os: 'Windows',
            country: 'FR',
            screen: 'lg',
            language: 'fr',
          }),
        ],
        skipDuplicates: true,
      });
      expect(geo.countryOf).toHaveBeenCalledWith('203.0.113.9');
    });
  });

  describe('page views', () => {
    const view = (
      eventId: string,
      ageMs: number,
    ): {
      eventId: string;
      type: 'PAGE_VIEW';
      ageMs: number;
      route: string;
    } => ({ eventId, type: 'PAGE_VIEW', ageMs, route: 'hub' });

    it('rejects views reported too late and stores the rest at the time they happened', async () => {
      tx.analyticsPageView.createManyAndReturn.mockResolvedValue([{ occurredAt: ago(1_000) }]);

      const answer = await service.recordEvents(
        {
          visitorId: VISITOR,
          sessionId: SESSION,
          events: [view('a', 1_000), view('b', 16 * MINUTE_MS)],
        },
        BROWSER,
        NOW,
      );

      expect(answer.accepted).toEqual(['a']);
      expect(answer.rejected).toEqual([{ eventId: 'b', reason: 'too_old' }]);
      expect(tx.analyticsPageView.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ id: 'a', sessionId: SESSION, occurredAt: ago(1_000), route: 'hub' }],
          skipDuplicates: true,
        }),
      );
    });

    it('counts only the views this attempt inserted, so a retried batch adds nothing', async () => {
      tx.analyticsPageView.createManyAndReturn.mockResolvedValue([]);

      const answer = await service.recordEvents(
        { visitorId: VISITOR, sessionId: SESSION, events: [view('a', 0), view('b', 0)] },
        BROWSER,
        NOW,
      );

      expect(answer.accepted).toEqual(['a', 'b']);
      const dayWrites = tx.$executeRaw.mock.calls.filter((call) =>
        sqlOf(call).includes('INSERT INTO "AnalyticsSessionDay"'),
      );
      expect(dayWrites).toEqual([]);
    });
  });

  describe('plays', () => {
    const report = (
      activeMs: number,
      extra: Partial<AnalyticsPlayReportDto> = {},
    ): AnalyticsPlayReportDto => ({
      playId: PLAY,
      releaseId: 7,
      continued: false,
      activeMs,
      ...extra,
    });

    it('refuses a play of a game that is not published, before opening anything', async () => {
      releases.isPublished.mockResolvedValue(false);

      const answer = await service.recordPlay(
        { visitorId: VISITOR, sessionId: SESSION, phase: 'START', play: report(0) },
        BROWSER,
        NOW,
      );

      expect(answer.status).toBe('rejected');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('credits the first report of a play whose START was lost, up to the time since it began', async () => {
      tx.analyticsPlay.createMany.mockResolvedValue({ count: 1 });
      playRow({ startedAt: ago(45_000) });

      await service.recordBeat(
        {
          visitorId: VISITOR,
          sessionId: SESSION,
          state: AnalyticsLiveState.PLAYING,
          play: report(45_000, { startAgeMs: 45_000 }),
        },
        BROWSER,
        NOW,
      );

      expect(playUpdate()).toMatchObject({ activeMs: 45_000n, baselineMs: 0n });
      expect(creditedToDay()).toEqual([45_000]);
    });

    it('credits nothing for a report repeated or arriving after a later one', async () => {
      playRow({ activeMs: 50_000n });

      await service.recordPlay(
        { visitorId: VISITOR, sessionId: SESSION, phase: 'START', play: report(45_000) },
        BROWSER,
        NOW,
      );

      expect(playUpdate()).toMatchObject({ activeMs: 50_000n });
      expect(creditedToDay()).toEqual([]);
    });

    it('credits no more than could have passed, and never credits the excess later', async () => {
      playRow({ activeMs: 45_000n, lastSeenAt: ago(45_000), startedAt: ago(90_000) });

      await service.recordPlay(
        {
          visitorId: VISITOR,
          sessionId: SESSION,
          phase: 'END',
          endReason: 'leave',
          play: report(600_000),
        },
        BROWSER,
        NOW,
      );

      // 45 s credited before, 45 s since, plus 5 s of slack.
      expect(playUpdate()).toMatchObject({
        activeMs: 95_000n,
        baselineMs: 505_000n,
        endReason: 'leave',
        endedAt: NOW,
      });
      expect(creditedToDay()).toEqual([50_000]);
    });

    it('keeps the start of a known play when a report states no start age', async () => {
      playRow({ startedAt: ago(30_000), activeMs: 10_000n, lastSeenAt: ago(20_000) });

      await service.recordPlay(
        { visitorId: VISITOR, sessionId: SESSION, phase: 'END', play: report(600_000) },
        BROWSER,
        NOW,
      );

      expect(playUpdate()['startedAt']).toEqual(ago(30_000));
    });

    it('takes no progress once a play has ended', async () => {
      playRow({ endedAt: ago(1_000) });

      const answer = await service.recordPlay(
        { visitorId: VISITOR, sessionId: SESSION, phase: 'END', play: report(90_000) },
        BROWSER,
        NOW,
      );

      expect(answer.status).toBe('ended');
      expect(tx.analyticsPlay.update).not.toHaveBeenCalled();
    });

    it("refuses another session's play", async () => {
      playRow({ sessionId: '55555555-5555-4555-8555-555555555555' });

      const answer = await service.recordPlay(
        { visitorId: VISITOR, sessionId: SESSION, phase: 'START', play: report(1_000) },
        BROWSER,
        NOW,
      );

      expect(answer.status).toBe('rejected');
      expect(tx.analyticsPlay.update).not.toHaveBeenCalled();
    });
  });

  describe('beats', () => {
    it('keeps the highest state of the minute, and the game when a beat names none', async () => {
      await service.recordBeat(
        { visitorId: VISITOR, sessionId: SESSION, state: AnalyticsLiveState.BUILDING },
        BROWSER,
        NOW,
      );

      const live = tx.$executeRaw.mock.calls.find((call) =>
        sqlOf(call).includes('INSERT INTO "AnalyticsLiveMinute"'),
      );
      expect(sqlOf(live ?? [])).toContain('GREATEST');
      expect(sqlOf(live ?? [])).toContain('COALESCE(EXCLUDED."releaseId"');
      const day = tx.$executeRaw.mock.calls.find((call) =>
        sqlOf(call).includes('INSERT INTO "AnalyticsSessionDay"'),
      );
      expect(day).toContain(true);
    });

    it('records no game for a beat naming one that is not published', async () => {
      releases.isPublished.mockResolvedValue(false);

      await service.recordBeat(
        { visitorId: VISITOR, sessionId: SESSION, state: AnalyticsLiveState.PLAYING, releaseId: 9 },
        BROWSER,
        NOW,
      );

      const live = tx.$executeRaw.mock.calls.find((call) =>
        sqlOf(call).includes('INSERT INTO "AnalyticsLiveMinute"'),
      );
      expect(live).toContain(null);
    });
  });

  describe('anonymous pings', () => {
    it('tallies a ping without any identifier', async () => {
      await service.recordPing(
        { kind: 'BEAT', state: 'PLAYING', signedIn: false, releaseId: 7, playMs: 20_000 },
        BROWSER,
        NOW,
      );

      expect(tally.recordPing).toHaveBeenCalledWith(
        { kind: 'BEAT', state: 'PLAYING', signedIn: false, releaseId: 7, playMs: 20_000 },
        NOW,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('counts no running time against a game that is not published', async () => {
      releases.isPublished.mockResolvedValue(false);

      await service.recordPing(
        { kind: 'BEAT', state: 'PLAYING', signedIn: false, releaseId: 9, playMs: 20_000 },
        BROWSER,
        NOW,
      );

      expect(tally.recordPing).toHaveBeenCalledWith(
        expect.objectContaining({ releaseId: 0, playMs: 0 }),
        NOW,
      );
    });
  });

  describe('link', () => {
    it('locks the account, then the visitor, both exclusively', async () => {
      tx.analyticsVisitor.findUnique.mockResolvedValue(null);

      await service.link(5, VISITOR, NOW);

      const [account, visitor] = tx.$executeRaw.mock.calls;
      expect(sqlOf(account ?? [])).toContain('pg_advisory_xact_lock(');
      expect(account).toContain(5);
      expect(sqlOf(visitor ?? [])).toContain('pg_advisory_xact_lock(');
    });

    it('links an unlinked visitor and queues its history in the same transaction', async () => {
      tx.analyticsVisitor.findUnique.mockResolvedValue({
        userId: null,
        firstSeenAt: ago(MINUTE_MS),
      });

      expect(await service.link(5, VISITOR, NOW)).toEqual({ status: 'linked' });
      expect(tx.analyticsVisitor.update).toHaveBeenCalledWith({
        where: { id: VISITOR },
        data: { userId: 5, linkedAt: NOW },
      });
      expect(tx.analyticsProjectionWork.createMany).toHaveBeenCalledWith({
        data: [{ visitorId: VISITOR, userId: 5, enqueuedAt: NOW, nextAttemptAt: NOW }],
        skipDuplicates: true,
      });
    });

    it('creates a visitor first seen at its link', async () => {
      tx.analyticsVisitor.findUnique.mockResolvedValue(null);

      await service.link(5, VISITOR, NOW);

      expect(tx.analyticsVisitor.create).toHaveBeenCalledWith({
        data: { id: VISITOR, userId: 5, linkedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW },
      });
    });

    it('never takes a visitor another account holds', async () => {
      tx.analyticsVisitor.findUnique.mockResolvedValue({ userId: 6, firstSeenAt: ago(MINUTE_MS) });

      expect(await service.link(5, VISITOR, NOW)).toEqual({ status: 'conflict' });
      expect(tx.analyticsVisitor.update).not.toHaveBeenCalled();
    });

    it('answers linked without writing for a visitor already linked to the account', async () => {
      tx.analyticsVisitor.findUnique.mockResolvedValue({ userId: 5, firstSeenAt: ago(MINUTE_MS) });

      expect(await service.link(5, VISITOR, NOW)).toEqual({ status: 'linked' });
      expect(tx.analyticsProjectionWork.createMany).not.toHaveBeenCalled();
    });

    it('never revives an erased visitor', async () => {
      tx.analyticsVisitorTombstone.findUnique.mockResolvedValue({ id: VISITOR });

      expect(await service.link(5, VISITOR, NOW)).toEqual({ status: 'erased' });
      expect(tx.analyticsVisitor.create).not.toHaveBeenCalled();
    });

    it('links nothing while analytics is off', async () => {
      features.features.analytics = false;

      expect(await service.link(5, VISITOR, NOW)).toEqual({ status: 'disabled' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
