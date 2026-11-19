import {
  ModerationActionType,
  ModerationReason,
  ModerationTargetType,
  Prisma,
} from '@prisma/client';

import { ADMIN } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationLogService, VISIBLE_TO_SUBJECT } from './moderation-log.service';

const STAFF = { id: 1, role: ADMIN } as const;

describe('ModerationLogService', () => {
  const tx = { moderationAction: { create: jest.fn() } };
  const prisma = {
    moderationAction: { count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  let service: ModerationLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModerationLogService(prisma as unknown as PrismaService);
  });

  describe('record', () => {
    const record = (action: ModerationActionType): Promise<unknown> =>
      service.record(tx as unknown as Prisma.TransactionClient, {
        action,
        actorId: 1,
        targetType: ModerationTargetType.USER,
        targetId: 7,
        subjectUserId: 7,
      });

    it('decides for every kind of action whether its subject sees it', () => {
      expect(Object.keys(VISIBLE_TO_SUBJECT).sort()).toEqual(
        Object.values(ModerationActionType).sort(),
      );
    });

    it.each([
      [ModerationActionType.ACCOUNT_WARNED, true],
      [ModerationActionType.COMMENT_HIDDEN, true],
      [ModerationActionType.DRAFT_VIEWED, false],
      [ModerationActionType.FLAGS_DISMISSED, false],
    ])('writes %s as visible to its subject: %s', async (action, visible) => {
      await record(action);

      expect(tx.moderationAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ visibleToSubject: visible }) }),
      );
    });

    it('writes through the transaction it is handed, never its own connection', async () => {
      await record(ModerationActionType.ACCOUNT_WARNED);

      expect(tx.moderationAction.create).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('stores an empty message or note as none', async () => {
      await service.record(tx as unknown as Prisma.TransactionClient, {
        action: ModerationActionType.COMMENT_HIDDEN,
        actorId: 1,
        targetType: ModerationTargetType.COMMENT,
        targetId: 3,
        reason: ModerationReason.SPAM,
        publicMessage: '',
        internalNote: '',
      });

      expect(tx.moderationAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ publicMessage: null, internalNote: null }),
        }),
      );
    });
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.moderationAction.count.mockResolvedValue(0);
      prisma.moderationAction.findMany.mockResolvedValue([]);
    });

    it('reads everything, newest first, when nothing is asked', async () => {
      await expect(service.list(STAFF, {})).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      expect(prisma.moderationAction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
    });

    it('narrows to one target, which is how its history is read', async () => {
      await service.list(STAFF, { targetType: ModerationTargetType.PROJECT, targetId: 12 });

      expect(prisma.moderationAction.count).toHaveBeenCalledWith({
        where: { targetType: ModerationTargetType.PROJECT, targetId: 12 },
      });
    });

    it('takes both days of a range whole, in UTC', async () => {
      await service.list(STAFF, { from: '2026-11-01', to: '2026-11-02' });

      expect(prisma.moderationAction.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lt: new Date('2026-11-03T00:00:00.000Z'),
          },
        },
      });
    });
  });
});
