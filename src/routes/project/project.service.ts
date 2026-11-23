import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnalyticsFactType, Prisma, Project } from '@prisma/client';

import { PROJECT_CHANGED, ProjectChangedEvent } from '../../common/domain-events';
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
import { DiskStyleDto } from './dto/disk-style.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { diskOf } from './hub-fields';
import { ProjectHiddenException } from './project.error';
import { projectKeys } from './project-keys';
import {
  DEFAULT_LIMIT,
  PaginatedProjectsResult,
  ProjectEx,
  ProjectLook,
  RELEASED,
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
    private readonly eventEmitter: EventEmitter2,
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

  /**
   * The cover's address from the row alone, for a list that cannot afford a storage lookup per
   * game. A cover stored before its version was kept gets the bare address, which the store
   * serves `no-cache`.
   */
  storedCoverUrl(project: Pick<Project, 'id' | 'iconUrl' | 'coverVersion'>): string | null {
    if (!project.iconUrl) {
      return null;
    }
    const url = this.edgeService.getCDNUrl(projectKeys.cover(project.id));

    return project.coverVersion ? versionedUrl(url, project.coverVersion) : url;
  }

  /** Where the edge serves a version of the clip: another address each time the clip changes. */
  private clipUrlAt(projectId: number, version: string): string {
    return versionedUrl(this.edgeService.getCDNUrl(projectKeys.clip(projectId)), version);
  }

  /**
   * How the row says the game is drawn, for an answer that lists or opens it. Like the cover's,
   * the clip's address comes from the row alone.
   */
  lookOf(
    project: Pick<
      Project,
      | 'id'
      | 'iconUrl'
      | 'coverVersion'
      | 'clipVersion'
      | 'diskColor'
      | 'diskFinish'
      | 'diskColor2'
      | 'diskGradDir'
    >,
  ): ProjectLook {
    return {
      coverUrl: this.storedCoverUrl(project),
      clipUrl: project.clipVersion ? this.clipUrlAt(project.id, project.clipVersion) : null,
      disk: diskOf(project),
    };
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
      andClauses.push(RELEASED);
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
  ): Promise<PaginatedProjectsResult<ProjectEx & ProjectLook>> {
    const window = pageWindow(page, limit, DEFAULT_LIMIT);
    const where = this.buildUserProjectsWhere(userId);

    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({
        where,
      }),
      this.prisma.project.findMany({
        where,
        include: WITH_PEOPLE,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: window.skip,
        take: window.take,
      }),
    ]);

    return {
      projects: projects.map((project) => ({ ...project, ...this.lookOf(project) })),
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

  async findOne(id: number): Promise<ProjectEx & ProjectLook> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: WITH_PEOPLE,
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return { ...project, ...this.lookOf(project) };
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

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...updateProjectDto,
        ...(updateProjectDto.tags ? { tags: normalizeTags(updateProjectDto.tags) } : {}),
        ...(updateProjectDto.palette
          ? { palette: updateProjectDto.palette.map((colour) => colour.toLowerCase()) }
          : {}),
      },
    });
    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(id));

    return updated;
  }

  /** Sets the disk of a project whole, or clears it with null. */
  async setDisk(id: number, disk: DiskStyleDto | null): Promise<DiskStyleDto | null> {
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        diskColor: disk?.color.toLowerCase() ?? null,
        diskFinish: disk?.finish ?? null,
        diskColor2: disk?.color2?.toLowerCase() ?? null,
        diskGradDir: disk?.gradDir ?? null,
      },
      select: { diskColor: true, diskFinish: true, diskColor2: true, diskGradDir: true },
    });

    return diskOf(updated);
  }

  /** Puts an object anyone may read at `key`, and answers the version the store gave it. */
  private async storePublic(
    key: string,
    file: Express.Multer.File | DownloadedFile,
    metadata: Record<string, string>,
  ): Promise<string | undefined> {
    await this.s3Service.uploadFile({
      file,
      keyName: key,
      metadata,
      cacheControl: 'no-cache',
    });
    await this.s3Service.setObjectPublicRead(key);

    return (await this.s3Service.getFileMetadataOrNull(key))?.ETag;
  }

  private async storeCover(
    projectId: number,
    file: Express.Multer.File | DownloadedFile,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    const key = projectKeys.cover(projectId);
    const version = await this.storePublic(key, file, metadata);

    // The row keeps the image's public URL and its version, so readers of the project need no
    // storage lookup.
    await this.prisma.project.update({
      where: { id: projectId },
      data: { iconUrl: this.edgeService.getCDNUrl(key), coverVersion: version ?? null },
    });
    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(projectId));
  }

  private async storeClip(
    projectId: number,
    file: Express.Multer.File | DownloadedFile,
    metadata: Record<string, string> = {},
  ): Promise<string> {
    // The version is all the row keeps of a clip: when the store gives none, the time stands in,
    // or the clip just stored would read as absent.
    const clipVersion =
      (await this.storePublic(projectKeys.clip(projectId), file, metadata)) ??
      Date.now().toString();

    await this.prisma.project.update({ where: { id: projectId }, data: { clipVersion } });
    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(projectId));

    return this.clipUrlAt(projectId, clipVersion);
  }

  async uploadImage(id: number, file: Express.Multer.File, uploaderId: number): Promise<void> {
    const project = await this.findOne(id);
    // A cover is public the moment it is stored, which is what withholding a game takes away.
    if (project.hiddenAt) {
      throw new ProjectHiddenException();
    }
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

  /** Stores the clip of a project over the one it has, and answers its address. */
  async uploadClip(id: number, file: Express.Multer.File, uploaderId: number): Promise<string> {
    const project = await this.requireProject(id, { hiddenAt: true });
    // A clip is public the moment it is stored, which is what withholding a game takes away.
    if (project.hiddenAt) {
      throw new ProjectHiddenException();
    }

    return this.storeClip(id, file, {
      uploadedBy: uploaderId.toString(),
      projectId: id.toString(),
    });
  }

  /** Gives `targetProjectId` the clip of `sourceProjectId`, when the source has one. */
  async copyClip(sourceProjectId: number, targetProjectId: number): Promise<void> {
    const sourceClip = projectKeys.clip(sourceProjectId);
    if (await this.s3Service.fileExists(sourceClip)) {
      await this.storeClip(targetProjectId, await this.s3Service.downloadFile({ key: sourceClip }));
    }
  }

  /**
   * The row first: an object left in the store is dropped with the project or replaced by the
   * next clip, while a row still naming a deleted object would hand out an address that fails.
   */
  async removeClip(id: number): Promise<void> {
    const project = await this.requireProject(id, { hiddenAt: true });
    // Its clip is held out of reach for a restore to put back, where this removal would not find it.
    if (project.hiddenAt) {
      throw new ProjectHiddenException();
    }

    await this.prisma.project.update({ where: { id }, data: { clipVersion: null } });
    await this.s3Service.deleteFile({ key: projectKeys.clip(id) });
    this.eventEmitter.emit(PROJECT_CHANGED, new ProjectChangedEvent(id));
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

  /**
   * `alongside` runs in the transaction that deletes the project, for a caller whose own record of
   * the deletion must exist exactly when the project is gone.
   */
  async remove(
    id: number,
    alongside?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    await this.findOne(id);

    // Both session tables reference the project with ON DELETE RESTRICT, so their rows go first,
    // in the same transaction as the project.
    await this.prisma.$transaction(async (tx) => {
      await tx.gameSession.deleteMany({ where: { projectId: id } });
      await tx.workSession.deleteMany({ where: { projectId: id } });
      await tx.project.delete({ where: { id } });
      await alongside?.(tx);
    });

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
