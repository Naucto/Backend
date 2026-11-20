import { Injectable, NotFoundException } from '@nestjs/common';
import { ModerationActionType, Prisma } from '@prisma/client';

import { currentSuspension } from '../../auth/access/suspension';
import { PageRequest, toSkipTake } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { StandingDto, StandingEntryDto, StandingSuspensionDto } from './dto/standing.dto';
import { contentOf, labelOf } from './moderation-mappers';

// Selected field by field: the actor and the internal note never leave the database on this path.
const ENTRY_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  reason: true,
  publicMessage: true,
  snapshot: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.ModerationActionSelect;

type EntryRow = Prisma.ModerationActionGetPayload<{ select: typeof ENTRY_SELECT }>;

function toEntry(row: EntryRow): StandingEntryDto {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: labelOf(contentOf(row.snapshot)),
    reason: row.reason,
    message: row.publicMessage,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** What an account reads of the moderation actions that bore on it. */
@Injectable()
export class StandingService {
  constructor(private readonly prisma: PrismaService) {}

  async standing(userId: number, page: PageRequest): Promise<StandingDto> {
    const { skip, take } = toSkipTake(page);
    const visible: Prisma.ModerationActionWhereInput = {
      subjectUserId: userId,
      visibleToSubject: true,
    };
    const [account, warnings, total, rows] = await this.prisma.$transaction([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { suspendedAt: true, suspendedUntil: true },
      }),
      this.prisma.moderationAction.count({
        where: { ...visible, action: ModerationActionType.ACCOUNT_WARNED },
      }),
      this.prisma.moderationAction.count({ where: visible }),
      this.prisma.moderationAction.findMany({
        where: visible,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: ENTRY_SELECT,
      }),
    ]);
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return {
      suspension: await this.suspension(userId, account),
      warnings,
      items: rows.map(toEntry),
      total,
      page: page.page ?? 1,
      limit: take,
    };
  }

  /** The suspension in force, with the reason and message of the decision that set it. */
  private async suspension(
    userId: number,
    account: { suspendedAt: Date | null; suspendedUntil: Date | null },
  ): Promise<StandingSuspensionDto | null> {
    const suspension = currentSuspension(account);
    if (!suspension) {
      return null;
    }
    const decision = await this.prisma.moderationAction.findFirst({
      where: { subjectUserId: userId, action: ModerationActionType.ACCOUNT_SUSPENDED },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { reason: true, publicMessage: true },
    });
    return {
      ...suspension,
      reason: decision?.reason ?? null,
      message: decision?.publicMessage ?? null,
    };
  }
}
