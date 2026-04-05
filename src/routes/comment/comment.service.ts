import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
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

@Injectable()
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  async getComments(
    projectId: number,
    page: number = 1,
    limit: number = 20,
    sort: "newest" | "oldest" = "newest"
  ): Promise<PaginatedCommentsResponseDto> {
    const skip = (page - 1) * limit;
    const orderBy = sort === "newest" ? "desc" : "asc";

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          projectId,
          parentId: null,
          OR: [
            { deleted: false },
            { deleted: true, replies: { some: {} } }
          ]
        },
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
        skip,
        take: limit
      }),
      this.prisma.comment.count({
        where: { projectId, parentId: null, deleted: false }
      })
    ]);

    return {
      comments: comments.map(this.mapComment),
      total,
      page,
      limit
    };
  }

  async createComment(
    projectId: number,
    userId: number,
    content: string
  ): Promise<CommentResponseDto> {
    // Verify project exists and is published
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
    commentId: number,
    userId: number,
    isProjectCreator: boolean = false
  ): Promise<void> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        authorId: true,
        _count: { select: { replies: true } }
      }
    });

    if (!comment) {
      throw new CommentNotFoundException(commentId);
    }

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

  private mapComment(comment: {
    id: number;
    content: string;
    deleted: boolean;
    createdAt: Date;
    projectId: number;
    author: { id: number; username: string; nickname: string | null };
    replies?: Array<{
      id: number;
      content: string;
      deleted: boolean;
      createdAt: Date;
      projectId: number;
      author: { id: number; username: string; nickname: string | null };
    }>;
  }): CommentResponseDto {
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
