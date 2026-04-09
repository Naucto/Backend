import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import {
  CommentNotFoundException,
  CommentProjectNotPublishedException,
  CommentNestedReplyException
} from "./comment.error";
import {
  CommentResponseDto,
  PaginatedCommentsResponseDto
} from "./dto/comment-response.dto";

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
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  private buildVisibleTopLevelCommentWhere(
    projectId: number
  ): Prisma.CommentWhereInput {
    return {
      projectId,
      parentId: null,
      OR: [{ deleted: false }, { deleted: true, replies: { some: {} } }]
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
    const visibleCommentWhere = this.buildVisibleTopLevelCommentWhere(projectId);

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: visibleCommentWhere,
        include: {
          author: { select: AUTHOR_SELECT },
          replies: {
            include: {
              author: { select: AUTHOR_SELECT }
            },
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
      select: { status: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    if (project.status !== "COMPLETED") {
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

    return this.mapComment(comment);
  }

  async createReply(
    projectId: number,
    commentId: number,
    userId: number,
    content: string
  ): Promise<CommentResponseDto> {
    // Verify parent comment exists
    const parentComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, parentId: true, projectId: true }
    });

    if (!parentComment) {
      throw new CommentNotFoundException(commentId);
    }

    if (parentComment.projectId !== projectId) {
      throw new NotFoundException("Comment does not belong to this project");
    }

    // Prevent nested replies (only allow replies to top-level comments)
    if (parentComment.parentId !== null) {
      throw new CommentNestedReplyException();
    }

    // Prevent replying to soft-deleted comments
    const fullParent = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { deleted: true }
    });
    if (fullParent?.deleted) {
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

    return this.mapComment(reply);
  }

  async updateComment(
    commentId: number,
    userId: number,
    content: string
  ): Promise<CommentResponseDto> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true }
    });

    if (!comment) {
      throw new CommentNotFoundException(commentId);
    }

    if (comment.authorId !== userId) {
      throw new ForbiddenException("You can only edit your own comments");
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: {
        author: { select: AUTHOR_SELECT }
      }
    });

    return this.mapComment(updated);
  }

  async deleteComment(
    projectId: number,
    commentId: number,
    userId: number
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

    const isProjectCreator = project?.userId === userId;

    if (comment.authorId !== userId && !isProjectCreator) {
      throw new ForbiddenException(
        "You can only delete your own comments"
      );
    }

    if (comment._count.replies > 0) {
      // Soft-delete: keep comment shell to preserve replies visibility
      await this.prisma.comment.update({
        where: { id: commentId },
        data: { deleted: true, content: "" }
      });
    } else {
      await this.prisma.comment.delete({
        where: { id: commentId }
      });
    }
  }

  private mapComment(comment: CommentRecord): CommentResponseDto {
    return {
      id: comment.id,
      content: comment.content,
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
