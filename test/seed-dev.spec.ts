import { clearAnalytics, seedAnalytics } from '../prisma/seed-dev-analytics';
import { seedCollections } from '../prisma/seed-dev-collections';
import { seedHubSignals } from '../prisma/seed-dev-hub';
import { normalizeFriendCode } from '../src/routes/user/friend-code.util';
import { withEnv } from './env';
import { uuidOf } from './uuid';

const mockPrisma = {
  user: { upsert: jest.fn() },
  friendship: { upsert: jest.fn() },
  friendRequest: { upsert: jest.fn() },
  project: { findMany: jest.fn(), update: jest.fn() },
  $disconnect: jest.fn(),
};

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));
jest.mock('../prisma/seed-dev-analytics', () => ({
  seedAnalytics: jest.fn().mockResolvedValue('seeded'),
  clearAnalytics: jest.fn().mockResolvedValue('cleared'),
}));
jest.mock('../prisma/seed-dev-collections', () => ({
  seedCollections: jest.fn().mockResolvedValue('collected'),
}));
jest.mock('../prisma/seed-dev-hub', () => ({
  seedHubSignals: jest.fn().mockResolvedValue('ranked'),
}));

/** Runs the script the way `npm run seed:dev` does, and resolves once it has let go of the database. */
async function runSeed(...flags: string[]): Promise<void> {
  const finished = new Promise<void>((resolve) => {
    mockPrisma.$disconnect.mockImplementation(async () => resolve());
  });

  const argv = process.argv;
  process.argv = [...argv, ...flags];
  try {
    await jest.isolateModulesAsync(async () => {
      await import('../prisma/seed-dev');
    });
    await finished;
  } finally {
    process.argv = argv;
  }
}

describe('seed:dev', () => {
  let logged: jest.SpyInstance;
  let failed: jest.SpyInstance;

  beforeEach(() => {
    withEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://naucto:naucto@db:5432/naucto',
    });

    let nextId = 1;
    mockPrisma.user.upsert.mockImplementation(async () => ({ id: uuidOf(nextId++) }));
    mockPrisma.project.findMany.mockResolvedValue([]);

    logged = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    failed = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.exitCode = undefined;
    jest.clearAllMocks();
    logged.mockRestore();
    failed.mockRestore();
  });

  it('gives every person a friend code that the lookup by code can find', async () => {
    await runSeed();

    const codes = mockPrisma.user.upsert.mock.calls.map(
      ([args]: [{ create: { friendCode: string } }]) => args.create.friendCode,
    );

    expect(codes).not.toHaveLength(0);
    expect(codes.map(normalizeFriendCode)).toEqual(codes);
  });

  it('gives a few games the disk their author chose, without dating them as edited', async () => {
    const updatedAt = new Date('2026-11-02T08:00:00Z');
    mockPrisma.project.findMany.mockImplementation(async ({ where }: { where?: object }) =>
      where ? [{ id: uuidOf(4), name: 'Duel', updatedAt }] : [],
    );

    await runSeed();

    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: uuidOf(4) },
      data: {
        diskColor: '#ffd100',
        diskFinish: 'gold',
        diskColor2: null,
        diskGradDir: null,
        updatedAt,
      },
    });
  });

  it('seeds the analytics after the people, unless told not to', async () => {
    await runSeed();
    expect(seedAnalytics).toHaveBeenCalledWith(mockPrisma);

    jest.mocked(seedAnalytics).mockClear();
    await runSeed('--no-analytics');
    expect(seedAnalytics).not.toHaveBeenCalled();
  });

  it('gives the hub its signals last, from the people it seeded, with or without analytics', async () => {
    await runSeed();

    expect(seedHubSignals).toHaveBeenCalledWith(
      mockPrisma,
      Array.from({ length: mockPrisma.user.upsert.mock.calls.length }, (_, index) =>
        uuidOf(index + 1),
      ),
    );
    expect(jest.mocked(seedAnalytics).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(seedHubSignals).mock.invocationCallOrder[0]!,
    );

    jest.mocked(seedHubSignals).mockClear();
    await runSeed('--no-analytics');
    expect(seedHubSignals).toHaveBeenCalledTimes(1);
  });

  it('seeds the collections once the sample games are there, before the hub is drawn again', async () => {
    await runSeed();

    const [calledAt] = jest.mocked(seedCollections).mock.invocationCallOrder;
    expect(jest.mocked(seedCollections).mock.calls[0]?.[1].get('alexis')).toBe(uuidOf(1));
    expect(jest.mocked(seedAnalytics).mock.invocationCallOrder[0]).toBeLessThan(calledAt!);
    expect(calledAt).toBeLessThan(jest.mocked(seedHubSignals).mock.invocationCallOrder[0]!);
  });

  it('only removes the analytics when asked to clear them', async () => {
    await runSeed('--clear-analytics');

    expect(clearAnalytics).toHaveBeenCalledWith(mockPrisma);
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(seedCollections).not.toHaveBeenCalled();
    expect(seedHubSignals).not.toHaveBeenCalled();
  });

  it('refuses to write anything when NODE_ENV is production', async () => {
    withEnv({ NODE_ENV: 'production' });

    await runSeed();

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('NODE_ENV=production') }),
    );
    expect(process.exitCode).toBe(1);
  });
});
