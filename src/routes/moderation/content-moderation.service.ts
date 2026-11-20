import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationTargetType, Prisma } from '@prisma/client';

import { CodedException } from '../../common/coded.exception';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ContentDecisionDto, ModerationNoteDto } from './dto/moderation-decision.dto';
import { resolveOpenFlags } from './flag-resolution';
import { MODERATION_ERROR, notAvailableYet } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';
import { ActionRow, toActionDto } from './moderation-mappers';
import { StaffActor } from './staff-actor';

const COMMENT_SELECT = {
  id: true,
  content: true,
  deleted: true,
  hiddenAt: true,
  authorId: true,
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

/** What staff decide about a game or a comment. */
@Injectable()
export class ContentModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly log: ModerationLogService,
    private readonly notifications: NotificationsService,
  ) {}

  hideProject(
    _staff: StaffActor,
    _projectId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  restoreProject(
    _staff: StaffActor,
    _projectId: number,
    _input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  removeProject(
    _staff: StaffActor,
    _projectId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  async hideComment(
    staff: StaffActor,
    commentId: number,
    input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    const comment = await this.comment(staff, commentId);
    if (comment.deleted) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.COMMENT_DELETED,
        'This comment was already deleted by a user',
      );
    }
    if (comment.hiddenAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.ALREADY_HIDDEN,
        'This comment is already hidden',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: comment.id }, data: { hiddenAt: new Date() } });
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.COMMENT_HIDDEN,
        actorId: staff.id,
        targetType: ModerationTargetType.COMMENT,
        targetId: comment.id,
        subjectUserId: comment.authorId,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: null, body: comment.content },
      });
      if (input.resolveFlags !== false) {
        await resolveOpenFlags(tx, {
          targetType: ModerationTargetType.COMMENT,
          targetId: comment.id,
          status: FlagStatus.ACTIONED,
          resolvedById: staff.id,
          resolutionId: recorded.id,
        });
      }
      return recorded;
    });

    await this.notify(
      row,
      'Your comment was removed',
      input.publicMessage || 'A moderator removed one of your comments.',
    );
    return toActionDto(row, staff);
  }

  async restoreComment(
    staff: StaffActor,
    commentId: number,
    input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    const comment = await this.comment(staff, commentId);
    if (!comment.hiddenAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.NOT_HIDDEN,
        'This comment is not hidden',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: comment.id }, data: { hiddenAt: null } });
      return this.log.record(tx, {
        action: ModerationActionType.COMMENT_RESTORED,
        actorId: staff.id,
        targetType: ModerationTargetType.COMMENT,
        targetId: comment.id,
        subjectUserId: comment.authorId,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: null, body: comment.content },
      });
    });

    await this.notify(
      row,
      'Your comment is back',
      input.publicMessage || 'A moderator restored one of your comments.',
    );
    return toActionDto(row, staff);
  }

  removeComment(
    _staff: StaffActor,
    _commentId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  /** The comment a decision bears on. Staff never decide about what they wrote themselves. */
  private async comment(staff: StaffActor, commentId: number): Promise<CommentRow> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: COMMENT_SELECT,
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorId === staff.id) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        MODERATION_ERROR.OWN_CASE,
        'You cannot moderate your own content',
      );
    }
    return comment;
  }

  private async notify(row: ActionRow, title: string, message: string): Promise<void> {
    if (row.subjectUserId === null) {
      return;
    }
    await this.notifications.notifyBestEffort({
      userId: row.subjectUserId,
      title,
      message,
      type: 'WARNING',
      kind: 'MODERATION',
      data: { actionId: row.id, action: row.action },
    });
  }
}
