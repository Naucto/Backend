import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Collection, CollectionVisibility, Prisma } from '@prisma/client';

import { aProject } from '../../../test/project-mocks';
import { uuidOf, uuidsOf as games } from '../../../test/uuid';
import { compareIds } from '../../common/ids';
import { PrismaService } from '../../prisma/prisma.service';
import { HubService } from '../project/hub.service';
import { ReleaseProject } from '../project/project-select';
import { CollectionLimitException } from './collection.error';
import { COLLECTION_GAMES_MAX, COLLECTIONS_PER_USER_MAX } from './collection-limits';
import { CollectionsService } from './collections.service';

const OWNER = uuidOf(1);
const OTHER = uuidOf(2);
const ANONYMOUS = null;

const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const UNLISTED_ID = '22222222-2222-4222-8222-222222222222';
const PRIVATE_ID = '33333333-3333-4333-8333-333333333333';
const ID_OF: Record<CollectionVisibility, string> = {
  PUBLIC: PUBLIC_ID,
  UNLISTED: UNLISTED_ID,
  PRIVATE: PRIVATE_ID,
};

type Item = { collectionId: string; projectId: string; position: number };
type ItemWhere = {
  collectionId?: string | { in: string[] };
  projectId?: string;
  project?: unknown;
  collection?: { ownerId: string };
};
type CollectionWhere = {
  id?: { in: string[] };
  ownerId?: string;
  visibility?: CollectionVisibility;
  items?: unknown;
};

const release = (id: string): ReleaseProject => ({
  ...aProject({ id, name: `Game ${id}`, publishedAt: new Date('2026-10-01T00:00:00Z') }),
  commentCount: 0,
  forkCount: 0,
  coverUrl: null,
  clipUrl: null,
  disk: null,
});

describe('CollectionsService', () => {
  /** The tables, and the games on the hub: a game missing from `onHub` is a draft or is gone. */
  let rows: Map<string, Collection>;
  let items: Item[];
  let onHub: Set<string>;

  const hasGameOnHub = (collectionId: string): boolean =>
    items.some((item) => item.collectionId === collectionId && onHub.has(item.projectId));

  const withOwner = (row: Collection): Collection & { owner: object } => ({
    ...row,
    owner: { id: row.ownerId, username: row.ownerId === OWNER ? 'owner' : 'other' },
  });

  const matching = (where: CollectionWhere): Collection[] =>
    [...rows.values()].filter(
      (row) =>
        (!where.id || where.id.in.includes(row.id)) &&
        (where.ownerId === undefined || row.ownerId === where.ownerId) &&
        (!where.visibility || row.visibility === where.visibility) &&
        (!where.items || hasGameOnHub(row.id)),
    );

  const itemsMatching = (where: ItemWhere): Item[] =>
    items
      .filter(
        (item) =>
          (where.collectionId === undefined ||
            (typeof where.collectionId === 'string'
              ? item.collectionId === where.collectionId
              : where.collectionId.in.includes(item.collectionId))) &&
          (where.projectId === undefined || item.projectId === where.projectId) &&
          (!where.project || onHub.has(item.projectId)) &&
          (!where.collection || rows.get(item.collectionId)?.ownerId === where.collection.ownerId),
      )
      .sort((a, b) => a.position - b.position || compareIds(a.projectId, b.projectId));

  const prisma = {
    collection: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    collectionItem: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    project: { count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const hubService = { fetchReleasesByIds: jest.fn() };
  let service: CollectionsService;

  const add = (
    id: string,
    visibility: CollectionVisibility,
    listed: string[] = [],
    ownerId = OWNER,
  ): void => {
    const at = new Date(Date.UTC(2020, 0, 1 + rows.size));
    rows.set(id, {
      id,
      ownerId,
      title: `A ${visibility.toLowerCase()} one`,
      description: null,
      visibility,
      createdAt: at,
      updatedAt: at,
    });
    items.push(...listed.map((projectId, position) => ({ collectionId: id, projectId, position })));
  };

  const gamesOf = (id: string): string[] =>
    itemsMatching({ collectionId: id }).map((item) => item.projectId);

  beforeEach(() => {
    jest.resetAllMocks();
    rows = new Map();
    items = [];
    onHub = new Set(games(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));

    prisma.collection.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? withOwner(row) : null;
      },
    );
    prisma.collection.findMany.mockImplementation(async ({ where }: { where: CollectionWhere }) =>
      matching(where)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({
          ...withOwner(row),
          items: itemsMatching({ collectionId: row.id, project: true }),
        })),
    );
    prisma.collection.count.mockImplementation(
      async ({ where }: { where: CollectionWhere }) => matching(where).length,
    );
    prisma.collection.create.mockImplementation(async ({ data }: { data: Partial<Collection> }) => {
      const row: Collection = {
        id: `new-${rows.size}`,
        visibility: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(data as Omit<Collection, 'id' | 'visibility' | 'createdAt' | 'updatedAt'>),
      };
      rows.set(row.id, row);
      return withOwner(row);
    });
    prisma.collection.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Partial<Collection> }) => {
        const row = { ...(rows.get(where.id) as Collection), ...data };
        rows.set(row.id, row);
        return withOwner(row);
      },
    );
    prisma.collection.delete.mockImplementation(async ({ where }: { where: { id: string } }) => {
      rows.delete(where.id);
      items = items.filter((item) => item.collectionId !== where.id);
    });
    prisma.collectionItem.findMany.mockImplementation(async ({ where }: { where: ItemWhere }) =>
      itemsMatching(where),
    );
    prisma.collectionItem.createMany.mockImplementation(async ({ data }: { data: Item[] }) => {
      items.push(...data);
    });
    prisma.collectionItem.deleteMany.mockImplementation(async ({ where }: { where: ItemWhere }) => {
      const gone = new Set(itemsMatching(where));
      items = items.filter((item) => !gone.has(item));
    });
    prisma.collectionItem.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { collectionId_projectId: { collectionId: string; projectId: string } };
        data: { position: number };
      }) => {
        const [item] = itemsMatching(where.collectionId_projectId);
        (item as Item).position = data.position;
      },
    );
    prisma.project.count.mockImplementation(async ({ where }: { where: { id: string } }) =>
      onHub.has(where.id) ? 1 : 0,
    );
    prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    hubService.fetchReleasesByIds.mockImplementation(async (ids: string[]) =>
      ids.filter((id) => onHub.has(id)).map(release),
    );

    service = new CollectionsService(
      prisma as unknown as PrismaService,
      hubService as unknown as HubService,
    );

    add(PUBLIC_ID, 'PUBLIC', games(3, 1, 2));
    add(UNLISTED_ID, 'UNLISTED', games(4));
    add(PRIVATE_ID, 'PRIVATE', games(5));
  });

  describe('who reads a collection', () => {
    it.each<[string, string | null, CollectionVisibility, boolean]>([
      ['its owner', OWNER, 'PUBLIC', true],
      ['its owner', OWNER, 'UNLISTED', true],
      ['its owner', OWNER, 'PRIVATE', true],
      ['someone else', OTHER, 'PUBLIC', true],
      ['someone else', OTHER, 'UNLISTED', true],
      ['someone else', OTHER, 'PRIVATE', false],
      ['a reader who is signed out', ANONYMOUS, 'PUBLIC', true],
      ['a reader who is signed out', ANONYMOUS, 'UNLISTED', true],
      ['a reader who is signed out', ANONYMOUS, 'PRIVATE', false],
    ])('%s opening a %s one', async (_who, viewer, visibility, reads) => {
      const opened = service.findOne(ID_OF[visibility], viewer);

      await (reads
        ? expect(opened).resolves.toMatchObject({ id: ID_OF[visibility], visibility })
        : expect(opened).rejects.toBeInstanceOf(NotFoundException));
    });

    it('answers a private one of someone else exactly as an id that names nothing', async () => {
      const refusal = (id: string): Promise<unknown> =>
        service.findOne(id, OTHER).catch((error: NotFoundException) => error.getResponse());
      const missing = '44444444-4444-4444-8444-444444444444';

      expect(
        JSON.stringify(await refusal(PRIVATE_ID))
          .split(PRIVATE_ID)
          .join(missing),
      ).toBe(JSON.stringify(await refusal(missing)));
    });

    it('lists to its owner every collection of theirs, to a profile only the public ones', async () => {
      const mine = await service.listMine(OWNER);
      const shown = await service.listPublicOf(OWNER);

      expect(mine.map((one) => one.visibility).sort()).toEqual(['PRIVATE', 'PUBLIC', 'UNLISTED']);
      expect(shown.map((one) => one.id)).toEqual([PUBLIC_ID]);
    });

    it('keeps an unlisted and a private one out of the public list and off the hub', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: PUBLIC_ID }]);

      const page = await service.listPublic({});
      const drawn = await service.listedByIds([PRIVATE_ID, UNLISTED_ID, PUBLIC_ID]);
      const candidates = await service.listedWithGames();

      expect(page).toMatchObject({ total: 1, page: 1, limit: 24 });
      expect(page.collections.map((one) => one.id)).toEqual([PUBLIC_ID]);
      expect(drawn.map((one) => one.id)).toEqual([PUBLIC_ID]);
      expect(candidates).toEqual([{ id: PUBLIC_ID, ownerId: OWNER, games: games(3, 1, 2) }]);
    });
  });

  describe('who changes a collection', () => {
    const writes: [string, (id: string, userId: string) => Promise<unknown>][] = [
      ['update', (id, userId) => service.update(id, userId, { title: 'Mine now' })],
      ['remove', (id, userId) => service.remove(id, userId)],
      ['addGame', (id, userId) => service.addGame(id, userId, uuidOf(9))],
      ['removeGame', (id, userId) => service.removeGame(id, userId, uuidOf(3))],
      ['reorder', (id, userId) => service.reorder(id, userId, [])],
    ];

    it.each(writes)('%s is refused to someone who can only read it', async (_name, write) => {
      await expect(write(PUBLIC_ID, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(write(UNLISTED_ID, OTHER)).rejects.toBeInstanceOf(ForbiddenException);

      expect(rows.get(PUBLIC_ID)?.title).toBe('A public one');
      expect(gamesOf(PUBLIC_ID)).toEqual(games(3, 1, 2));
    });

    it.each(writes)('%s on a private one of someone else finds nothing', async (_name, write) => {
      await expect(write(PRIVATE_ID, OTHER)).rejects.toBeInstanceOf(NotFoundException);

      expect(rows.has(PRIVATE_ID)).toBe(true);
      expect(gamesOf(PRIVATE_ID)).toEqual(games(5));
    });

    it('lets its owner retitle it, clear its description and open it to others', async () => {
      await service.update(PRIVATE_ID, OWNER, { description: 'Kept for later' });

      const updated = await service.update(PRIVATE_ID, OWNER, {
        title: 'Rainy days',
        description: '',
        visibility: 'UNLISTED',
      });

      expect(updated).toMatchObject({
        title: 'Rainy days',
        description: null,
        visibility: 'UNLISTED',
        owner: { id: OWNER, username: 'owner' },
      });
    });

    it('deletes it with the games it lists', async () => {
      await service.remove(PUBLIC_ID, OWNER);

      await expect(service.findOne(PUBLIC_ID, OWNER)).rejects.toBeInstanceOf(NotFoundException);
      expect(gamesOf(PUBLIC_ID)).toEqual([]);
    });
  });

  describe('create', () => {
    it('starts private and empty unless told otherwise', async () => {
      const created = await service.create(OTHER, { title: 'Couch co-op' });

      expect(created).toMatchObject({
        title: 'Couch co-op',
        description: null,
        visibility: 'PRIVATE',
        owner: { id: OTHER },
        gameCount: 0,
        games: [],
        unavailableGameIds: [],
      });
    });

    it('refuses a fifty-first collection, and counts only those of the caller', async () => {
      for (let index = rows.size; index < COLLECTIONS_PER_USER_MAX; index++) {
        add(`filler-${index}`, 'PRIVATE');
      }

      const refused = service.create(OWNER, { title: 'One too many' });

      await expect(refused).rejects.toBeInstanceOf(CollectionLimitException);
      await expect(refused).rejects.toMatchObject({
        response: { code: 'COLLECTIONS_LIMIT', max: 50 },
      });
      await expect(service.create(OTHER, { title: 'My first' })).resolves.toBeDefined();
    });
  });

  describe('games', () => {
    it('opens on its games in order, as cards', async () => {
      const opened = await service.findOne(PUBLIC_ID, ANONYMOUS);

      expect(opened.games.map((game) => game.id)).toEqual(games(3, 1, 2));
      expect(opened.gameCount).toBe(3);
      expect(opened.games[0]).not.toHaveProperty('releaseContentHash');
    });

    it('adds a game last, once', async () => {
      await service.addGame(PUBLIC_ID, OWNER, uuidOf(9));
      await service.addGame(PUBLIC_ID, OWNER, uuidOf(9));
      await service.addGame(PUBLIC_ID, OWNER, uuidOf(3));

      expect(gamesOf(PUBLIC_ID)).toEqual(games(3, 1, 2, 9));
    });

    it('refuses a game that is not on the hub, a draft as a gap', async () => {
      onHub.delete(uuidOf(9));

      await expect(service.addGame(PUBLIC_ID, OWNER, uuidOf(9))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.addGame(PUBLIC_ID, OWNER, uuidOf(999))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(gamesOf(PUBLIC_ID)).toEqual(games(3, 1, 2));
    });

    it('refuses a two hundred and first game, but not one it already lists', async () => {
      const full = Array.from({ length: COLLECTION_GAMES_MAX }, (_, index) => uuidOf(100 + index));
      full.forEach((id) => onHub.add(id));
      add('full', 'PRIVATE', full);

      const refused = service.addGame('full', OWNER, uuidOf(9));

      await expect(refused).rejects.toBeInstanceOf(CollectionLimitException);
      await expect(refused).rejects.toMatchObject({
        response: { code: 'COLLECTION_GAMES_LIMIT', max: 200 },
      });
      await expect(service.addGame('full', OWNER, uuidOf(100))).resolves.toBeUndefined();
      expect(gamesOf('full')).toHaveLength(COLLECTION_GAMES_MAX);
    });

    it('counts towards the limit a game that left the hub', async () => {
      const full = Array.from({ length: COLLECTION_GAMES_MAX }, (_, index) => uuidOf(100 + index));
      add('full', 'PRIVATE', full);

      await expect(service.addGame('full', OWNER, uuidOf(9))).rejects.toBeInstanceOf(
        CollectionLimitException,
      );
    });

    it('removes a game, and does nothing for one it does not list', async () => {
      await service.removeGame(PUBLIC_ID, OWNER, uuidOf(1));
      await service.removeGame(PUBLIC_ID, OWNER, uuidOf(9));

      expect(gamesOf(PUBLIC_ID)).toEqual(games(3, 2));
    });

    it('reorders to the list given', async () => {
      await service.reorder(PUBLIC_ID, OWNER, games(2, 3, 1));

      expect(gamesOf(PUBLIC_ID)).toEqual(games(2, 3, 1));
    });

    it('keeps a game the list leaves out after those it names, in the order it had', async () => {
      add('long', 'PRIVATE', games(1, 2, 3, 4, 5));

      await service.reorder('long', OWNER, games(4, 2));

      expect(gamesOf('long')).toEqual(games(4, 2, 1, 3, 5));
    });

    it('refuses to order a game the collection does not list', async () => {
      await expect(service.reorder(PUBLIC_ID, OWNER, games(1, 9))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(gamesOf(PUBLIC_ID)).toEqual(games(3, 1, 2));
    });

    it.each([
      ['addGame', (): Promise<void> => service.addGame(PUBLIC_ID, OWNER, uuidOf(9))],
      ['removeGame', (): Promise<void> => service.removeGame(PUBLIC_ID, OWNER, uuidOf(3))],
      ['reorder', (): Promise<void> => service.reorder(PUBLIC_ID, OWNER, games(1, 2, 3))],
    ])('%s dates the collection as changed', async (_name, change) => {
      const before = rows.get(PUBLIC_ID)?.updatedAt as Date;

      await change();

      expect(rows.get(PUBLIC_ID)?.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('a game that left the hub', () => {
    beforeEach(() => onHub.delete(uuidOf(1)));

    it('is hidden from everyone, its owner included, and counted out', async () => {
      for (const viewer of [OWNER, OTHER, ANONYMOUS]) {
        const opened = await service.findOne(PUBLIC_ID, viewer);

        expect(opened.games.map((game) => game.id)).toEqual(games(3, 2));
        expect(opened.gameCount).toBe(2);
      }
    });

    it('is named to the owner alone, as unavailable', async () => {
      await expect(service.findOne(PUBLIC_ID, OWNER)).resolves.toMatchObject({
        unavailableGameIds: [uuidOf(1)],
      });
      await expect(service.findOne(PUBLIC_ID, OTHER)).resolves.toMatchObject({
        unavailableGameIds: [],
      });
      await expect(service.findOne(PUBLIC_ID, ANONYMOUS)).resolves.toMatchObject({
        unavailableGameIds: [],
      });
    });

    it('can still be removed by the owner', async () => {
      await service.removeGame(PUBLIC_ID, OWNER, uuidOf(1));

      await expect(service.findOne(PUBLIC_ID, OWNER)).resolves.toMatchObject({
        unavailableGameIds: [],
      });
    });

    it('is left out of a preview and of its count', async () => {
      const [preview] = await service.listPublicOf(OWNER);

      expect(preview?.games.map((game) => game.id)).toEqual(games(3, 2));
      expect(preview?.gameCount).toBe(2);
    });

    it('comes back where it was once it is published again', async () => {
      onHub.add(uuidOf(1));

      const opened = await service.findOne(PUBLIC_ID, ANONYMOUS);

      expect(opened.games.map((game) => game.id)).toEqual(games(3, 1, 2));
    });

    it('takes a public collection out of the public list when it was its last game', async () => {
      add('lonely', 'PUBLIC', games(1));

      await expect(service.listedByIds(['lonely', PUBLIC_ID])).resolves.toEqual([
        expect.objectContaining({ id: PUBLIC_ID }),
      ]);
      await expect(service.listPublicOf(OWNER)).resolves.toHaveLength(2);
    });
  });

  describe('previews', () => {
    it('show the first eight games and count them all', async () => {
      add('big', 'PUBLIC', games(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), OTHER);

      const [preview] = await service.listPublicOf(OTHER);

      expect(preview?.games.map((game) => game.id)).toEqual(games(1, 2, 3, 4, 5, 6, 7, 8));
      expect(preview?.gameCount).toBe(10);
      expect(preview?.owner).toEqual({ id: OTHER, username: 'other' });
    });

    it('read the cards of every collection listed in one go', async () => {
      await service.listMine(OWNER);

      expect(hubService.fetchReleasesByIds).toHaveBeenCalledTimes(1);
      expect(prisma.collectionItem.findMany).toHaveBeenCalledTimes(1);
    });

    it('say for each of the caller’s collections whether it lists the game asked about', async () => {
      onHub.delete(uuidOf(5));

      const containing = async (projectId: string): Promise<string[]> =>
        (await service.listMine(OWNER, projectId))
          .filter((one) => one.contains)
          .map((one) => one.id);

      await expect(containing(uuidOf(3))).resolves.toEqual([PUBLIC_ID]);
      // Listed, though it left the hub: adding it again would do nothing.
      await expect(containing(uuidOf(5))).resolves.toEqual([PRIVATE_ID]);
      await expect(containing(uuidOf(9))).resolves.toEqual([]);
    });

    it('say nothing about a game when none was asked about', async () => {
      const [first] = await service.listMine(OWNER);

      expect(first).not.toHaveProperty('contains');
    });
  });

  describe('the public list', () => {
    const orderOf = (): string => {
      const [, ...values] = prisma.$queryRaw.mock.lastCall as [unknown, ...unknown[]];

      // The fragments spliced into the query; a plain value has no `sql`.
      return values.map((value) => (value as Partial<Prisma.Sql>).sql ?? '').join(' | ');
    };

    beforeEach(() => {
      add('other', 'PUBLIC', games(7, 8), OTHER);
      prisma.$queryRaw.mockResolvedValue([{ id: 'other' }, { id: PUBLIC_ID }]);
    });

    it('answers the page in the order the query ranked it', async () => {
      const page = await service.listPublic({ page: 2, limit: 2 });

      expect(page.collections.map((one) => one.id)).toEqual(['other', PUBLIC_ID]);
      expect(page).toMatchObject({ total: 2, page: 2, limit: 2 });
      expect(prisma.$queryRaw.mock.calls[0]?.slice(-2)).toEqual([2, 2]);
    });

    it('ranks by the plays of the games inside unless asked otherwise', async () => {
      await service.listPublic({});
      expect(orderOf()).toContain('SUM("Project"."viewCount") DESC');

      await service.listPublic({ sort: 'recent' });
      expect(orderOf()).toContain('"Collection"."createdAt" DESC');

      await service.listPublic({ sort: 'games' });
      expect(orderOf()).toContain('COUNT(*) DESC');
    });

    it('reads only the games on the hub, by the shared test', async () => {
      await service.listPublic({});

      expect(orderOf()).toContain('"Project"."publishedAt" IS NOT NULL');
    });
  });

  describe('what deleting a game or an account takes with it', () => {
    // The database does it: the client the specs run on does not say what a relation does on
    // delete, so the schema is read as written.
    const schema = readFileSync(
      join(__dirname, '..', '..', '..', 'prisma', 'models', 'collection.prisma'),
      'utf8',
    );
    const cascades = (field: string, target: string): boolean =>
      new RegExp(`^\\s*${field}\\s+${target}\\s+@relation\\([^)]*onDelete: Cascade\\)`, 'm').test(
        schema,
      );

    it('removes a deleted game from every collection', () => {
      expect(cascades('project', Prisma.ModelName.Project)).toBe(true);
    });

    it('removes the games listed with their collection, and a collection with its owner', () => {
      expect(cascades('collection', Prisma.ModelName.Collection)).toBe(true);
      expect(cascades('owner', Prisma.ModelName.User)).toBe(true);
    });
  });
});
