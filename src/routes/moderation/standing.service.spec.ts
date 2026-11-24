import { NotFoundException } from '@nestjs/common';
import { ModerationActionType, ModerationReason } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { StandingService } from './standing.service';

describe('StandingService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    moderationAction: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  let service: StandingService;

  const entry = {
    id: uuidOf(5),
    action: ModerationActionType.COMMENT_HIDDEN,
    targetType: 'COMMENT',
    targetId: uuidOf(31),
    reason: ModerationReason.SPAM,
    publicMessage: 'Advertising is not allowed.',
    snapshot: { title: null, body: 'Buy my thing' },
    expiresAt: null,
    createdAt: new Date('2026-11-19T12:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ suspendedAt: null, suspendedUntil: null });
    prisma.moderationAction.count.mockResolvedValueOnce(1).mockResolvedValueOnce(4);
    prisma.moderationAction.findMany.mockResolvedValue([entry]);
    service = new StandingService(prisma as unknown as PrismaService);
  });

  it('reads only the actions the account is meant to see, about itself', async () => {
    await service.standing(uuidOf(7), {});

    expect(prisma.moderationAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subjectUserId: uuidOf(7), visibleToSubject: true } }),
    );
  });

  it('never selects who acted nor what staff noted', async () => {
    await service.standing(uuidOf(7), {});

    const { select } = prisma.moderationAction.findMany.mock.calls[0][0];
    expect(select).not.toHaveProperty('actor');
    expect(select).not.toHaveProperty('actorId');
    expect(select).not.toHaveProperty('internalNote');
  });

  it('answers each action in the words meant for the account', async () => {
    await expect(service.standing(uuidOf(7), {})).resolves.toEqual({
      suspension: null,
      warnings: 1,
      items: [
        {
          id: uuidOf(5),
          action: ModerationActionType.COMMENT_HIDDEN,
          targetType: 'COMMENT',
          targetId: uuidOf(31),
          targetLabel: 'Buy my thing',
          reason: ModerationReason.SPAM,
          message: 'Advertising is not allowed.',
          expiresAt: null,
          createdAt: entry.createdAt,
        },
      ],
      total: 4,
      page: 1,
      limit: 20,
    });
  });

  it('says why the account is suspended, from the decision that suspended it', async () => {
    const since = new Date('2026-11-18T12:00:00.000Z');
    prisma.user.findUnique.mockResolvedValue({ suspendedAt: since, suspendedUntil: null });
    prisma.moderationAction.findFirst.mockResolvedValue({
      reason: ModerationReason.HARASSMENT,
      publicMessage: 'Repeated insults.',
    });

    const standing = await service.standing(uuidOf(7), {});

    expect(standing.suspension).toEqual({
      since,
      until: null,
      reason: ModerationReason.HARASSMENT,
      message: 'Repeated insults.',
    });
  });

  it('reports no suspension once its end date has passed', async () => {
    prisma.user.findUnique.mockResolvedValue({
      suspendedAt: new Date('2020-01-01'),
      suspendedUntil: new Date('2020-01-02'),
    });

    await expect(service.standing(uuidOf(7), {})).resolves.toMatchObject({ suspension: null });
    expect(prisma.moderationAction.findFirst).not.toHaveBeenCalled();
  });

  it('finds nothing for an account that is gone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.standing(uuidOf(7), {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
