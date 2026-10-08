import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CommentNestedReplyException,
  CommentNotFoundException,
  CommentProjectNotPublishedException,
} from './project-comment.error';
import { ProjectCommentService } from './project-comment.service';

describe('ProjectCommentService', () => {
  let service: ProjectCommentService;

  const prismaMock = {
    comment: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
  };

  const author = { id: 7, username: 'ada', nickname: null };
  const stored = {
    id: 5,
    content: 'Great game!',
    deleted: false,
    createdAt: new Date('2026-08-17T09:00:00Z'),
    projectId: 1,
    authorId: 7,
    parentId: null,
    author,
  };
  const published = { publishedAt: new Date('2026-08-01T09:00:00Z') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectCommentService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<ProjectCommentService>(ProjectCommentService);
    jest.resetAllMocks();
  });

  describe('getComments', () => {
    beforeEach(() => {
      prismaMock.project.findUnique.mockResolvedValue(published);
      prismaMock.comment.findMany.mockResolvedValue([]);
      prismaMock.comment.count.mockResolvedValue(0);
    });

    it('returns a page of top-level comments with their replies', async () => {
      const reply = { ...stored, id: 6, parentId: 5, content: 'Agreed' };
      prismaMock.comment.findMany.mockResolvedValue([{ ...stored, replies: [reply] }]);
      prismaMock.comment.count.mockResolvedValue(1);

      const result = await service.getComments(1, 2, 10, 'oldest');

      expect(prismaMock.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
          skip: 10,
          take: 10,
        }),
      );
      expect(result).toEqual({
        comments: [
          {
            id: 5,
            content: 'Great game!',
            deleted: false,
            createdAt: stored.createdAt,
            projectId: 1,
            author,
            replies: [
              {
                id: 6,
                content: 'Agreed',
                deleted: false,
                createdAt: stored.createdAt,
                projectId: 1,
                author,
              },
            ],
          },
        ],
        total: 1,
        page: 2,
        limit: 10,
      });
    });

    it('keeps a deleted comment only while it still has replies', async () => {
      await service.getComments(1);

      const where = {
        projectId: 1,
        parentId: null,
        OR: [{ deleted: false }, { deleted: true, replies: { some: {} } }],
      };
      expect(prismaMock.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect(prismaMock.comment.count).toHaveBeenCalledWith({ where });
    });

    it.each([
      { page: 0, limit: 1000, expected: { page: 1, limit: 100, skip: 0 } },
      { page: 3.9, limit: 0, expected: { page: 3, limit: 20, skip: 40 } },
      { page: NaN, limit: NaN, expected: { page: 1, limit: 20, skip: 0 } },
    ])('clamps page $page and limit $limit', async ({ page, limit, expected }) => {
      const result = await service.getComments(1, page, limit);

      expect(prismaMock.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: expected.skip, take: expected.limit }),
      );
      expect(result.page).toBe(expected.page);
      expect(result.limit).toBe(expected.limit);
    });

    it.each([
      ['missing', null],
      ['unpublished', { publishedAt: null }],
    ])('answers not found for a %s project', async (_state, project) => {
      prismaMock.project.findUnique.mockResolvedValue(project);

      await expect(service.getComments(1)).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.comment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createComment', () => {
    it('answers not found for a missing project', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.createComment(1, 7, 'Great game!')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    it('refuses a comment on an unpublished project', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ publishedAt: null });

      await expect(service.createComment(1, 7, 'Great game!')).rejects.toBeInstanceOf(
        CommentProjectNotPublishedException,
      );
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    it('stores the comment under its author and project', async () => {
      prismaMock.project.findUnique.mockResolvedValue(published);
      prismaMock.comment.create.mockResolvedValue(stored);

      const result = await service.createComment(1, 7, 'Great game!');

      expect(prismaMock.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { content: 'Great game!', authorId: 7, projectId: 1 },
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 5, content: 'Great game!', author }));
    });
  });

  describe('createReply', () => {
    const parent = {
      id: 5,
      parentId: null,
      projectId: 1,
      deleted: false,
      project: published,
    };

    it('answers not found for a missing parent', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(null);

      await expect(service.createReply(1, 5, 8, 'Agreed')).rejects.toBeInstanceOf(
        CommentNotFoundException,
      );
    });

    it('answers not found for a parent of another project', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(parent);

      const failure: unknown = await service
        .createReply(999, 5, 8, 'Agreed')
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).not.toBeInstanceOf(CommentNotFoundException);
    });

    it('refuses a reply to a reply', async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        ...parent,
        parentId: 4,
      });

      await expect(service.createReply(1, 5, 8, 'Agreed')).rejects.toBeInstanceOf(
        CommentNestedReplyException,
      );
    });

    it('refuses a reply to a deleted comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        ...parent,
        deleted: true,
      });

      await expect(service.createReply(1, 5, 8, 'Agreed')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a reply on an unpublished project', async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        ...parent,
        project: { publishedAt: null },
      });

      await expect(service.createReply(1, 5, 8, 'Agreed')).rejects.toBeInstanceOf(
        CommentProjectNotPublishedException,
      );
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    it('stores the reply under its parent', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(parent);
      prismaMock.comment.create.mockResolvedValue({
        ...stored,
        id: 6,
        parentId: 5,
      });

      await service.createReply(1, 5, 8, 'Agreed');

      expect(prismaMock.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { content: 'Agreed', authorId: 8, projectId: 1, parentId: 5 },
        }),
      );
    });
  });

  describe('updateComment', () => {
    const own = { id: 5, authorId: 7, projectId: 1, deleted: false };

    it('answers not found for a missing comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(null);

      await expect(service.updateComment(1, 5, 7, 'Edited')).rejects.toBeInstanceOf(
        CommentNotFoundException,
      );
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it('refuses an edit by anyone but the author', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(own);

      await expect(service.updateComment(1, 5, 8, 'Edited')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it('answers not found for a comment of another project', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(own);

      const failure: unknown = await service
        .updateComment(999, 5, 7, 'Edited')
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).not.toBeInstanceOf(CommentNotFoundException);
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it('does not edit a deleted comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValue({ ...own, deleted: true });

      await expect(service.updateComment(1, 5, 7, 'Edited')).rejects.toBeInstanceOf(
        CommentNotFoundException,
      );
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it('replaces the content', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(own);
      prismaMock.comment.update.mockResolvedValue({
        ...stored,
        content: 'Edited',
      });

      const result = await service.updateComment(1, 5, 7, 'Edited');

      expect(prismaMock.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5 },
          data: { content: 'Edited' },
        }),
      );
      expect(result.content).toBe('Edited');
    });
  });

  describe('deleteComment', () => {
    const target = {
      id: 5,
      authorId: 7,
      projectId: 1,
      _count: { replies: 0 },
    };

    beforeEach(() => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 3 });
    });

    it('answers not found for a missing comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(null);

      await expect(service.deleteComment(1, 5, 7)).rejects.toBeInstanceOf(CommentNotFoundException);
    });

    it('answers not found for a comment of another project', async () => {
      prismaMock.comment.findUnique.mockResolvedValue(target);

      const failure: unknown = await service
        .deleteComment(999, 5, 7)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).not.toBeInstanceOf(CommentNotFoundException);
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    });

    it("refuses anyone but the author and the project's creator", async () => {
      prismaMock.comment.findUnique.mockResolvedValue(target);

      await expect(service.deleteComment(1, 5, 8)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it.each([
      ['its author', 7],
      ["the project's creator", 3],
    ])('removes a comment without replies for %s', async (_who, userId) => {
      prismaMock.comment.findUnique.mockResolvedValue(target);

      await service.deleteComment(1, 5, userId);

      expect(prismaMock.comment.delete).toHaveBeenCalledWith({
        where: { id: 5 },
      });
      expect(prismaMock.comment.update).not.toHaveBeenCalled();
    });

    it('blanks a comment that has replies instead of removing it', async () => {
      prismaMock.comment.findUnique.mockResolvedValue({
        ...target,
        _count: { replies: 2 },
      });

      await service.deleteComment(1, 5, 7);

      expect(prismaMock.comment.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { deleted: true, content: '' },
      });
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    });
  });
});
