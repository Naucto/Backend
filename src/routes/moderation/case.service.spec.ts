import { NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationTargetType } from '@prisma/client';

import { withEnv } from '../../../test/env';
import { uuidOf } from '../../../test/uuid';
import { ADMIN, MODERATOR, USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { CaseService } from './case.service';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';
import { ModerationTargetService, TargetView } from './moderation-target.service';

const MOD = { id: uuidOf(1), role: MODERATOR } as const;

describe('CaseService', () => {
  const account = (number: number, role: string = USER): TargetView['owner'] => ({
    id: uuidOf(number),
    username: `user${String(number)}`,
    nickname: null,
    role,
    email: `user${String(number)}@example.com`,
    deletedAt: null,
  });
  const comment = (overrides: Partial<TargetView> = {}): TargetView => ({
    type: ModerationTargetType.COMMENT,
    id: uuidOf(31),
    state: 'VISIBLE',
    owner: account(7),
    content: { title: null, body: 'Buy my thing' },
    project: { id: uuidOf(12), name: 'Ferry Click', reachable: true },
    ...overrides,
  });
  const row = (overrides: object = {}): object => ({
    targetType: ModerationTargetType.COMMENT,
    targetId: uuidOf(31),
    targetOwnerId: uuidOf(7),
    openFlags: 2,
    totalFlags: 3,
    openReasons: ['SPAM'],
    reasons: ['HARASSMENT', 'SPAM'],
    firstFlaggedAt: new Date('2026-11-18T10:00:00.000Z'),
    lastFlaggedAt: new Date('2026-11-19T10:00:00.000Z'),
    ...overrides,
  });

  const tx = { flag: { updateMany: jest.fn() } };
  const prisma = {
    flag: { groupBy: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    moderationAction: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const targets = { view: jest.fn() };
  const log = { record: jest.fn() };
  let service: CaseService;

  beforeEach(() => {
    jest.resetAllMocks();
    withEnv({ FRONTEND_URL: 'https://naucto.test' });
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.flag.findMany.mockResolvedValue([]);
    prisma.moderationAction.findMany.mockResolvedValue([]);
    tx.flag.updateMany.mockResolvedValue({ count: 2 });
    targets.view.mockResolvedValue(comment());
    service = new CaseService(
      prisma as unknown as PrismaService,
      targets as unknown as ModerationTargetService,
      log as unknown as ModerationLogService,
    );
  });

  it('counts the targets waiting, and the flags on them', async () => {
    prisma.flag.groupBy.mockResolvedValue([{ _count: { _all: 2 } }, { _count: { _all: 1 } }]);

    await expect(service.count()).resolves.toEqual({ openCases: 2, openFlags: 3 });
    expect(prisma.flag.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: FlagStatus.OPEN } }),
    );
  });

  describe('list', () => {
    it('reads each target as one case, with where to look at it', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([{ total: 1 }]);

      const list = await service.list(MOD, {});

      expect(list).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(list.items[0]).toMatchObject({
        status: 'OPEN',
        openFlags: 2,
        totalFlags: 3,
        reasons: ['SPAM'],
        target: {
          type: ModerationTargetType.COMMENT,
          id: uuidOf(31),
          state: 'VISIBLE',
          label: 'Buy my thing',
          projectName: 'Ferry Click',
          playUrl: `https://naucto.test/play/${uuidOf(12)}`,
          previewEditUrl: `https://naucto.test/staff/edit/${uuidOf(12)}`,
        },
      });
    });

    it('lists every reason of a case once it is resolved', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([row({ openFlags: 0, openReasons: null })])
        .mockResolvedValueOnce([{ total: 1 }]);

      const { items } = await service.list(MOD, { view: 'RESOLVED' });

      expect(items[0]).toMatchObject({ status: 'RESOLVED', reasons: ['HARASSMENT', 'SPAM'] });
    });

    it('still names a target that is gone, from what its flags kept', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([{ total: 1 }]);
      targets.view.mockResolvedValue(
        comment({ state: 'GONE', owner: null, content: null, project: null }),
      );
      prisma.flag.findFirst.mockResolvedValue({ snapshot: { title: null, body: 'Buy my thing' } });
      prisma.user.findUnique.mockResolvedValue(account(7));

      const { items } = await service.list(MOD, {});

      expect(items[0]?.target).toMatchObject({
        state: 'GONE',
        label: 'Buy my thing',
        owner: { id: uuidOf(7) },
        playUrl: null,
      });
    });

    it('links no play page for a game players cannot reach', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([{ total: 1 }]);
      targets.view.mockResolvedValue(
        comment({ project: { id: uuidOf(12), name: 'Ferry Click', reachable: false } }),
      );

      const { items } = await service.list(MOD, {});

      expect(items[0]?.target).toMatchObject({
        playUrl: null,
        previewPlayUrl: `https://naucto.test/staff/play/${uuidOf(12)}`,
      });
    });
  });

  describe('detail', () => {
    it('finds no case where nothing was ever reported', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.detail(MOD, ModerationTargetType.COMMENT, uuidOf(31)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('gives the target now, its flags, and what the caller may do', async () => {
      prisma.$queryRaw.mockResolvedValue([row()]);
      prisma.flag.findMany.mockResolvedValue([
        {
          id: uuidOf(50),
          reporter: account(3),
          resolvedBy: null,
          reason: 'SPAM',
          details: null,
          snapshot: { title: null, body: 'Buy my thing' },
          status: FlagStatus.OPEN,
          createdAt: new Date('2026-11-19T10:00:00.000Z'),
          resolvedAt: null,
        },
      ]);

      const detail = await service.detail(MOD, ModerationTargetType.COMMENT, uuidOf(31));

      expect(detail.current).toEqual({ title: null, body: 'Buy my thing' });
      expect(detail.flags).toHaveLength(1);
      expect(detail.flags[0]?.reporter).toMatchObject({ id: uuidOf(3), email: null });
      expect(detail.allowedActions).toEqual([
        'DISMISS',
        'HIDE',
        'WARN',
        'SUSPEND',
        'CLEAR_PROFILE',
      ]);
    });

    it('shows an admin the address of who reported', async () => {
      prisma.$queryRaw.mockResolvedValue([row()]);
      prisma.flag.findMany.mockResolvedValue([
        {
          id: uuidOf(50),
          reporter: account(3),
          resolvedBy: null,
          reason: 'SPAM',
          details: null,
          snapshot: {},
          status: FlagStatus.OPEN,
          createdAt: new Date(),
          resolvedAt: null,
        },
      ]);

      const detail = await service.detail(
        { id: uuidOf(2), role: ADMIN },
        ModerationTargetType.COMMENT,
        uuidOf(31),
      );

      expect(detail.flags[0]?.reporter.email).toBe('user3@example.com');
    });
  });

  describe('dismiss', () => {
    beforeEach(() => {
      prisma.flag.findFirst.mockResolvedValue({ targetOwnerId: uuidOf(7) });
      prisma.$queryRaw.mockResolvedValue([row({ openFlags: 0, openReasons: null })]);
      log.record.mockResolvedValue({ id: uuidOf(99) });
    });

    it('closes the open flags as dismissed, under one log row, in one transaction', async () => {
      await service.dismiss(MOD, ModerationTargetType.COMMENT, uuidOf(31), {
        internalNote: 'Not spam',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.FLAGS_DISMISSED,
          targetId: uuidOf(31),
          subjectUserId: uuidOf(7),
          internalNote: 'Not spam',
        }),
      );
      expect(tx.flag.updateMany).toHaveBeenCalledWith({
        where: { targetType: 'COMMENT', targetId: uuidOf(31), status: FlagStatus.OPEN },
        data: expect.objectContaining({
          status: FlagStatus.DISMISSED,
          openKey: null,
          resolutionId: uuidOf(99),
        }),
      });
    });

    it('has nothing to dismiss once no flag is open', async () => {
      prisma.flag.findFirst.mockResolvedValue(null);

      await expect(
        service.dismiss(MOD, ModerationTargetType.COMMENT, uuidOf(31), {}),
      ).rejects.toMatchObject({ code: MODERATION_ERROR.NO_OPEN_FLAGS });
    });

    it('refuses staff dismissing the reports on their own content', async () => {
      targets.view.mockResolvedValue(comment({ owner: account(1, MODERATOR) }));

      await expect(
        service.dismiss(MOD, ModerationTargetType.COMMENT, uuidOf(31), {}),
      ).rejects.toMatchObject({ code: MODERATION_ERROR.OWN_CASE });
      expect(log.record).not.toHaveBeenCalled();
    });

    it('still knows whose content it was when the target is gone', async () => {
      targets.view.mockResolvedValue(
        comment({ state: 'GONE', owner: null, content: null, project: null }),
      );
      prisma.flag.findFirst.mockResolvedValue({ targetOwnerId: MOD.id });

      await expect(
        service.dismiss(MOD, ModerationTargetType.COMMENT, uuidOf(31), {}),
      ).rejects.toMatchObject({ code: MODERATION_ERROR.OWN_CASE });
    });
  });
});
