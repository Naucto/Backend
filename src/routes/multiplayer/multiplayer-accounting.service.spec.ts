import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { MultiplayerAccountingService } from './multiplayer-accounting.service';

const SESSION = '0b6b6b2e-5d0a-4d5e-9b0a-6f1f2f3a4b5c';
const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('MultiplayerAccountingService', () => {
  /** What the database holds of the room. */
  let stored: { multiMs: bigint; playerMs: bigint; peakConnected: number };

  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ ...stored }])),
    $executeRaw: jest.fn(),
    analyticsMpSession: {
      update: jest.fn(({ data }: { data: { multiMs: bigint; playerMs: bigint } }) => {
        stored = { ...stored, ...data };
        return Promise.resolve({});
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => Promise<void>) => run(tx)),
    $executeRaw: jest.fn(),
    gameSession: { findUnique: jest.fn(() => Promise.resolve({ projectId: 3 })) },
    analyticsMpSession: {
      createMany: jest.fn(),
      updateMany: jest.fn((_args: { where: object; data: object }) =>
        Promise.resolve({ count: 1 }),
      ),
      findUnique: jest.fn(() => Promise.resolve({ ...stored })),
    },
    analyticsMpSeat: { createMany: jest.fn() },
  };
  let service: MultiplayerAccountingService;

  /** The SQL text of a raw call, its tagged-template strings joined. */
  const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

  const creditedDeltas = (): Array<[unknown, unknown]> =>
    tx.$executeRaw.mock.calls
      .filter((call) => sqlOf(call).includes('INSERT INTO "AnalyticsMpDay"'))
      .map((call) => [call[3], call[4]]);

  beforeEach(() => {
    jest.clearAllMocks();
    stored = { multiMs: 0n, playerMs: 0n, peakConnected: 0 };
    service = new MultiplayerAccountingService(prisma as unknown as PrismaService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('records a created room with the editor flag it was created with', async () => {
    await service.roomCreated(SESSION, 3, true);

    expect(prisma.analyticsMpSession.createMany).toHaveBeenCalledWith({
      data: [{ id: SESSION, projectId: 3, editorTest: true }],
      skipDuplicates: true,
    });
  });

  it('classifies a room at its first connection only', async () => {
    service.seatConnected(SESSION, 1, T0);
    service.seatConnected(SESSION, 2, T0 + 1_000);
    await service.settled();

    const classifications = prisma.analyticsMpSession.updateMany.mock.calls.filter(
      ([args]) => 'classifiedAt' in args.data,
    );
    expect(classifications).toEqual([
      [
        {
          where: { id: SESSION, classifiedAt: null },
          data: { classifiedAt: new Date(T0), firstConnectedAt: new Date(T0) },
        },
      ],
    ]);
  });

  it('stores each seat under a random token, minted once however often the seat reconnects', async () => {
    service.seatConnected(SESSION, 42, T0);
    service.seatDisconnected(SESSION, 42, T0 + 1_000);
    service.seatConnected(SESSION, 42, T0 + 2_000);
    await service.settled();

    expect(prisma.analyticsMpSeat.createMany).toHaveBeenCalledTimes(1);
    const [[{ data }]] = prisma.analyticsMpSeat.createMany.mock.calls as unknown as [
      [{ data: Array<{ seatToken: string }> }],
    ];
    expect(data[0]?.seatToken).toMatch(UUID);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual([
      'firstConnectedAt',
      'seatToken',
      'sessionId',
    ]);
  });

  it('raises the peak and marks the room multiplayer once two seats are connected', async () => {
    service.seatConnected(SESSION, 1, T0);
    service.seatConnected(SESSION, 2, T0 + 1_000);
    await service.settled();

    const peaks = prisma.$executeRaw.mock.calls.map((call) => call[1]);
    expect(peaks).toEqual([1, 2]);
  });

  it('credits connected time per seat and the time with two or more seats', async () => {
    service.seatConnected(SESSION, 1, T0);
    service.seatConnected(SESSION, 2, T0 + 10_000);
    service.seatDisconnected(SESSION, 2, T0 + 70_000);

    service.checkpointAll(T0 + 100_000);
    await service.settled();

    // Host 100 s, guest 60 s; two connected from 10 s to 70 s.
    expect(stored).toMatchObject({ playerMs: 160_000n, multiMs: 60_000n });
    expect(creditedDeltas()).toEqual([[60_000, 160_000]]);
  });

  it('credits nothing twice when a checkpoint runs again on totals already written', async () => {
    service.seatConnected(SESSION, 1, T0);
    service.seatConnected(SESSION, 2, T0);
    service.seatDisconnected(SESSION, 1, T0 + 30_000);
    service.seatDisconnected(SESSION, 2, T0 + 30_000);

    service.checkpointAll(T0 + 30_000);
    service.checkpointAll(T0 + 30_000);
    await service.settled();

    expect(creditedDeltas()).toEqual([[30_000, 60_000]]);
    expect(tx.analyticsMpSession.update).toHaveBeenCalledTimes(1);
  });

  it('resumes a room the server re-forms from the totals it already wrote', async () => {
    stored = { multiMs: 5_000n, playerMs: 20_000n, peakConnected: 2 };

    service.seatConnected(SESSION, 1, T0);
    service.checkpointAll(T0 + 10_000);
    await service.settled();

    expect(stored).toMatchObject({ playerMs: 30_000n, multiMs: 5_000n });
    expect(creditedDeltas()).toEqual([[0, 10_000]]);
  });

  it('writes the last totals when the room closes, then forgets it', async () => {
    service.seatConnected(SESSION, 1, T0);
    service.roomClosed(SESSION, T0 + 15_000);
    await service.settled();

    expect(stored.playerMs).toBe(15_000n);

    service.checkpointAll(T0 + 60_000);
    await service.settled();
    expect(tx.analyticsMpSession.update).toHaveBeenCalledTimes(1);
  });

  it('ignores an editor join on a room already classified, and says so', async () => {
    prisma.analyticsMpSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.editorJoined(SESSION);

    expect(prisma.analyticsMpSession.updateMany).toHaveBeenCalledWith({
      where: { id: SESSION, classifiedAt: null },
      data: { editorTest: true },
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('already classified'),
    );
  });

  it('keeps the first end time when a session is ended again', async () => {
    await service.sessionEnded(SESSION, T0);

    expect(prisma.analyticsMpSession.updateMany).toHaveBeenCalledWith({
      where: { id: SESSION, endedAt: null },
      data: { endedAt: new Date(T0) },
    });
  });

  it('accounts a room the API never recorded as a real game', async () => {
    service.seatConnected(SESSION, 1, T0);
    await service.settled();

    expect(prisma.analyticsMpSession.createMany).toHaveBeenCalledWith({
      data: [{ id: SESSION, projectId: 3, editorTest: false }],
      skipDuplicates: true,
    });
  });
});
