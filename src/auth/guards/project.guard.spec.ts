import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from './project.guard';

const USER = uuidOf(9);
const PROJECT = uuidOf(5);

const contextFor = (userId: string | undefined, id: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: userId === undefined ? undefined : { id: userId },
        params: { id },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('project guards', () => {
  const prisma = { project: { findUnique: jest.fn() } };
  const collaborator = new ProjectCollaboratorGuard(prisma as unknown as PrismaService);
  const creator = new ProjectCreatorGuard(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ProjectCollaboratorGuard', () => {
    it('lets a collaborator through', async () => {
      prisma.project.findUnique.mockResolvedValue({ collaborators: [{ id: USER }] });

      await expect(collaborator.canActivate(contextFor(USER, PROJECT))).resolves.toBe(true);
    });

    it('refuses a stranger', async () => {
      prisma.project.findUnique.mockResolvedValue({ collaborators: [] });

      await expect(collaborator.canActivate(contextFor(USER, PROJECT))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('asks only whether the caller collaborates, and loads no user row to find out', async () => {
      prisma.project.findUnique.mockResolvedValue({ collaborators: [{ id: USER }] });

      await collaborator.canActivate(contextFor(USER, PROJECT));

      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: PROJECT },
        select: { collaborators: { where: { id: USER }, select: { id: true } } },
      });
    });

    it('says when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(collaborator.canActivate(contextFor(USER, PROJECT))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('ProjectCreatorGuard', () => {
    it('lets the creator through', async () => {
      prisma.project.findUnique.mockResolvedValue({ creator: { id: USER } });

      await expect(creator.canActivate(contextFor(USER, PROJECT))).resolves.toBe(true);
    });

    it('refuses a collaborator who did not create the project', async () => {
      prisma.project.findUnique.mockResolvedValue({ creator: { id: uuidOf(2) } });

      await expect(creator.canActivate(contextFor(USER, PROJECT))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('says when the project does not exist', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(creator.canActivate(contextFor(USER, PROJECT))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it.each([
    ['a request nobody is signed in on', undefined, PROJECT],
    ['a project id that is not an id', USER, 'five'],
    ['a project id that is a number', USER, '5'],
    ['a project id that only starts as one', USER, `${PROJECT}0`],
  ])('refuses %s before reading anything', async (_case, userId, id) => {
    for (const guard of [collaborator, creator]) {
      await expect(guard.canActivate(contextFor(userId, id))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }

    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
