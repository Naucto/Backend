import { PrismaClient } from '@prisma/client';

import {
  SEED_COLLECTIONS,
  seedCollectionId,
  seedCollections,
} from '../prisma/seed-dev-collections';
import { HUB_COLLECTION_MIN_GAMES } from '../src/routes/recommendations/hub-limits';
import { uuidOf } from './uuid';

const PEOPLE = new Map(
  ['alexis', 'louis', 'edgar', 'thea', 'ulysse'].map((name, index) => [name, uuidOf(index + 1)]),
);

describe('seed:dev collections', () => {
  const prisma = {
    project: { findMany: jest.fn() },
    collection: { upsert: jest.fn() },
    collectionItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const seed = (): Promise<string> => seedCollections(prisma as unknown as PrismaClient, PEOPLE);

  /** What a run wrote, as `[collection id, game ids in order]`. */
  const written = (): [string, string[]][] =>
    prisma.collectionItem.createMany.mock.calls.map(
      ([{ data }]: [{ data: { collectionId: string; projectId: string; position: number }[] }]) => [
        data[0]?.collectionId ?? '',
        data.map((item) => item.projectId),
      ],
    );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.project.findMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({ id: uuidOf(index + 1) })),
    );
  });

  it('writes nothing while no game is published', async () => {
    prisma.project.findMany.mockResolvedValue([]);

    await expect(seed()).resolves.toContain('no published game yet');

    expect(prisma.collection.upsert).not.toHaveBeenCalled();
  });

  it('gives the hub public collections of three games or more, by several owners', () => {
    const forHub = SEED_COLLECTIONS.filter(
      (one) => one.visibility === 'PUBLIC' && one.games >= HUB_COLLECTION_MIN_GAMES,
    );

    expect(new Set(forHub.map((one) => one.owner)).size).toBeGreaterThanOrEqual(3);
    expect(SEED_COLLECTIONS.map((one) => one.visibility)).toEqual(
      expect.arrayContaining(['UNLISTED', 'PRIVATE']),
    );
  });

  it('writes each collection under the id it keeps, for the owner it names', async () => {
    await seed();

    expect(prisma.collection.upsert).toHaveBeenCalledTimes(SEED_COLLECTIONS.length);
    expect(prisma.collection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: seedCollectionId(0) },
        create: expect.objectContaining({
          ownerId: uuidOf(1),
          title: 'Couch co-op',
          visibility: 'PUBLIC',
        }),
      }),
    );
    expect(seedCollectionId(0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('lists as many distinct games as each collection asks for, the same on every run', async () => {
    await seed();
    const first = written();
    prisma.collectionItem.createMany.mockClear();
    await seed();

    expect(written()).toEqual(first);
    expect(first.map(([, games]) => new Set(games).size)).toEqual(
      SEED_COLLECTIONS.map((one) => one.games),
    );
    expect(new Set(first.map(([, games]) => games.join())).size).toBeGreaterThan(1);
  });

  it('replaces the games of the collections it wrote, and of no other', async () => {
    await seed();

    expect(prisma.collectionItem.deleteMany.mock.calls.map(([args]) => args)).toEqual(
      SEED_COLLECTIONS.map((_, index) => ({ where: { collectionId: seedCollectionId(index) } })),
    );
  });

  it('skips a collection whose owner was not seeded', async () => {
    await seedCollections(prisma as unknown as PrismaClient, new Map([['louis', uuidOf(2)]]));

    expect(prisma.collection.upsert).toHaveBeenCalledTimes(1);
  });
});
