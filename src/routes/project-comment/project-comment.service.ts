import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  AnalyticsEventType,
  ModerationActionType,
  Prisma
} from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import {
  CommentNotFoundException,
  CommentProjectNotPublishedException,
  CommentNestedReplyException
} from "./project-comment.error";
import {
  CommentResponseDto,
  PaginatedCommentsResponseDto
} from "./dto/comment-response.dto";
import { AnalyticsService } from "src/analytics/analytics.service";
import { Actor } from "@auth/actor";
import { CommentFilterDto } from "./dto/comment-filter.dto";
import { ModeratedCommentFieldsDto } from "./dto/comment-response.dto";

export type CommentListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
import { AuditService, commentRef } from "src/moderation/audit";

const AUTHOR_SELECT = {
  id: true,
  username: true,
  nickname: true
};

const DEFAULT_COMMENTS_PAGE = 1;
const DEFAULT_COMMENTS_LIMIT = 20;
const MAX_COMMENTS_LIMIT = 100;

type CommentAuthor = {
  id: number;
  username: string;
  nickname: string | null;
};

type CommentReplyRecord = {
  id: number;
  content: string;
  deleted: boolean;
  createdAt: Date;
  projectId: number;
  author: CommentAuthor;
};

type CommentRecord = CommentReplyRecord & {
  replies?: CommentReplyRecord[];
};

@Injectable()
export class ProjectCommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Optional() private readonly analyticsService?: AnalyticsService
  ) {}

  private buildVisibleTopLevelCommentWhere(
    projectId: number
  ): Prisma.CommentWhereInput {
    return {
      projectId,
      parentId: null,
      hidden: false,
      OR: [
        { deleted: false },
        { deleted: true, replies: { some: { hidden: false } } }
      ]
    };
  }

  private normalizePagination(
    page: number,
    limit: number
  ): { page: number; limit: number; skip: number } {
    const safePage = Number.isFinite(page)
      ? Math.max(DEFAULT_COMMENTS_PAGE, Math.trunc(page))
      : DEFAULT_COMMENTS_PAGE;
    const safeLimit = Number.isFinite(limit)
      ? Math.min(MAX_COMMENTS_LIMIT, Math.max(1, Math.trunc(limit)))
      : DEFAULT_COMMENTS_LIMIT;

    return {
      page: safePage,
      limit: safeLimit,
      skip: (safePage - 1) * safeLimit
    };
  }

  async getComments(
    projectId: number,
    page: number = DEFAULT_COMMENTS_PAGE,
    limit: number = DEFAULT_COMMENTS_LIMIT,
    sort: "newest" | "oldest" = "newest"
  ): Promise<PaginatedCommentsResponseDto> {
    const pagination = this.normalizePagination(page, limit);
    const orderBy = sort === "newest" ? "desc" : "asc";
    const visibleCommentWhere =
      this.buildVisibleTopLevelCommentWhere(projectId);

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: visibleCommentWhere,
        include: {
          author: { select: AUTHOR_SELECT },
          replies: {
            include: {
              author: { select: AUTHOR_SELECT }
            },
            where: { hidden: false },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { createdAt: orderBy },
        skip: pagination.skip,
        take: pagination.limit
      }),
      this.prisma.comment.count({
        where: visibleCommentWhere
      })
    ]);

    return {
      comments: comments.map((comment) => this.mapComment(comment)),
      total,
      page: pagination.page,
      limit: pagination.limit
    };
  }

  async createComment(
    projectId: number,
    userId: number,
    content: string
  ): Promise<CommentResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true, hidden: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    if (project.status !== "COMPLETED" || project.hidden) {
      throw new CommentProjectNotPublishedException(projectId);
    }

    const comment = await this.prisma.comment.create({
      data: {
        content,
        authorId: userId,
        projectId
      },
      include: {
        author: { select: AUTHOR_SELECT }
      }
    });

    await this.analyticsService?.record(AnalyticsEventType.COMMENT_CREATED, {
      userId,
      projectId,
      commentId: comment.id
    });

    return this.mapComment(comment);
  }

  async createReply(
    projectId: number,
    commentId: number,
    userId: number,
    content: string
  ): Promise<CommentResponseDto> {
    const parentComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        parentId: true,
        projectId: true,
        deleted: true,
        hidden: true
      }
    });

    if (!parentComment) {
      throw new CommentNotFoundException(commentId);
    }

    if (parentComment.projectId !== projectId) {
      throw new NotFoundException("Comment does not belong to this project");
    }

    if (parentComment.parentId !== null) {
      throw new CommentNestedReplyException();
    }

    if (parentComment.deleted || parentComment.hidden) {
      throw new ForbiddenException("Cannot reply to a deleted comment");
    }

    const reply = await this.prisma.comment.create({
      data: {
        content,
        authorId: userId,
        projectId,
        parentId: commentId
      },
      include: {
        author: { select: AUTHOR_SELECT }
      }
    });

    await this.analyticsService?.record(AnalyticsEventType.COMMENT_REPLIED, {
      userId,
      projectId,
      commentId: reply.id,
      metadata: { parentId: commentId }
    });

    return this.mapComment(reply);
  }

  /**
   * Edits a comment.
   *
   * A moderator may edit one they did not write -- that is the only difference
   * between the two cases, so it is handled here rather than in a parallel
   * admin route. Acting on someone else's comment is written to the audit log.
   */
  async updateComment(
    commentId: number,
    actor: Actor,
    patch: { content?: string; hidden?: boolean; moderationReason?: string }
  ): Promise<CommentResponseDto & ModeratedCommentFieldsDto> {
    const { content, hidden, moderationReason: reason } = patch;

    if (hidden !== undefined && !actor.isModerator) {
      throw new ForbiddenException(
        "Only a moderator can change a comment's visibility"
      );
    }

    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, hidden: true, content: true }
    });

    if (!comment) {
      throw new CommentNotFoundException(commentId);
    }

    if (!actor.canActOn(comment)) {
      throw new ForbiddenException("You can only edit your own comments");
    }
    // A hidden comment is under moderation: its author cannot rewrite it, but a
    // moderator still can (that is how an offending line gets redacted).
    if (comment.hidden && !actor.isModerator) {
      throw new ForbiddenException("Cannot edit a hidden comment");
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        ...(content !== undefined ? { content } : {}),
        ...(hidden !== undefined
          // Only the flag: the reason, the moment and the actor are the audit
          // entry's job, recorded just below.
          ? { hidden }
          : {})
      },
      include: {
        author: { select: AUTHOR_SELECT },
        project: { select: { name: true, publishedName: true } }
      }
    });

    if (hidden !== undefined) {
      await this.auditService.record({
        ref: commentRef(commentId),
        actor,
        action: hidden
          ? ModerationActionType.HIDE_COMMENT
          : ModerationActionType.RESTORE_COMMENT,
        reason: reason ?? null,
        before: { hidden: comment.hidden },
        after: { hidden }
      });
    } else if (actor.actsAsModeratorOn(comment)) {
      await this.auditService.record({
        ref: commentRef(commentId),
        actor,
        action: ModerationActionType.EDIT_COMMENT,
        reason: reason ?? null,
        before: { content: comment.content },
        after: { content }
      });
    }

    // A moderator gets the staff shape back, so the response to a hide/restore
    // carries the field that changed. The author gets the public shape.
    return actor.isModerator
      ? this.mapModeratedComment(updated)
      : this.mapComment(updated);
  }

  async findOneForModeration(
    id: number,
    actor: Actor
  ): Promise<CommentResponseDto & ModeratedCommentFieldsDto> {
    if (!actor.isModerator) {
      throw new ForbiddenException("Staff access required");
    }

    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        author: { select: AUTHOR_SELECT },
        project: { select: { name: true, publishedName: true } }
      }
    });

    if (!comment) {
      throw new CommentNotFoundException(id);
    }

    return this.mapModeratedComment(comment);
  }

  /**
   * Cross-project comment query for moderation.
   *
   * A query capability on the comment resource, not a second comment API: the
   * moderation-only filters are simply refused for a non-moderator.
   */
  async findAllForModeration(
    filter: CommentFilterDto,
    actor: Actor
  ): Promise<{
    data: Array<CommentResponseDto & ModeratedCommentFieldsDto>;
    meta: CommentListMeta;
  }> {
    if (!actor.isModerator) {
      throw new ForbiddenException("Staff access required");
    }

    const page = filter.page ?? 1;
    const limit = filter.limit ?? 25;

    const where: Prisma.CommentWhereInput = {};
    if (filter.projectId !== undefined) where.projectId = filter.projectId;
    if (filter.authorId !== undefined) where.authorId = filter.authorId;
    if (filter.hidden !== undefined) where.hidden = filter.hidden;
    if (filter.deleted !== undefined) where.deleted = filter.deleted;

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [filter.sortBy ?? "createdAt"]: filter.order ?? "desc" },
        include: {
          author: { select: AUTHOR_SELECT },
          project: { select: { name: true, publishedName: true } }
        }
      }),
      this.prisma.comment.count({ where })
    ]);

    return {
      data: comments.map((comment) => this.mapModeratedComment(comment)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    };
  }

  /**
   * Soft-deletes a comment. The author, the project creator and any moderator
   * may do it; only the moderator case is audited.
   */
  async deleteComment(
    projectId: number,
    commentId: number,
    actor: Actor,
    reason?: string
  ): Promise<void> {
    const [comment, project] = await Promise.all([
      this.prisma.comment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          authorId: true,
          projectId: true,
          _count: { select: { replies: true } }
        }
      }),
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { userId: true }
      })
    ]);

    if (!comment) {
      throw new CommentNotFoundException(commentId);
    }

    if (comment.projectId !== projectId) {
      throw new NotFoundException("Comment does not belong to this project");
    }

    const isProjectCreator = project?.userId === actor.id;

    if (!actor.canActOn(comment) && !isProjectCreator) {
      throw new ForbiddenException("You can only delete your own comments");
    }

    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deleted: true }
    });

    if (actor.actsAsModeratorOn(comment) && !isProjectCreator) {
      await this.auditService.record({
        ref: commentRef(commentId),
        actor,
        action: ModerationActionType.DELETE_COMMENT,
        reason: reason ?? null,
        before: { deleted: false },
        after: { deleted: true }
      });
    }
  }

  /**
   * The staff view of a comment: the public shape plus the fields a moderation
   * queue needs -- whether it is hidden, and who wrote it, which the public
   * mapper deliberately omits.
   */
  private mapModeratedComment(
    comment: CommentRecord & {
      hidden?: boolean;
      authorId?: number | null;
      project?: { name: string; publishedName: string | null } | null;
    }
  ): CommentResponseDto & ModeratedCommentFieldsDto {
    return {
      ...this.mapComment(comment),
      // The moderation queue shows the content of hidden comments: judging one
      // is the whole point, so it is not blanked the way the public view does.
      content: comment.content,
      hidden: comment.hidden ?? false,
      authorId: comment.authorId ?? null,
      ...(comment.author?.username
        ? { authorUsername: comment.author.username }
        : {}),
      ...(comment.project
        ? { projectName: comment.project.publishedName ?? comment.project.name }
        : {})
    };
  }

  private mapComment(comment: CommentRecord): CommentResponseDto {
    return {
      id: comment.id,
      content: comment.deleted ? "" : comment.content,
      deleted: comment.deleted,
      createdAt: comment.createdAt,
      projectId: comment.projectId,
      author: comment.author,
      replies: comment.replies?.map((reply) => ({
        id: reply.id,
        content: reply.content,
        deleted: reply.deleted,
        createdAt: reply.createdAt,
        projectId: reply.projectId,
        author: reply.author
      }))
    };
  }
}
