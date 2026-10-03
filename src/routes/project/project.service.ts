import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { PrismaService, isUniqueViolation } from "@ourPrisma/prisma.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto
} from "./dto/collaborator-project.dto";
import { PROJECT_NAME_MAX_LENGTH } from "./dto/project-field-limits";
import { S3Service } from "@s3/s3.service";
import { EdgeService } from "src/routes/s3/edge.service";
import { ModuleRef } from "@nestjs/core";
import { NotificationsService } from "src/notifications/notifications.service";
import { WorkSessionService } from "@work-session/work-session.service";
import { Prisma, Project } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { DownloadedFile } from "@s3/s3.interface";
import { Readable } from "stream";
import { buffer } from "node:stream/consumers";
import {
  ContentSizeBreakdown,
  PROJECT_BLOB_MAX_BYTES,
  PROJECT_CONTENT_MAX_BYTES,
  computeContentSize,
  isContentSizeBreakdown
} from "./content-size";
import { viewerKeyOf } from "./viewer-key";
import {
  CheckpointLimitException,
  ProjectNotPublishedException,
  ProjectTooLargeException
} from "./project.error";

// What a project says about its people, on public routes as well as private ones: the id
// and the name, never the address behind the account.
export const CREATOR_SELECT = {
  id: true,
  username: true
};

export const COLLABORATOR_SELECT = {
  id: true,
  username: true
};

const WITH_PEOPLE = {
  collaborators: { select: COLLABORATOR_SELECT },
  creator: { select: CREATOR_SELECT }
} satisfies Prisma.ProjectInclude;

const WITH_PEOPLE_AND_COUNTS = {
  ...WITH_PEOPLE,
  _count: {
    select: { forks: true, comments: { where: { deleted: false } } }
  }
} satisfies Prisma.ProjectInclude;

export type ProjectEx = Project & {
  collaborators: Array<{ id: number; username: string }>;
  creator: { id: number; username: string };
};

export type ProjectSave = {
  name: string;
  date: Date;
};

type ProjectWithCounts = ProjectEx & {
  _count: {
    comments: number;
    forks: number;
  };
};

/** Just enough of the parent to render "remixed from Snake by alice" instead of "#42". */
export type ForkedFromSummary = {
  id: number;
  name: string;
  ownerUsername: string;
};

type ReleaseProject = ProjectEx & {
  commentCount: number;
  forkCount: number;
  forkedFrom?: ForkedFromSummary | null;
};

export type ProjectLimits = {
  maxContentBytes: number;
  maxBlobBytes: number;
  maxCheckpoints: number;
  maxAutosaves: number;
};

export type ProjectSize = {
  projectId: number;
  contentSize: ContentSizeBreakdown;
  maxContentBytes: number;
  withinBudget: boolean;
};

export type PaginatedProjectsResult<T> = {
  projects: T[];
  total: number;
  page: number;
  limit: number;
};

export const RELEASE_WINDOWS = ["all", "365d", "30d", "7d"] as const;
export type ReleaseWindow = (typeof RELEASE_WINDOWS)[number];

/**
 * Shelf orderings, applied in the query: a client holds one page and cannot order what it has not
 * fetched.
 */
export const RELEASE_SORTS = ["fresh", "popular", "liked", "discussed", "name"] as const;
export type ReleaseSort = (typeof RELEASE_SORTS)[number];

// The one test for "on the hub". `status` is what the author calls the game; this is what the
// hub does with it, and it is set only once the release blob is in place.
const PUBLISHED: Prisma.ProjectWhereInput = { publishedAt: { not: null } };

// The release sits at one key for the life of the game and the player fetches it straight from
// the edge, so every copy on the way has to ask before serving what it kept.
const RELEASE_CACHE_CONTROL = "no-cache";

/**
 * Newest autosave first. A key is the millisecond the save was made; S3's LastModified is whole
 * seconds, so two saves in one second tie there and a stable sort would hand back the older one.
 */
const newestFirst = (a: ProjectSave, b: ProjectSave): number =>
  Number(b.name) - Number(a.name) || b.date.getTime() - a.date.getTime();

/**
 * A version's name as it may land in an S3 key: anything that could climb out of the project's
 * prefix is refused rather than escaped.
 */
const keyName = (raw: string): string => {
  const name = raw.trim();
  if (!name || name.includes("/") || name.includes("..")) {
    throw new BadRequestException(`Invalid version name: ${raw}`);
  }

  return name;
};

const coverKey = (projectId: number): string => `projects/${projectId}/image`;

const RELEASE_ORDER_BY: Record<ReleaseSort, Prisma.ProjectOrderByWithRelationInput[]> = {
  fresh: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  popular: [{ viewCount: "desc" }, { publishedAt: "desc" }],
  liked: [{ likes: "desc" }, { publishedAt: "desc" }],
  discussed: [{ comments: { _count: "desc" } }, { publishedAt: "desc" }],
  name: [{ publishedName: "asc" }, { name: "asc" }]
};

export const USER_PROJECT_STATUSES = ["all", "drafts", "published"] as const;
export type UserProjectStatus = (typeof USER_PROJECT_STATUSES)[number];

export type PublishedProjectFilters = {
  search?: string;
  tags?: string[];
  releaseWindow?: ReleaseWindow;
};

export type UserProjectFilters = {
  search?: string;
  tags?: string[];
  status?: UserProjectStatus;
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RELEASE_WINDOW_DAYS: Record<Exclude<ReleaseWindow, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "365d": 365
};

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  private readonly maxAutosaves: number;
  private readonly maxCheckpoints: number;
  private readonly autosaveWindowMs: number;
  private readonly viewSecret: string;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly edgeService: EdgeService,
    private readonly moduleRef: ModuleRef
  ) {
    // The default keeps only the last few autosaves: a state worth keeping longer is one the
    // author names, and a named version is never pruned.
    this.maxAutosaves = Number(
      configService.get<string>("S3_MAX_AUTO_HISTORY_VERSION") || 4
    );
    this.maxCheckpoints = Number(
      configService.get<string>("S3_MAX_CHECKPOINTS") || 20
    );
    // Minutes in the environment; a slot stays open this long.
    this.autosaveWindowMs =
      Number(configService.get<string>("S3_AUTO_HISTORY_DELAY") || 10) * 60000;
    this.viewSecret =
      configService.get<string>("VIEW_HASH_SECRET") ||
      configService.getOrThrow<string>("JWT_SECRET");
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags) {
      return [];
    }

    const normalized = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 12);

    return normalized.filter(
      (tag, index, array) =>
        array.findIndex(
          (candidate) =>
            candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()
        ) === index
    );
  }

  private normalizePagination(
    page: number,
    limit: number
  ): { page: number; limit: number; skip: number } {
    const safePage = Number.isFinite(page)
      ? Math.max(DEFAULT_PAGE, Math.trunc(page))
      : DEFAULT_PAGE;
    const safeLimit = Number.isFinite(limit)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
      : DEFAULT_LIMIT;

    return {
      page: safePage,
      limit: safeLimit,
      skip: (safePage - 1) * safeLimit
    };
  }

  private withCounts(project: ProjectWithCounts): ReleaseProject {
    const { _count, ...rest } = project;
    return {
      ...rest,
      commentCount: _count.comments,
      forkCount: _count.forks
    };
  }

  private applyPublishedSnapshot(project: ReleaseProject): ReleaseProject {
    const publishedTags = project.publishedTags;

    return {
      ...project,
      name: project.publishedName || project.name,
      shortDesc: project.publishedShortDesc ?? project.shortDesc,
      longDesc: project.publishedLongDesc ?? project.longDesc,
      tags: publishedTags.length > 0 ? publishedTags : project.tags
    };
  }

  private normalizePage(page?: number): number {
    if (!page || Number.isNaN(page) || page < 1) {
      return DEFAULT_PAGE;
    }

    return Math.floor(page);
  }

  private normalizeLimit(limit?: number): number {
    if (!limit || Number.isNaN(limit) || limit < 1) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(limit), MAX_LIMIT);
  }

  /**
   * A tag matches whole or not at all: Prisma compares array members and cannot look inside one.
   */
  private searchClauses(term: string): Prisma.ProjectWhereInput[] {
    const contains = { contains: term, mode: "insensitive" } as const;

    return [
      { publishedName: contains },
      { name: contains },
      { publishedShortDesc: contains },
      { shortDesc: contains },
      { publishedTags: { hasSome: [term, term.toLowerCase()] } },
      { tags: { hasSome: [term, term.toLowerCase()] } },
      { creator: { username: contains } },
      { creator: { nickname: contains } }
    ];
  }

  private buildPublishedGamesWhere(
    filters: PublishedProjectFilters = {}
  ): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = { ...PUBLISHED };
    const andClauses: Prisma.ProjectWhereInput[] = [];
    const normalizedSearch = filters.search?.trim();
    const normalizedTags = this.normalizeTags(filters.tags);

    if (filters.releaseWindow && filters.releaseWindow !== "all") {
      const threshold = new Date(
        Date.now() - RELEASE_WINDOW_DAYS[filters.releaseWindow] * DAY_IN_MS
      );

      andClauses.push({
        OR: [
          { publishedAt: { gte: threshold } },
          {
            AND: [{ publishedAt: null }, { createdAt: { gte: threshold } }]
          }
        ]
      });
    }

    if (normalizedSearch) {
      andClauses.push({ OR: this.searchClauses(normalizedSearch) });
    }

    if (normalizedTags.length > 0) {
      andClauses.push({
        OR: [
          {
            publishedTags: {
              hasEvery: normalizedTags
            }
          },
          {
            AND: [
              {
                publishedTags: {
                  isEmpty: true
                }
              },
              {
                tags: {
                  hasEvery: normalizedTags
                }
              }
            ]
          }
        ]
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    return where;
  }

  private buildUserProjectsWhere(
    userId: number,
    filters: UserProjectFilters = {}
  ): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = {
      collaborators: {
        some: {
          id: userId
        }
      }
    };

    const andClauses: Prisma.ProjectWhereInput[] = [];
    const normalizedSearch = filters.search?.trim();
    const normalizedTags = this.normalizeTags(filters.tags);

    if (filters.status === "published") {
      andClauses.push(PUBLISHED);
    } else if (filters.status === "drafts") {
      andClauses.push({ publishedAt: null });
    }

    if (normalizedSearch) {
      andClauses.push({
        name: {
          contains: normalizedSearch,
          mode: "insensitive"
        }
      });
    }

    if (normalizedTags.length > 0) {
      andClauses.push({
        tags: {
          hasEvery: normalizedTags
        }
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
    limit?: number
  ): Promise<PaginatedProjectsResult<ProjectEx>> {
    const safePage = this.normalizePage(page);
    const safeLimit = this.normalizeLimit(limit);
    const skip = (safePage - 1) * safeLimit;
    const where = this.buildUserProjectsWhere(userId);

    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({
        where
      }),
      this.prisma.project.findMany({
        where,
        include: WITH_PEOPLE,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take: safeLimit
      })
    ]);

    return {
      projects,
      total,
      page: safePage,
      limit: safeLimit
    };
  }

  async findOne(id: number): Promise<ProjectEx> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: WITH_PEOPLE
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(
    createProjectDto: CreateProjectDto,
    userId: number
  ): Promise<Project> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return this.prisma.project.create({
      data: {
        ...createProjectDto,
        tags: this.normalizeTags(createProjectDto.tags),
        collaborators: {
          connect: [{ id: userId }]
        },
        creator: { connect: { id: userId } }
      },
      include: WITH_PEOPLE
    });
  }

  async update(
    id: number,
    updateProjectDto: UpdateProjectDto
  ): Promise<Project> {
    await this.findOne(id);

    return this.prisma.project.update({
      where: { id },
      data: {
        ...updateProjectDto,
        ...(updateProjectDto.tags
          ? { tags: this.normalizeTags(updateProjectDto.tags) }
          : {})
      }
    });
  }

  private async storeCover(
    projectId: number,
    file: Express.Multer.File | DownloadedFile,
    metadata: Record<string, string> = {}
  ): Promise<void> {
    const key = coverKey(projectId);
    await this.s3Service.uploadFile({
      file,
      keyName: key,
      metadata,
      cacheControl: "no-cache"
    });
    await this.s3Service.setObjectPublicRead(key);

    // The row keeps the image's public URL, so readers of the project need no storage lookup.
    await this.prisma.project.update({
      where: { id: projectId },
      data: { iconUrl: this.edgeService.getCDNUrl(key) }
    });
  }

  async uploadImage(
    id: number,
    file: Express.Multer.File,
    uploaderId: number
  ): Promise<void> {
    await this.findOne(id);
    await this.storeCover(id, file, {
      uploadedBy: uploaderId.toString(),
      projectId: id.toString()
    });
  }

  private async removeStoredContent(id: number): Promise<void> {
    try {
      await this.s3Service.deleteFile({ key: `release/${id}` });
      await this.s3Service.deleteFile({ key: coverKey(id) });

      for (const prefix of [`checkpoint/${id}/`, `save/${id}/`]) {
        const objects = await this.s3Service.listObjects({ prefix });
        if (objects.length > 0) {
          await this.s3Service.deleteFiles({ keys: objects.map((o) => o.Key!) });
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Project ${id} was deleted but its stored content was not: ${
          error instanceof Error ? error.message : "unknown error"
        }`
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
      this.prisma.project.delete({ where: { id } })
    ]);

    // After the row, and never fatally: an orphaned blob can still be swept, content dropped
    // ahead of a failed delete cannot be restored.
    await this.removeStoredContent(id);
  }

  private async findUserByIdentifier(
    dto: AddCollaboratorDto | RemoveCollaboratorDto
  ): Promise<{ id: number }> {
    let user: { id: number } | null = null;
    let identifier: string;

    if (dto.userId) {
      identifier = dto.userId.toString();
      user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true }
      });
    } else if (dto.username) {
      identifier = dto.username;
      user = await this.prisma.user.findUnique({
        where: { username: dto.username },
        select: { id: true }
      });
    } else if (dto.email) {
      identifier = dto.email;
      user = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true }
      });
    } else {
      throw new BadRequestException(
        "Either userId, username or email must be provided"
      );
    }

    if (!user) {
      throw new NotFoundException(
        `User with identifier '${identifier}' not found`
      );
    }

    return user;
  }

  async addCollaborator(
    id: number,
    addCollaboratorDto: AddCollaboratorDto
  ): Promise<ProjectEx> {
    const user = await this.findUserByIdentifier(addCollaboratorDto);
    const project = await this.findOne(id);

    if (project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException(
        "User is already a collaborator on this project"
      );
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        collaborators: { connect: { id: user.id } }
      },
      include: WITH_PEOPLE
    });

    // Resolved through ModuleRef: importing the notifications module would close an import cycle
    // through auth and users that forwardRef cannot break.
    const notifications = this.moduleRef.get(NotificationsService, {
      strict: false
    });
    // The invitee has no other signal that they were added; the project id lets the notification
    // open the project.
    await notifications.createNotification({
      userId: user.id,
      title: updated.name,
      message: `${project.creator.username} added you to ${updated.name}`,
      type: "INFO",
      kind: "COLLABORATOR_ADDED",
      data: { projectId: updated.id }
    });

    return updated;
  }

  async removeCollaborator(
    id: number,
    removeCollaboratorDto: RemoveCollaboratorDto
  ): Promise<ProjectEx> {
    const user = await this.findUserByIdentifier(removeCollaboratorDto);
    const project = await this.findOne(id);

    if (user.id === project.userId) {
      throw new ForbiddenException("Cannot remove the project creator");
    }

    if (!project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException(
        "User is not a collaborator on this project"
      );
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        collaborators: {
          disconnect: { id: user.id }
        }
      },
      include: WITH_PEOPLE
    });

    const notifications = this.moduleRef.get(NotificationsService, {
      strict: false
    });
    // No projectId: the removed collaborator has nothing left to open.
    await notifications.createNotification({
      userId: user.id,
      title: updated.name,
      message: `${project.creator.username} removed you from ${updated.name}`,
      type: "INFO",
      kind: "COLLABORATOR_REMOVED"
    });

    // The live session keeps its own member list, so the removal has to evict them from it too.
    const sessions = this.moduleRef.get(WorkSessionService, { strict: false });
    await sessions.kick(id, user.id).catch((error: unknown) => {
      // No open session on the project is the common case, not a failure of the removal.
      if (!(error instanceof NotFoundException)) {
        this.logger.error(
          `Could not close the session of user ${user.id} on project ${id}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    });

    return updated;
  }

  /**
   * Persists a size breakdown; passing the row's edit time keeps the write from counting as an
   * edit.
   */
  private async storeContentSize(
    projectId: number,
    contentSize: ContentSizeBreakdown,
    updatedAt?: Date
  ): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        contentSize: contentSize as unknown as Prisma.InputJsonObject,
        contentSizeTotal: contentSize.total,
        ...(updatedAt ? { updatedAt } : {})
      }
    });
  }

  /**
   * An autosave lands in a slot: one key per `autosaveWindowMs` window, rewritten by every save
   * inside the window, so a long session costs one slot per window rather than one per pause in
   * the typing. Past the window a new slot opens and the oldest go, keeping `maxAutosaves`.
   */
  async save(projectId: number, file: Express.Multer.File): Promise<void> {
    // Decoded before anything is stored: a blob that is not a game document would otherwise become
    // the newest save.
    let contentSize: ContentSizeBreakdown | undefined;
    if (file.buffer) {
      try {
        contentSize = computeContentSize(file.buffer);
      } catch {
        throw new UnprocessableEntityException("Not a game document");
      }
    }

    const saves = (await this.listVersions(projectId)).sort(newestFirst);
    const now = Date.now();
    const newest = saves[0];
    const slot =
      newest && now - Number(newest.name) < this.autosaveWindowMs
        ? newest.name
        : String(now);

    if (slot !== newest?.name) {
      const kept = Math.max(this.maxAutosaves - 1, 0);
      for (const stale of saves.slice(kept)) {
        await this.s3Service.deleteFile({
          key: `save/${projectId}/${stale.name}`
        });
      }
    }

    await this.prisma.workSession.updateMany({
      where: { projectId },
      data: { lastSaveAt: new Date() }
    });
    await this.s3Service.uploadFile({
      file,
      keyName: `save/${projectId}/${slot}`
    });

    if (contentSize) {
      await this.storeContentSize(projectId, contentSize);
    }
  }

  getLimits(): ProjectLimits {
    return {
      maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
      maxBlobBytes: PROJECT_BLOB_MAX_BYTES,
      maxCheckpoints: this.maxCheckpoints,
      maxAutosaves: this.maxAutosaves
    };
  }

  /** Decodes the latest save and persists its size breakdown, without counting as an edit. */
  async recomputeContentSize(projectId: number): Promise<ContentSizeBreakdown> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { updatedAt: true }
    });
    const file = await this.fetchLastVersion(projectId);
    const contentSize = computeContentSize(await buffer(file.body));
    await this.storeContentSize(projectId, contentSize, project?.updatedAt);
    return contentSize;
  }

  /** Returns the stored breakdown, computing it from the latest save if missing. */
  async getContentSize(projectId: number): Promise<ProjectSize> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { contentSize: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const contentSize = isContentSizeBreakdown(project.contentSize)
      ? project.contentSize
      : await this.recomputeContentSize(projectId);

    return {
      projectId,
      contentSize,
      maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
      withinBudget: contentSize.total <= PROJECT_CONTENT_MAX_BYTES
    };
  }

  /**
   * Recomputes the size of the latest save and rejects it with a 413 when it
   * exceeds the budget. Returns the release file so callers upload the exact
   * bytes that were measured.
   */
  private async assertWithinBudget(projectId: number): Promise<DownloadedFile> {
    const file = await this.fetchLastVersion(projectId);
    const bytes = await buffer(file.body);
    const contentSize = computeContentSize(bytes);
    await this.storeContentSize(projectId, contentSize);

    if (contentSize.total > PROJECT_CONTENT_MAX_BYTES) {
      throw new ProjectTooLargeException(
        contentSize,
        PROJECT_CONTENT_MAX_BYTES
      );
    }

    return {
      body: Readable.from(bytes),
      contentType: file.contentType ?? "application/octet-stream",
      contentLength: bytes.byteLength
    };
  }

  /** Projects whose size breakdown has never been computed (oldest first). */
  async findProjectsWithoutContentSize(limit: number): Promise<number[]> {
    const projects = await this.prisma.project.findMany({
      where: { contentSizeTotal: null },
      select: { id: true },
      orderBy: { id: "asc" },
      take: limit
    });
    return projects.map((project) => project.id);
  }

  /** Saving under a name that exists rewrites that version, so the cap only meets a new name. */
  async checkpoint(projectId: number, rawName: string): Promise<void> {
    const name = keyName(rawName);
    const existing = await this.listCheckpoints(projectId);
    const overwriting = existing.some((c) => c.name === name);
    if (!overwriting && existing.length >= this.maxCheckpoints) {
      throw new CheckpointLimitException(existing.length, this.maxCheckpoints);
    }

    const file = await this.fetchLastVersion(projectId);

    await this.s3Service.uploadFile({
      file: file,
      keyName: `checkpoint/${projectId}/${name}`
    });
  }

  async removeCheckpoint(projectId: number, checkpoint: string): Promise<void> {
    await this.s3Service.deleteFile({
      key: `checkpoint/${projectId}/${keyName(checkpoint)}`
    });
  }

  /**
   * Uploads the latest save as the release and only then marks the row, so a row never says
   * published while the hub has nothing to serve.
   */
  private async writeRelease(
    projectId: number,
    snapshot: Pick<Project, "name" | "shortDesc" | "longDesc" | "tags">
  ): Promise<void> {
    const file = await this.assertWithinBudget(projectId);
    const releaseKey = `release/${projectId}`;
    await this.s3Service.uploadFile({
      file: file,
      keyName: releaseKey,
      cacheControl: RELEASE_CACHE_CONTROL
    });
    await this.s3Service.setObjectPublicRead(releaseKey);

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        publishedAt: new Date(),
        publishedName: snapshot.name,
        publishedShortDesc: snapshot.shortDesc,
        publishedLongDesc: snapshot.longDesc,
        publishedTags: snapshot.tags
      }
    });
  }

  async publish(projectId: number): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        shortDesc: true,
        longDesc: true,
        tags: true
      }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    await this.writeRelease(projectId, project);
  }

  async unpublish(projectId: number): Promise<void> {
    // The row first: a blob nobody points at is harmless, a row pointing at a deleted blob is not.
    await this.prisma.project.update({
      where: { id: projectId },
      data: { publishedAt: null }
    });

    await this.s3Service.deleteFile({ key: `release/${projectId}` });
  }

  async updateRelease(projectId: number): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        publishedAt: true,
        name: true,
        shortDesc: true,
        longDesc: true,
        tags: true
      }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    if (!project.publishedAt) {
      throw new ProjectNotPublishedException(projectId);
    }

    await this.writeRelease(projectId, project);
  }

  async listVersions(projectId: number): Promise<ProjectSave[]> {
    return (
      await this.s3Service.listObjects({ prefix: `save/${projectId}/` })
    ).map((o) => ({ name: o.Key!.split("/").pop()!, date: o.LastModified! }));
  }

  async listCheckpoints(projectId: number): Promise<ProjectSave[]> {
    return (
      await this.s3Service.listObjects({ prefix: `checkpoint/${projectId}/` })
    ).map((o) => ({ name: o.Key!.split("/").pop()!, date: o.LastModified! }));
  }

  /**
   * Removes one autosave, or throws NotFoundException when the project holds no save of that name.
   */
  async deleteVersion(projectId: number, version: string): Promise<void> {
    const name = keyName(version);

    const existing = await this.listVersions(projectId);

    if (!existing.some((v) => v.name === name)) {
      throw new NotFoundException(
        `Version ${name} not found for project ${projectId}`
      );
    }

    await this.s3Service.deleteFile({ key: `save/${projectId}/${name}` });
  }

  async fetchSavedVersion(
    projectId: number,
    version: string
  ): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({
      key: `save/${projectId}/${keyName(version)}`
    });
  }

  async fetchLastVersion(projectId: number): Promise<DownloadedFile> {
    const files = (await this.listVersions(projectId)).sort(newestFirst);

    if (files.length === 0 || !files[0]?.name) {
      return {
        body: Readable.from([]),
        contentType: "application/octet-stream",
        contentLength: 0
      };
    }

    const filename = `save/${projectId}/${files[0].name}`;
    return this.s3Service.downloadFile({ key: filename });
  }

  async fetchCheckpoint(
    projectId: number,
    checkpoint: string
  ): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({
      key: `checkpoint/${projectId}/${keyName(checkpoint)}`
    });
  }

  /** Throws NotFoundException unless the project is on the hub. */
  async assertPublished(id: number): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id, ...PUBLISHED },
      select: { id: true }
    });

    if (!project) {
      throw new NotFoundException("Not found");
    }
  }

  async fetchRelease(projectId: number): Promise<ReleaseProject> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId
      },
      include: {
        ...WITH_PEOPLE_AND_COUNTS,
        // The parent by name, so lineage reads without a second request that 404s whenever the
        // original was never published.
        forkedFrom: {
          select: {
            id: true,
            name: true,
            publishedName: true,
            creator: { select: { username: true } }
          }
        }
      }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const parent = project.forkedFrom;

    return {
      ...this.applyPublishedSnapshot(this.withCounts(project)),
      forkedFrom: parent
        ? {
          id: parent.id,
          name: parent.publishedName ?? parent.name,
          ownerUsername: parent.creator.username
        }
        : null
    };
  }

  async fetchReleaseContent(projectId: number): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({ key: `release/${projectId}` });
  }

  async fetchPublishedGames(): Promise<ReleaseProject[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        ...PUBLISHED
      },
      include: WITH_PEOPLE_AND_COUNTS
    });
    return projects.map((project) =>
      this.applyPublishedSnapshot(this.withCounts(project))
    );
  }

  async fetchPublishedGamesPaginated(
    page?: number,
    limit?: number,
    filters: PublishedProjectFilters = {},
    sort: ReleaseSort = "fresh"
  ): Promise<PaginatedProjectsResult<ReleaseProject>> {
    const safePage = this.normalizePage(page);
    const safeLimit = this.normalizeLimit(limit);
    const skip = (safePage - 1) * safeLimit;
    const where = this.buildPublishedGamesWhere(filters);

    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({
        where
      }),
      this.prisma.project.findMany({
        where,
        include: WITH_PEOPLE_AND_COUNTS,
        orderBy: RELEASE_ORDER_BY[sort],
        skip,
        take: safeLimit
      })
    ]);

    return {
      projects: projects.map((project) =>
        this.applyPublishedSnapshot(this.withCounts(project))
      ),
      total,
      page: safePage,
      limit: safeLimit
    };
  }

  async countPublishedGames(
    filters: PublishedProjectFilters = {}
  ): Promise<number> {
    return this.prisma.project.count({
      where: this.buildPublishedGamesWhere(filters)
    });
  }

  async countUserProjects(
    userId: number,
    filters: UserProjectFilters = {}
  ): Promise<number> {
    return this.prisma.project.count({
      where: this.buildUserProjectsWhere(userId, filters)
    });
  }

  private async fetchReleasePage(
    where: Prisma.ProjectWhereInput,
    page: number,
    limit: number
  ): Promise<ReleaseProject[]> {
    const pagination = this.normalizePagination(page, limit);

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      skip: pagination.skip,
      take: pagination.limit,
      include: WITH_PEOPLE_AND_COUNTS
    });

    return projects.map((project) =>
      this.applyPublishedSnapshot(this.withCounts(project))
    );
  }

  async fetchPublishedGamesByUser(
    userId: number,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
    ownedOnly = false
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      ownedOnly
        ? { ...PUBLISHED, userId }
        : {
          ...PUBLISHED,
          OR: [
            { userId },
            {
              collaborators: {
                some: { id: userId }
              }
            }
          ]
        },
      page,
      limit
    );
  }

  /** Published games this person collaborates on without owning them. */
  async fetchCollaborationsByUser(
    userId: number,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      {
        ...PUBLISHED,
        userId: { not: userId },
        collaborators: { some: { id: userId } }
      },
      page,
      limit
    );
  }

  /** Published games other people forked from one of this person's. */
  async fetchRemixesOfUser(
    userId: number,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      {
        ...PUBLISHED,
        userId: { not: userId },
        forkedFrom: { userId }
      },
      page,
      limit
    );
  }

  /**
   * The tags published games carry, most used first, optionally narrowed to those holding a
   * fragment.
   *
   * Raw SQL because the tags are an array column: counting them means unnesting it, which the
   * query builder has no shape for. A game that has never had its tags published falls back to
   * its draft ones, the same way the shelf filter does.
   */
  async fetchPublishedTags(
    fragment: string,
    limit: number
  ): Promise<{ tag: string; count: number }[]> {
    return this.prisma.$queryRaw<{ tag: string; count: number }[]>`
      SELECT tag, COUNT(*)::int AS count
      FROM (
        SELECT unnest(
          CASE
            WHEN cardinality("publishedTags") > 0 THEN "publishedTags"
            ELSE "tags"
          END
        ) AS tag
        FROM "Project"
        WHERE "publishedAt" IS NOT NULL
      ) tags
      WHERE tag ILIKE ${`%${fragment}%`}
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${limit}
    `;
  }

  /** Totals over every published game the user owns. */
  async fetchUserTotals(
    userId: number
  ): Promise<{ gameCount: number; totalPlays: number; totalLikes: number }> {
    const where: Prisma.ProjectWhereInput = { ...PUBLISHED, userId };
    const [gameCount, sums] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.aggregate({ where, _sum: { viewCount: true, likes: true } })
    ]);

    return {
      gameCount,
      totalPlays: sums._sum.viewCount ?? 0,
      totalLikes: sums._sum.likes ?? 0
    };
  }

  async fetchLikedPublishedGamesByUser(
    userId: number,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      {
        ...PUBLISHED,
        userLikes: {
          some: { userId }
        }
      },
      page,
      limit
    );
  }

  /**
   * One view per reader per UTC day. The unique row is what decides; the counter follows it, so a
   * reload, or a loop of requests, moves nothing.
   */
  async registerReleaseView(
    projectId: number,
    viewer: { userId: number | null; ip: string }
  ): Promise<{ viewCount: number }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...PUBLISHED },
      select: { id: true, viewCount: true, updatedAt: true }
    });

    if (!project) {
      throw new NotFoundException(
        `Published project with ID ${projectId} not found`
      );
    }

    const viewerKey = viewerKeyOf(viewer.userId, viewer.ip, this.viewSecret);
    const now = new Date();
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const seenBefore =
      (await this.prisma.releaseView.count({ where: { projectId, viewerKey } })) >
      0;

    try {
      await this.prisma.releaseView.create({
        data: { projectId, viewerKey, day }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { viewCount: project.viewCount };
      }
      throw error;
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        viewCount: { increment: 1 },
        ...(seenBefore ? {} : { uniquePlayers: { increment: 1 } }),
        // A reader's visit is not an edit: the edit time orders the author's own list.
        updatedAt: project.updatedAt
      },
      select: { viewCount: true }
    });

    return { viewCount: updated.viewCount };
  }

  /** A like moves the counter only when its row was created, so a repeated request counts once. */
  async likeProject(
    projectId: number,
    userId: number
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...PUBLISHED },
      select: { likes: true, updatedAt: true }
    });

    if (!project) {
      throw new NotFoundException(
        `Published project with ID ${projectId} not found`
      );
    }

    let updated: { likes: number };
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.like.create({ data: { userId, projectId } });

        return tx.project.update({
          where: { id: projectId },
          data: { likes: { increment: 1 }, updatedAt: project.updatedAt },
          select: { likes: true }
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { likes: project.likes, liked: true };
      }
      throw error;
    }

    return { likes: updated.likes, liked: true };
  }

  /** Withdrawing stays possible after an unpublish, and moves the counter only when a row went. */
  async unlikeProject(
    projectId: number,
    userId: number
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { likes: true, updatedAt: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.like.deleteMany({
        where: { userId, projectId }
      });

      if (count === 0) {
        return null;
      }

      return tx.project.update({
        where: { id: projectId },
        data: { likes: { decrement: count }, updatedAt: project.updatedAt },
        select: { likes: true }
      });
    });

    if (!updated) {
      return { likes: project.likes, liked: false };
    }

    return { likes: updated.likes, liked: false };
  }

  async getLikeStatus(
    projectId: number,
    userId: number
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { likes: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_projectId: { userId, projectId }
      }
    });

    return { likes: project.likes, liked: !!existingLike };
  }

  async fork(sourceProjectId: number, userId: number): Promise<ProjectEx> {
    const sourceProject = await this.prisma.project.findUnique({
      where: { id: sourceProjectId }
    });

    if (!sourceProject) {
      throw new NotFoundException(
        `Project with ID ${sourceProjectId} not found`
      );
    }

    if (!sourceProject.publishedAt) {
      throw new BadRequestException("Only published projects can be forked");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // A fork starts from what the hub shows of its source, not from the source's unpublished draft.
    const newProject = await this.prisma.project.create({
      data: {
        name: `Fork of ${sourceProject.publishedName ?? sourceProject.name}`.slice(
          0,
          PROJECT_NAME_MAX_LENGTH
        ),
        shortDesc: sourceProject.publishedShortDesc ?? sourceProject.shortDesc,
        longDesc: sourceProject.publishedLongDesc ?? sourceProject.longDesc,
        forkedFrom: { connect: { id: sourceProjectId } },
        creator: { connect: { id: userId } },
        collaborators: { connect: [{ id: userId }] }
      },
      include: WITH_PEOPLE
    });

    try {
      const releaseContent = await this.s3Service.downloadFile({
        key: `release/${sourceProjectId}`
      });
      await this.s3Service.uploadFile({
        file: releaseContent,
        keyName: `save/${newProject.id}/${Date.now()}`
      });
    } catch (error) {
      // A fork whose content never arrived would sit in its owner's list as an empty project.
      await this.prisma.project.delete({ where: { id: newProject.id } });
      throw error;
    }

    try {
      const sourceCover = coverKey(sourceProjectId);
      if (await this.s3Service.fileExists(sourceCover)) {
        await this.storeCover(
          newProject.id,
          await this.s3Service.downloadFile({ key: sourceCover })
        );
      }
    } catch (error) {
      this.logger.warn(
        `Cover of project ${sourceProjectId} was not copied to its fork ${newProject.id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }

    return newProject;
  }
}
