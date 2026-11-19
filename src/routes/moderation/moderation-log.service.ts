import { Injectable } from '@nestjs/common';
import {
  ModerationActionType,
  ModerationReason,
  ModerationTargetType,
  Prisma,
} from '@prisma/client';

import { toSkipTake } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { LogQueryDto, ModerationLogDto, TargetContentDto } from './dto/moderation-action.dto';
import { ACTION_INCLUDE, ActionRow, toActionDto } from './moderation-mappers';
import { StaffActor } from './staff-actor';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the account an action bore on finds it in its standing. Decided here per kind of action
 * and never by a caller, so no route can hide a sanction from the person it lands on.
 */
export const VISIBLE_TO_SUBJECT: Record<ModerationActionType, boolean> = {
  ACCOUNT_WARNED: true,
  ACCOUNT_SUSPENDED: true,
  ACCOUNT_REINSTATED: true,
  ACCOUNT_DELETED: false,
  PROFILE_CLEARED: true,
  ROLE_CHANGED: false,
  PROJECT_HIDDEN: true,
  PROJECT_RESTORED: true,
  PROJECT_DELETED: true,
  COMMENT_HIDDEN: true,
  COMMENT_RESTORED: true,
  COMMENT_DELETED: true,
  FLAGS_DISMISSED: false,
  DRAFT_VIEWED: false,
};

export interface RecordedAction {
  action: ModerationActionType;
  actorId: number;
  targetType: ModerationTargetType;
  targetId: number;
  subjectUserId?: number | undefined;
  reason?: ModerationReason | undefined;
  publicMessage?: string | undefined;
  internalNote?: string | undefined;
  snapshot?: TargetContentDto | undefined;
  expiresAt?: Date | undefined;
}

/** The record of what staff did: written once per decision, read back, never changed. */
@Injectable()
export class ModerationLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the row of a decision. It takes the transaction of the change it records, so there is
   * never a change without its row nor a row without its change.
   */
  record(tx: Prisma.TransactionClient, input: RecordedAction): Promise<ActionRow> {
    return tx.moderationAction.create({
      data: {
        action: input.action,
        actorId: input.actorId,
        targetType: input.targetType,
        targetId: input.targetId,
        subjectUserId: input.subjectUserId ?? null,
        reason: input.reason ?? null,
        publicMessage: input.publicMessage || null,
        internalNote: input.internalNote || null,
        ...(input.snapshot ? { snapshot: { ...input.snapshot } } : {}),
        expiresAt: input.expiresAt ?? null,
        visibleToSubject: VISIBLE_TO_SUBJECT[input.action],
      },
      include: ACTION_INCLUDE,
    });
  }

  async list(staff: StaffActor, query: LogQueryDto): Promise<ModerationLogDto> {
    const { skip, take } = toSkipTake(query);
    const where: Prisma.ModerationActionWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.subjectUserId ? { subjectUserId: query.subjectUserId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to
                ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS) }
                : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.moderationAction.count({ where }),
      this.prisma.moderationAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: ACTION_INCLUDE,
      }),
    ]);
    return {
      items: rows.map((row) => toActionDto(row, staff)),
      total,
      page: query.page ?? 1,
      limit: take,
    };
  }
}
