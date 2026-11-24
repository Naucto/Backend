import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectHiddenException } from '../project/project.error';
import { CommentResponseDto, PaginatedCommentsResponseDto } from './dto/comment-response.dto';
import {
  CommentNestedReplyException,
  CommentNotAuthorException,
  CommentNotFoundException,
  CommentNotInProjectException,
  CommentProjectNotFoundException,
  CommentProjectNotPublishedException,
  CommentReplyToDeletedException,
} from './project-comment.error';

const AUTHOR_SELECT = {
  id: true,
  username: true,
  nickname: true,
};

const DEFAULT_COMMENTS_LIMIT = 20;

type CommentAuthor = {
  id: string;
  username: string;
  nickname: string | null;
};

type CommentReplyRecord = {
  id: string;
  content: string;
  deleted: boolean;
  hiddenAt: Date | null;
  createdAt: Date;
  projectId: string;
  author: CommentAuthor;
};

type CommentRecord = CommentReplyRecord & {
  replies?: CommentReplyRecord[];
};

/**
 * What anyone but staff reads of a comment. One that moderation hid keeps its text in the database
 * for a restore, so the text is withheld here, the one place a comment is turned into an answer.
 */
function published(
  comment: CommentReplyRecord,
): Pick<CommentResponseDto, 'content' | 'deleted' | 'removedBy'> {
  if (comment.hiddenAt) {
    return { content: '', deleted: true, removedBy: 'MODERATION' };
  }
  return comment.deleted
    ? { content: comment.content, deleted: true, removedBy: 'USER' }
    : { content: comment.content, deleted: false };
}

@Injectable()
export class ProjectCommentService {
  constructor(private readonly prisma: PrismaService) {}

  private buildVisibleTopLevelCommentWhere(projectId: string): Prisma.CommentWhereInput {
    return {
      projectId,
      parentId: null,
      OR: [{ deleted: false }, { deleted: true, replies: { some: {} } }],
    };
  }

  private mapComment(comment: CommentRecord): CommentResponseDto {
    return {
      id: comment.id,
      ...published(comment),
      createdAt: comment.createdAt,
      projectId: comment.projectId,
      author: comment.author,
      replies: comment.replies?.map((reply) => ({
        id: reply.id,
        ...published(reply),
        createdAt: reply.createdAt,
        projectId: reply.projectId,
        author: reply.author,
      })),
    };
  }

  async getComments(
    projectId: string,
    page?: number,
    limit?: number,
    sort: 'newest' | 'oldest' = 'newest',
  ): Promise<PaginatedCommentsResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { publishedAt: true, hiddenAt: true },
    });

    if (!project?.publishedAt) {
      throw new CommentProjectNotFoundException(projectId);
    }
    if (project.hiddenAt) {
      throw new ProjectHiddenException();
    }

    const pagination = pageWindow(page, limit, DEFAULT_COMMENTS_LIMIT);
    const orderBy = sort === 'newest' ? 'desc' : 'asc';
    const visibleCommentWhere = this.buildVisibleTopLevelCommentWhere(projectId);

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where: visibleCommentWhere,
        include: {
          author: { select: AUTHOR_SELECT },
          replies: {
            include: {
              author: { select: AUTHOR_SELECT },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: orderBy },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.comment.count({
        where: visibleCommentWhere,
      }),
    ]);

    return {
      comments: comments.map((comment) => this.mapComment(comment)),
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async createComment(
    projectId: string,
    userId: string,
    content: string,
  ): Promise<CommentResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { publishedAt: true, hiddenAt: true },
    });

    if (!project) {
      throw new CommentProjectNotFoundException(projectId);
    }

    if (!project.publishedAt) {
      throw new CommentProjectNotPublishedException(projectId);
    }
    if (project.hiddenAt) {
      throw new ProjectHiddenException();
    }

    const comment = await this.prisma.comment.create({
      data: {
        content,
        authorId: userId,
        projectId,
      },
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    return this.mapComment(comment);
  }

  async createReply(
    projectId: string,
    commentId: string,
    userId: string,
    content: string,
  ): Promise<CommentResponseDto> {
    const parentComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        parentId: true,
        projectId: true,
        deleted: true,
        hiddenAt: true,
        project: { select: { publishedAt: true, hiddenAt: true } },
      },
    });

    if (!parentComment) {
      throw new CommentNotFoundException(commentId);
    }

    if (parentComment.projectId !== projectId) {
      throw new CommentNotInProjectException();
    }

    if (!parentComment.project.publishedAt) {
      throw new CommentProjectNotPublishedException(projectId);
    }
    if (parentComment.project.hiddenAt) {
      throw new ProjectHiddenException();
    }

    if (parentComment.parentId !== null) {
      throw new CommentNestedReplyException();
    }

    if (parentComment.deleted || parentComment.hiddenAt) {
      throw new CommentReplyToDeletedException();
    }

    const reply = await this.prisma.comment.create({
      data: {
        content,
        authorId: userId,
        projectId,
        parentId: commentId,
      },
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    return this.mapComment(reply);
  }

  async updateComment(
    projectId: string,
    commentId: string,
    userId: string,
    content: string,
  ): Promise<CommentResponseDto> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, projectId: true, deleted: true, hiddenAt: true },
    });

    if (!comment || comment.deleted || comment.hiddenAt) {
      throw new CommentNotFoundException(commentId);
    }

    if (comment.projectId !== projectId) {
      throw new CommentNotInProjectException();
    }

    if (comment.authorId !== userId) {
      throw new CommentNotAuthorException('edit');
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    return this.mapComment(updated);
  }

  async deleteComment(projectId: string, commentId: string, userId: string): Promise<void> {
    const [comment, project] = await Promise.all([
      this.prisma.comment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          authorId: true,
          projectId: true,
          _count: { select: { replies: true } },
        },
      }),
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { userId: true },
      }),
    ]);

    if (!comment) {
      throw new CommentNotFoundException(commentId);
    }

    if (comment.projectId !== projectId) {
      throw new CommentNotInProjectException();
    }

    const isProjectCreator = project?.userId === userId;

    if (comment.authorId !== userId && !isProjectCreator) {
      throw new CommentNotAuthorException('delete');
    }

    if (comment._count.replies > 0) {
      await this.prisma.comment.update({
        where: { id: commentId },
        data: { deleted: true, content: '' },
      });
    } else {
      await this.prisma.comment.delete({
        where: { id: commentId },
      });
    }
  }
}
