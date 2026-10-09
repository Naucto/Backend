import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AnalyticsFactType, Prisma, Project } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateNotificationInput } from '../../notifications/notifications.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsFactService, projectCreatedFactKey } from '../analytics/analytics-fact.service';
import { EdgeService, versionedUrl } from '../s3/edge.service';
import { DownloadedFile } from '../s3/s3.interface';
import { S3Service } from '../s3/s3.service';
import { WorkSessionService } from '../work-session/work-session.service';
import { AddCollaboratorDto, RemoveCollaboratorDto } from './dto/collaborator-project.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { projectKeys } from './project-keys';
import {
  DEFAULT_LIMIT,
  PaginatedProjectsResult,
  ProjectEx,
  PUBLISHED,
  WITH_PEOPLE,
} from './project-select';
import { normalizeTags } from './project-tags';

export const USER_PROJECT_STATUSES = ['all', 'drafts', 'published'] as const;
export type UserProjectStatus = (typeof USER_PROJECT_STATUSES)[number];

export type UserProjectFilters = {
  search?: string;
  tags?: string[];
  status?: UserProjectStatus;
};

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  private notificationsService?: NotificationsService;

  constructor(
    private prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly edgeService: EdgeService,
    private readonly moduleRef: ModuleRef,
    private readonly facts: AnalyticsFactService,
  ) {}

  private async notify(notification: CreateNotificationInput): Promise<void> {
    // Resolved through ModuleRef: importing the notifications module would close an import cycle
    // through auth and users that forwardRef cannot break.
    this.notificationsService ??= this.moduleRef.get(NotificationsService, { strict: false });
    await this.notificationsService.notifyBestEffort(notification);
  }

  /** The project's row narrowed to `select`, or a 404. */
  async requireProject<S extends Prisma.ProjectSelect>(
    id: number,
    select: S,
  ): Promise<Prisma.ProjectGetPayload<{ select: S }>> {
    const project = await this.prisma.project.findUnique({ where: { id }, select });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project as Prisma.ProjectGetPayload<{ select: S }>;
  }

  private buildUserProjectsWhere(
    userId: number,
    filters: UserProjectFilters = {},
  ): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = {
      collaborators: {
        some: {
          id: userId,
        },
      },
    };

    const andClauses: Prisma.ProjectWhereInput[] = [];
    const normalizedSearch = filters.search?.trim();
    const normalizedTags = normalizeTags(filters.tags);

    if (filters.status === 'published') {
      andClauses.push(PUBLISHED);
    } else if (filters.status === 'drafts') {
      andClauses.push({ publishedAt: null });
    }

    if (normalizedSearch) {
      andClauses.push({
        name: {
          contains: normalizedSearch,
          mode: 'insensitive',
        },
      });
    }

    if (normalizedTags.length > 0) {
      andClauses.push({
        tags: {
          hasEvery: normalizedTags,
        },
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    return where;
  }

  async findAll(
    userId: number,
    page?: number,
    limit?: number,
  ): Promise<PaginatedProjectsResult<ProjectEx>> {
    const window = pageWindow(page, limit, DEFAULT_LIMIT);
    const where = this.buildUserProjectsWhere(userId);

    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({
        where,
      }),
      this.prisma.project.findMany({
        where,
        include: WITH_PEOPLE,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: window.skip,
        take: window.take,
      }),
    ]);

    return {
      projects,
      total,
      page: window.page,
      limit: window.limit,
    };
  }

  async countUserProjects(userId: number, filters: UserProjectFilters = {}): Promise<number> {
    return this.prisma.project.count({
      where: this.buildUserProjectsWhere(userId, filters),
    });
  }

  async findOne(id: number): Promise<ProjectEx> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: WITH_PEOPLE,
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(createProjectDto: CreateProjectDto, userId: number): Promise<Project> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          ...createProjectDto,
          tags: normalizeTags(createProjectDto.tags),
          collaborators: {
            connect: [{ id: userId }],
          },
          creator: { connect: { id: userId } },
        },
        include: WITH_PEOPLE,
      });
      await this.recordProjectCreated(tx, project.id, userId);
      return project;
    });
  }

  /** Called by every path that creates a project, once the project is there to stay. */
  async recordProjectCreated(
    tx: Prisma.TransactionClient,
    projectId: number,
    userId: number,
  ): Promise<void> {
    await this.facts.record(tx, {
      type: AnalyticsFactType.PROJECT_CREATED,
      dedupeKey: projectCreatedFactKey(projectId),
      actorUserId: userId,
      projectId,
    });
  }

  async update(id: number, updateProjectDto: UpdateProjectDto): Promise<Project> {
    await this.findOne(id);

    return this.prisma.project.update({
      where: { id },
      data: {
        ...updateProjectDto,
        ...(updateProjectDto.tags ? { tags: normalizeTags(updateProjectDto.tags) } : {}),
      },
    });
  }

  private async storeCover(
    projectId: number,
    file: Express.Multer.File | DownloadedFile,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    const key = projectKeys.cover(projectId);
    await this.s3Service.uploadFile({
      file,
      keyName: key,
      metadata,
      cacheControl: 'no-cache',
    });
    await this.s3Service.setObjectPublicRead(key);

    // The row keeps the image's public URL, so readers of the project need no storage lookup.
    await this.prisma.project.update({
      where: { id: projectId },
      data: { iconUrl: this.edgeService.getCDNUrl(key) },
    });
  }

  async uploadImage(id: number, file: Express.Multer.File, uploaderId: number): Promise<void> {
    await this.findOne(id);
    await this.storeCover(id, file, {
      uploadedBy: uploaderId.toString(),
      projectId: id.toString(),
    });
  }

  /** Gives `targetProjectId` the cover of `sourceProjectId`, when the source has one. */
  async copyCover(sourceProjectId: number, targetProjectId: number): Promise<void> {
    const sourceCover = projectKeys.cover(sourceProjectId);
    if (await this.s3Service.fileExists(sourceCover)) {
      await this.storeCover(
        targetProjectId,
        await this.s3Service.downloadFile({ key: sourceCover }),
      );
    }
  }

  /** The versioned CDN URL of the cover, or null when the project has none. */
  async coverUrl(projectId: number): Promise<string | null> {
    const key = projectKeys.cover(projectId);
    const head = await this.s3Service.getFileMetadataOrNull(key);

    return head ? versionedUrl(this.edgeService.getCDNUrl(key), head.ETag) : null;
  }

  private async removeStoredContent(id: number): Promise<void> {
    try {
      const { keys, prefixes } = projectKeys.owned(id);
      for (const key of keys) {
        await this.s3Service.deleteFile({ key });
      }

      for (const prefix of prefixes) {
        const objects = await this.s3Service.listObjects({ prefix });
        if (objects.length > 0) {
          await this.s3Service.deleteFiles({ keys: objects.map((object) => object.Key!) });
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Project ${id} was deleted but its stored content was not: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    // Both session tables reference the project with ON DELETE RESTRICT, so their rows go first,
    // in the same transaction as the project.
    await this.prisma.$transaction([
      this.prisma.gameSession.deleteMany({ where: { projectId: id } }),
      this.prisma.workSession.deleteMany({ where: { projectId: id } }),
      this.prisma.project.delete({ where: { id } }),
    ]);

    // After the row, and never fatally: an orphaned blob can still be swept, content dropped
    // ahead of a failed delete cannot be restored.
    await this.removeStoredContent(id);
  }

  private async findUserByIdentifier(
    dto: AddCollaboratorDto | RemoveCollaboratorDto,
  ): Promise<{ id: number }> {
    let user: { id: number } | null = null;
    let identifier: string;

    if (dto.userId) {
      identifier = dto.userId.toString();
      user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true },
      });
    } else if (dto.username) {
      identifier = dto.username;
      user = await this.prisma.user.findUnique({
        where: { username: dto.username },
        select: { id: true },
      });
    } else if (dto.email) {
      identifier = dto.email;
      user = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
    } else {
      throw new BadRequestException('Either userId, username or email must be provided');
    }

    if (!user) {
      throw new NotFoundException(`User with identifier '${identifier}' not found`);
    }

    return user;
  }

  async addCollaborator(id: number, addCollaboratorDto: AddCollaboratorDto): Promise<ProjectEx> {
    const user = await this.findUserByIdentifier(addCollaboratorDto);
    const project = await this.findOne(id);

    if (project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException('User is already a collaborator on this project');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        collaborators: { connect: { id: user.id } },
      },
      include: WITH_PEOPLE,
    });

    // The invitee has no other signal that they were added; the project id lets the notification
    // open the project.
    await this.notify({
      userId: user.id,
      title: updated.name,
      message: `${project.creator.username} added you to ${updated.name}`,
      type: 'INFO',
      kind: 'COLLABORATOR_ADDED',
      data: { projectId: updated.id },
    });

    return updated;
  }

  async removeCollaborator(
    id: number,
    removeCollaboratorDto: RemoveCollaboratorDto,
  ): Promise<ProjectEx> {
    const user = await this.findUserByIdentifier(removeCollaboratorDto);
    const project = await this.findOne(id);

    if (user.id === project.userId) {
      throw new ForbiddenException('Cannot remove the project creator');
    }

    if (!project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException('User is not a collaborator on this project');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        collaborators: {
          disconnect: { id: user.id },
        },
      },
      include: WITH_PEOPLE,
    });

    // No projectId: the removed collaborator has nothing left to open.
    await this.notify({
      userId: user.id,
      title: updated.name,
      message: `${project.creator.username} removed you from ${updated.name}`,
      type: 'INFO',
      kind: 'COLLABORATOR_REMOVED',
    });

    // The live session keeps its own member list, so the removal has to evict them from it too.
    const sessions = this.moduleRef.get(WorkSessionService, { strict: false });
    await sessions.kick(id, user.id).catch((error: unknown) => {
      // No open session on the project is the common case, not a failure of the removal.
      if (!(error instanceof NotFoundException)) {
        this.logger.error(
          `Could not close the session of user ${user.id} on project ${id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    });

    return updated;
  }
}
