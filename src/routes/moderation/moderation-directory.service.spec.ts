import { NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';

import { withEnv } from '../../../test/env';
import { uuidOf } from '../../../test/uuid';
import { ADMIN, MODERATOR, USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { ModerationDirectoryService } from './moderation-directory.service';

const MOD = { id: uuidOf(1), role: MODERATOR } as const;
const BOSS = { id: uuidOf(2), role: ADMIN } as const;

describe('ModerationDirectoryService', () => {
  const account = (overrides: object = {}): object => ({
    id: uuidOf(7),
    username: 'louis',
    nickname: 'Louis',
    role: USER,
    email: 'louis@example.com',
    deletedAt: null,
    suspendedAt: null,
    suspendedUntil: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    description: 'Makes games',
    _count: { creator: 3, comments: 12, flagsFiled: 1 },
    ...overrides,
  });
  const game = (overrides: object = {}): object => ({
    id: uuidOf(12),
    name: 'Draft name',
    shortDesc: 'Draft blurb',
    longDesc: null,
    tags: ['Action'],
    publishedName: 'Ferry Click',
    publishedShortDesc: 'Click the ferry',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    publishedAt: new Date('2026-02-02T00:00:00.000Z'),
    hiddenAt: null,
    forkedFromId: null,
    creator: account(),
    collaborators: [],
    ...overrides,
  });
  const comment = (overrides: object = {}): object => ({
    id: uuidOf(31),
    content: 'Buy my thing',
    deleted: false,
    hiddenAt: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    parentId: null,
    author: account(),
    project: {
      id: uuidOf(12),
      name: 'Draft name',
      publishedName: 'Ferry Click',
      publishedAt: new Date(),
      hiddenAt: null,
    },
    ...overrides,
  });

  const prisma = {
    user: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    project: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    comment: { count: jest.fn(), findMany: jest.fn() },
    flag: { groupBy: jest.fn() },
    moderationAction: { groupBy: jest.fn() },
    $transaction: jest.fn(),
  };
  const s3 = { fileExists: jest.fn(), downloadFile: jest.fn() };
  let service: ModerationDirectoryService;

  beforeEach(() => {
    jest.resetAllMocks();
    withEnv({ FRONTEND_URL: 'https://naucto.test' });
    prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
    prisma.flag.groupBy.mockResolvedValue([]);
    prisma.moderationAction.groupBy.mockResolvedValue([]);
    service = new ModerationDirectoryService(
      prisma as unknown as PrismaService,
      s3 as unknown as S3Service,
    );
  });

  describe('accounts', () => {
    beforeEach(() => {
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([account()]);
    });

    it('lists an account with where it stands and what it made', async () => {
      prisma.moderationAction.groupBy.mockResolvedValue([
        { subjectUserId: uuidOf(7), _count: { _all: 2 } },
      ]);
      prisma.flag.groupBy.mockResolvedValue([{ targetOwnerId: uuidOf(7), _count: { _all: 4 } }]);

      const { items } = await service.accounts(MOD, {});

      expect(items[0]).toMatchObject({
        id: uuidOf(7),
        standing: 'WARNED',
        warnings: 2,
        games: 3,
        comments: 12,
        openFlags: 4,
        flagsFiled: 1,
        suspension: null,
      });
    });

    it('reads a suspension that still holds as the standing, over any warning', async () => {
      const since = new Date('2026-11-01T00:00:00.000Z');
      prisma.user.findMany.mockResolvedValue([account({ suspendedAt: since })]);
      prisma.moderationAction.groupBy.mockResolvedValue([
        { subjectUserId: uuidOf(7), _count: { _all: 1 } },
      ]);

      const { items } = await service.accounts(MOD, {});

      expect(items[0]).toMatchObject({
        standing: 'SUSPENDED',
        suspension: { since, until: null },
      });
    });

    it('keeps addresses from a moderator, in the answer and in the search', async () => {
      const { items } = await service.accounts(MOD, { search: 'lou' });

      expect(items[0]?.email).toBeNull();
      expect(JSON.stringify(prisma.user.findMany.mock.calls[0][0].where)).not.toContain('email');
    });

    it('lets an admin read and search addresses', async () => {
      const { items } = await service.accounts(BOSS, { search: 'lou' });

      expect(items[0]?.email).toBe('louis@example.com');
      expect(JSON.stringify(prisma.user.findMany.mock.calls[0][0].where)).toContain('email');
    });

    it('never lists an erased account', async () => {
      await service.accounts(MOD, {});

      expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
    });
  });

  describe('account', () => {
    it('finds no account that does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.account(MOD, uuidOf(7))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('says what the caller may do about it', async () => {
      prisma.user.findUnique.mockResolvedValue(account());

      const detail = await service.account(MOD, uuidOf(7));

      expect(detail).toMatchObject({ description: 'Makes games' });
      expect(detail.allowedActions).toEqual(['WARN', 'SUSPEND', 'CLEAR_PROFILE']);
    });

    it('offers nothing on staff of equal rank', async () => {
      prisma.user.findUnique.mockResolvedValue(account({ role: MODERATOR }));

      await expect(service.account(MOD, uuidOf(7))).resolves.toMatchObject({ allowedActions: [] });
    });
  });

  describe('projects', () => {
    beforeEach(() => {
      prisma.project.count.mockResolvedValue(1);
    });

    it.each([
      ['published', {}, 'PUBLISHED', `https://naucto.test/play/${uuidOf(12)}`],
      ['never published', { publishedAt: null }, 'UNPUBLISHED', null],
      ['hidden', { hiddenAt: new Date() }, 'HIDDEN', null],
    ])(
      'lists a %s game with its state, the editor staff open it in, and a play page only when players have one',
      async (_case, state, expected, playUrl) => {
        prisma.project.findMany.mockResolvedValue([game(state)]);

        const { items } = await service.projects(MOD, {});

        expect(items[0]).toMatchObject({
          name: 'Ferry Click',
          state: expected,
          playUrl,
          editUrl: `https://naucto.test/edit/${uuidOf(12)}`,
        });
        expect(items[0]).not.toHaveProperty('previewPlayUrl');
      },
    );

    it('narrows to hidden games when asked', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await service.projects(MOD, { state: 'HIDDEN' });

      expect(prisma.project.findMany.mock.calls[0][0].where.AND).toContainEqual({
        hiddenAt: { not: null },
      });
    });

    it('offers an admin the deletion a moderator does not get', async () => {
      prisma.project.findUnique.mockResolvedValue(game());
      s3.fileExists.mockResolvedValue(false);

      const asModerator = await service.project(MOD, uuidOf(12));
      const asAdmin = await service.project(BOSS, uuidOf(12));

      expect(asModerator.allowedActions).not.toContain('DELETE');
      expect(asAdmin.allowedActions).toContain('DELETE');
      expect(asModerator).toMatchObject({ hasCover: false, hasClip: false, tags: ['Action'] });
    });

    it.each([
      ['served', `projects/${uuidOf(12)}/clip`],
      ['withheld with its game', `withheld/${uuidOf(12)}/clip`],
    ])('says a game has a clip when it is %s', async (_case, key) => {
      prisma.project.findUnique.mockResolvedValue(game());
      s3.fileExists.mockImplementation((asked: string) => Promise.resolve(asked === key));

      await expect(service.project(MOD, uuidOf(12))).resolves.toMatchObject({
        hasCover: false,
        hasClip: true,
      });
    });
  });

  describe('projectCover', () => {
    it.each([
      ['served', `projects/${uuidOf(12)}/image`],
      ['withheld with its game', `withheld/${uuidOf(12)}/cover`],
    ])('serves the cover when it is %s', async (_case, key) => {
      s3.fileExists.mockImplementation((asked: string) => Promise.resolve(asked === key));
      s3.downloadFile.mockResolvedValue({ body: Readable.from('x') });

      await service.projectCover(uuidOf(12));

      expect(s3.downloadFile).toHaveBeenCalledWith({ key });
    });

    it('finds no cover for a game without one', async () => {
      s3.fileExists.mockResolvedValue(false);

      await expect(service.projectCover(uuidOf(12))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('projectClip', () => {
    it.each([
      ['served', `projects/${uuidOf(12)}/clip`],
      ['withheld with its game', `withheld/${uuidOf(12)}/clip`],
    ])('serves the clip when it is %s', async (_case, key) => {
      s3.fileExists.mockImplementation((asked: string) => Promise.resolve(asked === key));
      s3.downloadFile.mockResolvedValue({ body: Readable.from('x') });

      await service.projectClip(uuidOf(12));

      expect(s3.downloadFile).toHaveBeenCalledWith({ key });
    });

    it('finds no clip for a game without one', async () => {
      s3.fileExists.mockResolvedValue(false);

      await expect(service.projectClip(uuidOf(12))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('comments', () => {
    beforeEach(() => {
      prisma.comment.count.mockResolvedValue(1);
    });

    it('shows staff the text of a hidden comment, with the way to restore it', async () => {
      prisma.comment.findMany.mockResolvedValue([comment({ hiddenAt: new Date() })]);

      const { items } = await service.comments(MOD, {});

      expect(items[0]).toMatchObject({
        content: 'Buy my thing',
        state: 'HIDDEN',
        projectName: 'Ferry Click',
        playUrl: `https://naucto.test/play/${uuidOf(12)}`,
      });
      expect(items[0]?.allowedActions).toContain('RESTORE');
    });

    it('counts the open reports on each comment', async () => {
      prisma.comment.findMany.mockResolvedValue([comment()]);
      prisma.flag.groupBy.mockResolvedValue([{ targetId: uuidOf(31), _count: { _all: 2 } }]);

      const { items } = await service.comments(MOD, {});

      expect(items[0]).toMatchObject({ openFlags: 2 });
      expect(items[0]?.allowedActions).toContain('DISMISS');
    });

    it('narrows by text, author, game and state', async () => {
      prisma.comment.findMany.mockResolvedValue([]);

      await service.comments(MOD, {
        search: 'buy',
        authorId: uuidOf(7),
        projectId: uuidOf(12),
        state: 'VISIBLE',
      });

      expect(prisma.comment.findMany.mock.calls[0][0].where).toEqual({
        projectId: uuidOf(12),
        authorId: uuidOf(7),
        content: { contains: 'buy', mode: 'insensitive' },
        deleted: false,
        hiddenAt: null,
      });
    });
  });
});
