import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  private buildVisibleTopLevelCommentWhere(projectId: number): Prisma.CommentWhereInput {
    return {
      projectId,
      parentId: null,
      OR: [{ deleted: false }, { deleted: true, replies: { some: {} } }],
    };
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
        author: reply.author,
      })),
    };
  }

  async getComments(
    projectId: number,
    page?: number,
    limit?: number,
    sort: 'newest' | 'oldest' = 'newest',
  ): Promise<PaginatedCommentsResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { publishedAt: true },
    });

    if (!project?.publishedAt) {
      throw new CommentProjectNotFoundException(projectId);
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
    projectId: number,
    userId: number,
    content: string,
  ): Promise<CommentResponseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { publishedAt: true },
    });

    if (!project) {
      throw new CommentProjectNotFoundException(projectId);
    }

    if (!project.publishedAt) {
      throw new CommentProjectNotPublishedException(projectId);
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
    projectId: number,
    commentId: number,
    userId: number,
    content: string,
  ): Promise<CommentResponseDto> {
    const parentComment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        parentId: true,
        projectId: true,
        deleted: true,
        project: { select: { publishedAt: true } },
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

    if (parentComment.parentId !== null) {
      throw new CommentNestedReplyException();
    }

    if (parentComment.deleted) {
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
    projectId: number,
    commentId: number,
    userId: number,
    content: string,
  ): Promise<CommentResponseDto> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, projectId: true, deleted: true },
    });

    if (!comment || comment.deleted) {
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

  async deleteComment(projectId: number, commentId: number, userId: number): Promise<void> {
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
