import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsTallyService, PingInput } from './analytics-tally.service';

const AT = new Date(Date.UTC(2026, 9, 8, 12, 0, 30));
const MINUTE = new Date(Date.UTC(2026, 9, 8, 12, 0, 0));

describe('AnalyticsTallyService', () => {
  const prisma = { $executeRaw: jest.fn(), $transaction: jest.fn() };
  let service: AnalyticsTallyService;

  const ping = (overrides: Partial<PingInput> = {}): PingInput => ({
    kind: 'BEAT',
    state: 'PLAYING',
    signedIn: false,
    releaseId: 7,
    playMs: 0,
    ...overrides,
  });

  /** The values of each upsert the last flush sent, as `[sql, ...values]`. */
  const flushed = (): unknown[][] =>
    prisma.$executeRaw.mock.calls.map((call) => [
      (call[0] as TemplateStringsArray).join('?'),
      ...call.slice(1),
    ]);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$executeRaw.mockImplementation(() => 'statement');
    prisma.$transaction.mockResolvedValue([]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new AnalyticsTallyService(prisma as unknown as PrismaService);
  });

  it('adds up pings of the same minute, state, sign-in and game into one row', async () => {
    service.recordPing(ping({ kind: 'PLAY_START' }), AT);
    service.recordPing(ping({ kind: 'BEAT', playMs: 20_000 }), AT);
    service.recordPing(ping({ kind: 'FLUSH', playMs: 5_000 }), AT);

    await service.flush();

    const [tally] = flushed();
    expect(tally?.[0]).toContain('INSERT INTO "AnalyticsAnonTally"');
    // minute, state, signedIn, releaseId, beats, playsStarted, playMs
    expect(tally?.slice(1)).toEqual([MINUTE, 'PLAYING', false, 7, 1, 1, 25_000]);
  });

  it('keeps apart pings that differ in any key', async () => {
    service.recordPing(ping(), AT);
    service.recordPing(ping({ signedIn: true }), AT);
    service.recordPing(ping({ releaseId: 0 }), AT);
    service.recordPing(ping(), new Date(AT.getTime() + 60_000));

    await service.flush();

    expect(flushed()).toHaveLength(4);
  });

  it('writes nothing when nothing was tallied', async () => {
    await service.flush();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only adds to rows, so concurrent instances can flush into the same minute', async () => {
    service.recordPing(ping(), AT);
    service.count('accepted', AT);

    await service.flush();

    for (const [sql] of flushed()) {
      expect(sql).toMatch(/ON CONFLICT .* DO UPDATE/s);
      expect(sql).toContain('+ EXCLUDED.');
    }
  });

  it('keeps the tallies of a failed flush for the next one, all of them', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('database is gone'));
    service.recordPing(ping({ playMs: 1_000 }), AT);
    service.count('accepted', AT, 2);

    await service.flush();
    service.recordPing(ping({ playMs: 2_000 }), AT);
    prisma.$executeRaw.mockClear();
    await service.flush();

    const [tally, outcome] = flushed();
    expect(tally?.slice(1)).toEqual([MINUTE, 'PLAYING', false, 7, 2, 0, 3_000]);
    expect(outcome?.slice(3)).toEqual([2, 0, 0, 0]);
  });

  it('counts ingest outcomes per minute under this instance', async () => {
    service.count('accepted', AT, 3);
    service.count('throttled', AT);

    await service.flush();

    const [outcome] = flushed();
    expect(outcome?.[0]).toContain('INSERT INTO "AnalyticsIngestStat"');
    expect(outcome?.slice(1)).toEqual([MINUTE, service.instanceId, 3, 0, 1, 0]);
  });

  it('flushes what it holds when the application shuts down', async () => {
    service.recordPing(ping(), AT);

    await service.onApplicationShutdown();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
