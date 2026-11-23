import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FlagStatus,
  ModerationActionType,
  ModerationReason,
  ModerationTargetType,
  Prisma,
} from '@prisma/client';

import { CodedException } from '../../common/coded.exception';
import { PROJECT_CHANGED, ProjectChangedEvent } from '../../common/domain-events';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiplayerService } from '../multiplayer/multiplayer.service';
import { ProjectService } from '../project/project.service';
import { ProjectContentService } from '../project/project-content.service';
import { ModerationActionDto, TargetContentDto } from './dto/moderation-action.dto';
import { ContentDecisionDto, ModerationNoteDto } from './dto/moderation-decision.dto';
import { resolveOpenFlags } from './flag-resolution';
import { MODERATION_ERROR } from './moderation.error';
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

const COLLECTION_SELECT = {
  id: true,
  title: true,
  description: true,
  hiddenAt: true,
  ownerId: true,
} satisfies Prisma.CollectionSelect;

type CollectionRow = Prisma.CollectionGetPayload<{ select: typeof COLLECTION_SELECT }>;

/** What staff say when they lift a decision. */
export interface DecisionNote {
  publicMessage?: string | undefined;
  internalNote?: string | undefined;
}

/** What staff say when they hide or delete. */
export interface ContentDecision extends DecisionNote {
  reason: ModerationReason;
  /** Left out, the open flags on the target close as acted on. */
  resolveFlags?: boolean | undefined;
}

const PROJECT_SELECT = {
  id: true,
  userId: true,
  name: true,
  shortDesc: true,
  longDesc: true,
  publishedName: true,
  publishedShortDesc: true,
  publishedLongDesc: true,
  hiddenAt: true,
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

/** A game as its page reads: what was released when there is a release, else the draft. */
function projectContent(project: ProjectRow): TargetContentDto {
  const body = [
    project.publishedShortDesc || project.shortDesc,
    project.publishedLongDesc || project.longDesc,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  return { title: project.publishedName || project.name, body: body || null };
}

/** What staff decide about a game, a comment or a collection. */
@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly log: ModerationLogService,
    private readonly notifications: NotificationsService,
    private readonly content: ProjectContentService,
    private readonly projects: ProjectService,
    private readonly multiplayer: MultiplayerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async hideProject(
    staff: StaffActor,
    projectId: string,
    input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    const project = await this.project(staff, projectId);
    if (project.hiddenAt) {
      throw this.alreadyHidden();
    }

    await this.content.copyToWithheld(project.id);

    const row = await this.prisma.$transaction(async (tx) => {
      // The condition settles two staff members hiding the same game at once.
      const { count } = await tx.project.updateMany({
        where: { id: project.id, hiddenAt: null },
        data: { hiddenAt: new Date(), iconUrl: null, clipVersion: null },
      });
      if (count === 0) {
        throw this.alreadyHidden();
      }
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.PROJECT_HIDDEN,
        actorId: staff.id,
        targetType: ModerationTargetType.PROJECT,
        targetId: project.id,
        subjectUserId: project.userId,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: projectContent(project),
      });
      if (input.resolveFlags !== false) {
        await resolveOpenFlags(tx, {
          targetType: ModerationTargetType.PROJECT,
          targetId: project.id,
          status: FlagStatus.ACTIONED,
          resolvedById: staff.id,
          resolutionId: recorded.id,
        });
      }
      return recorded;
    });

    // The game is hidden from here on, whatever happens below: every route refuses it by its row.
    await this.afterCommit(`unserve game ${project.id}`, async () => {
      await this.content.removeServedCopies(project.id);
      await this.multiplayer.endSessionsOfProject(project.id);
    });
    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(project.id));
    await this.notify(
      row,
      'Your game was hidden',
      input.publicMessage || 'A moderator took one of your games off the hub.',
    );
    return toActionDto(row, staff);
  }

  async restoreProject(
    staff: StaffActor,
    projectId: string,
    input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    const project = await this.project(staff, projectId);
    if (!project.hiddenAt) {
      throw this.notHidden();
    }

    const { coverUrl, clipVersion } = await this.content.copyFromWithheld(project.id);

    let row: ActionRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.project.updateMany({
          where: { id: project.id, hiddenAt: { not: null } },
          data: {
            hiddenAt: null,
            ...(coverUrl ? { iconUrl: coverUrl } : {}),
            ...(clipVersion ? { clipVersion } : {}),
          },
        });
        if (count === 0) {
          throw this.notHidden();
        }
        return this.log.record(tx, {
          action: ModerationActionType.PROJECT_RESTORED,
          actorId: staff.id,
          targetType: ModerationTargetType.PROJECT,
          targetId: project.id,
          subjectUserId: project.userId,
          publicMessage: input.publicMessage,
          internalNote: input.internalNote,
          snapshot: projectContent(project),
        });
      });
    } catch (error) {
      // Still hidden: what was just put back where the edge serves it comes away again.
      await this.afterCommit(`unserve game ${project.id} again`, () =>
        this.content.removeServedCopies(project.id),
      );
      throw error;
    }

    await this.afterCommit(`drop the withheld copies of game ${project.id}`, () =>
      this.content.removeWithheldCopies(project.id),
    );
    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(project.id));
    await this.notify(
      row,
      'Your game is back',
      input.publicMessage || 'A moderator put one of your games back on the hub.',
    );
    return toActionDto(row, staff);
  }

  async removeProject(
    staff: StaffActor,
    projectId: string,
    input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    const project = await this.project(staff, projectId);

    let row: ActionRow | undefined;
    await this.projects.remove(project.id, async (tx) => {
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.PROJECT_DELETED,
        actorId: staff.id,
        targetType: ModerationTargetType.PROJECT,
        targetId: project.id,
        subjectUserId: project.userId,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: projectContent(project),
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      row = recorded;
    });
    if (!row) {
      throw new InternalServerErrorException('The deletion was not recorded');
    }

    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(project.id));
    await this.notify(
      row,
      'Your game was deleted',
      input.publicMessage || 'A moderator deleted one of your games.',
    );
    return toActionDto(row, staff);
  }

  async hideComment(
    staff: StaffActor,
    commentId: string,
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
    commentId: string,
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

  async removeComment(
    staff: StaffActor,
    commentId: string,
    input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    const comment = await this.comment(staff, commentId);

    const row = await this.prisma.$transaction(async (tx) => {
      // A comment with replies keeps its place so they keep theirs, as when a user deletes one. It
      // is emptied for good and stays marked as removed by moderation.
      const replies = await tx.comment.count({ where: { parentId: comment.id } });
      if (replies > 0) {
        await tx.comment.update({
          where: { id: comment.id },
          data: { deleted: true, content: '', hiddenAt: comment.hiddenAt ?? new Date() },
        });
      } else {
        await tx.comment.delete({ where: { id: comment.id } });
      }
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.COMMENT_DELETED,
        actorId: staff.id,
        targetType: ModerationTargetType.COMMENT,
        targetId: comment.id,
        subjectUserId: comment.authorId,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: null, body: comment.content },
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      return recorded;
    });

    await this.notify(
      row,
      'Your comment was deleted',
      input.publicMessage || 'A moderator deleted one of your comments.',
    );
    return toActionDto(row, staff);
  }

  /**
   * Nothing is stored apart for a collection, so hiding one is its row alone: every reader but its
   * owner is refused by `hiddenAt`.
   */
  async hideCollection(
    staff: StaffActor,
    collectionId: string,
    input: ContentDecision,
  ): Promise<ModerationActionDto> {
    const collection = await this.collection(staff, collectionId);
    if (collection.hiddenAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.ALREADY_HIDDEN,
        'This collection is already hidden',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.collection.update({ where: { id: collection.id }, data: { hiddenAt: new Date() } });
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.COLLECTION_HIDDEN,
        actorId: staff.id,
        targetType: ModerationTargetType.COLLECTION,
        targetId: collection.id,
        subjectUserId: collection.ownerId,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: collection.title, body: collection.description },
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      return recorded;
    });

    await this.notify(
      row,
      'Your collection was hidden',
      input.publicMessage || 'A moderator hid one of your collections.',
    );
    return toActionDto(row, staff);
  }

  async restoreCollection(
    staff: StaffActor,
    collectionId: string,
    input: DecisionNote,
  ): Promise<ModerationActionDto> {
    const collection = await this.collection(staff, collectionId);
    if (!collection.hiddenAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.NOT_HIDDEN,
        'This collection is not hidden',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.collection.update({ where: { id: collection.id }, data: { hiddenAt: null } });
      return this.log.record(tx, {
        action: ModerationActionType.COLLECTION_RESTORED,
        actorId: staff.id,
        targetType: ModerationTargetType.COLLECTION,
        targetId: collection.id,
        subjectUserId: collection.ownerId,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: collection.title, body: collection.description },
      });
    });

    await this.notify(
      row,
      'Your collection is back',
      input.publicMessage || 'A moderator restored one of your collections.',
    );
    return toActionDto(row, staff);
  }

  async removeCollection(
    staff: StaffActor,
    collectionId: string,
    input: ContentDecision,
  ): Promise<ModerationActionDto> {
    const collection = await this.collection(staff, collectionId);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.collection.delete({ where: { id: collection.id } });
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.COLLECTION_DELETED,
        actorId: staff.id,
        targetType: ModerationTargetType.COLLECTION,
        targetId: collection.id,
        subjectUserId: collection.ownerId,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: collection.title, body: collection.description },
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      return recorded;
    });

    await this.notify(
      row,
      'Your collection was deleted',
      input.publicMessage || 'A moderator deleted one of your collections.',
    );
    return toActionDto(row, staff);
  }

  private async settleFlags(
    tx: Prisma.TransactionClient,
    staff: StaffActor,
    recorded: ActionRow,
    resolveFlags: boolean | undefined,
  ): Promise<void> {
    if (resolveFlags === false) {
      return;
    }
    await resolveOpenFlags(tx, {
      targetType: recorded.targetType,
      targetId: recorded.targetId,
      status: FlagStatus.ACTIONED,
      resolvedById: staff.id,
      resolutionId: recorded.id,
    });
  }

  /** The game a decision bears on. Staff never decide about a game they created. */
  private async project(staff: StaffActor, projectId: string): Promise<ProjectRow> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: PROJECT_SELECT,
    });
    if (!project) {
      throw new NotFoundException('Game not found');
    }
    if (project.userId === staff.id) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        MODERATION_ERROR.OWN_CASE,
        'You cannot moderate your own content',
      );
    }
    return project;
  }

  private alreadyHidden(): CodedException {
    return new CodedException(
      HttpStatus.CONFLICT,
      MODERATION_ERROR.ALREADY_HIDDEN,
      'This game is already hidden',
    );
  }

  private notHidden(): CodedException {
    return new CodedException(
      HttpStatus.CONFLICT,
      MODERATION_ERROR.NOT_HIDDEN,
      'This game is not hidden',
    );
  }

  /**
   * Work that follows a decision already written. Its failure is logged for the repair task to
   * finish and never reported as a failure of the decision.
   */
  private async afterCommit(what: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `Could not ${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The comment a decision bears on. Staff never decide about what they wrote themselves. */
  private async comment(staff: StaffActor, commentId: string): Promise<CommentRow> {
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

  /** The collection a decision bears on. Staff never decide about one of their own. */
  private async collection(staff: StaffActor, collectionId: string): Promise<CollectionRow> {
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: COLLECTION_SELECT,
    });
    if (!collection) {
      throw new NotFoundException('Collection not found');
    }
    if (collection.ownerId === staff.id) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        MODERATION_ERROR.OWN_CASE,
        'You cannot moderate your own content',
      );
    }
    return collection;
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
