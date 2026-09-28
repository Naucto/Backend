import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException
} from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto
} from "./dto/collaborator-project.dto";
import { S3Service } from "@s3/s3.service";
import { positiveNumber } from "@s3/s3-numbers";
import { ModuleRef } from "@nestjs/core";
import { NotificationsService } from "src/notifications/notifications.service";
import { WorkSessionService } from "@work-session/work-session.service";
import { Prisma, Project, User } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { DownloadedFile } from "@s3/s3.interface";
import { Readable } from "stream";
import * as Y from "yjs";

/** The stored slot is larger than a document this build accepts, so it is replaced, not merged. */
class StoredSaveTooLargeError extends Error {
  constructor() {
    super("The stored autosave is larger than this build can read");
    this.name = "StoredSaveTooLargeError";
  }
}

/** The stored slot did not arrive in time. The slot is untouched; the save is retried. */
class StoredSaveUnreadableError extends Error {
  constructor() {
    super("The stored autosave could not be read in time");
    this.name = "StoredSaveUnreadableError";
  }
}
import { streamToBuffer } from "@util/stream.util";
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
import { recordSavedAiProvenance } from "src/routes/ai/ai-provenance";
import { mergeStates } from "./content-size";

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
 * How the hub's shelves are ordered. Sorting has to happen in the query: the client only ever
 * holds one page, so ordering there means "the freshest of the 48 we happen to have", which is
 * not what the shelf claims.
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
/** A row refused for a unique index that already holds its key. */
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

const keyName = (raw: string): string => {
  const name = raw.trim();
  if (!name || name.includes("/") || name.includes("..")) {
    throw new BadRequestException(`Invalid version name: ${raw}`);
  }

  return name;
};

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
  static COLLABORATOR_SELECT = COLLABORATOR_SELECT;
  static CREATOR_SELECT = CREATOR_SELECT;

  private readonly logger = new Logger(ProjectService.name);

  private readonly max_history_version;
  private readonly stored_save_timeout_ms: number;
  private readonly max_pending_saves: number;
  /** The tail of each project's save queue, so saves to one project run in the order they arrived. */
  private readonly saving = new Map<number, Promise<void>>();
  /** How many saves are queued or running per project, to keep a slow store from accumulating them. */
  private readonly pending = new Map<number, number>();
  private readonly max_checkpoints;
  private readonly auto_save_delay;
  private readonly view_secret: string;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly moduleRef: ModuleRef
  ) {
    // Four slots, because an author looking for a state they were in reaches for the last few
    // and never for the tenth: the ones worth keeping past that are the ones somebody named, and
    // a named version is a checkpoint, kept apart and never pruned.
    this.max_history_version = positiveNumber(
      configService.get<string>("S3_MAX_AUTO_HISTORY_VERSION"),
      4
    );
    // How long reading a stored slot may take before the save is failed rather than left waiting. A
    // merge needs the whole stored state, so a body that stops arriving holds the request open
    // forever; failing lets the editor retry against a slot that is still intact.
    this.stored_save_timeout_ms = positiveNumber(
      configService.get<string>("S3_STORED_SAVE_TIMEOUT_MS"),
      10000
    );
    // How many saves may queue on one project's lock. The editor sends a whole state on every pause
    // with no check for a save already in flight, so a slow store would otherwise pile up requests,
    // each holding its own copy of the document. Refusing the newest past this is better than
    // growing without bound: the state it carried is still in the document, and the next save sends
    // it again.
    this.max_pending_saves = positiveNumber(configService.get<string>("S3_MAX_PENDING_SAVES"), 4);
    this.max_checkpoints = positiveNumber(configService.get<string>("S3_MAX_CHECKPOINTS"), 20);
    // Minutes in the environment; a slot stays open this long.
    this.auto_save_delay = positiveNumber(configService.get<string>("S3_AUTO_HISTORY_DELAY"), 10) * 60000;
    this.view_secret =
      configService.get<string>("VIEW_HASH_SECRET") ??
      configService.get<string>("JWT_SECRET") ??
      "";
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

  private withCommentCount(project: ProjectWithCounts): ReleaseProject {
    const { _count, ...rest } = project;
    return {
      ...rest,
      commentCount: _count.comments,
      forkCount: _count.forks
    };
  }

  private applyPublishedSnapshot(project: ReleaseProject): ReleaseProject {
    const publishedTags = project.publishedTags ?? [];

    return {
      ...project,
      name: project.publishedName || project.name,
      shortDesc: project.publishedShortDesc || project.shortDesc,
      longDesc: project.publishedLongDesc ?? project.longDesc,
      tags: publishedTags.length > 0 ? publishedTags : project.tags,
      aiCategories: project.publishedAiCategories
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

  private getReleaseWindowThreshold(releaseWindow: ReleaseWindow): Date | undefined {
    if (releaseWindow === "all") {
      return undefined;
    }

    return new Date(
      Date.now() - RELEASE_WINDOW_DAYS[releaseWindow] * DAY_IN_MS
    );
  }

  /**
   * Where a search term is looked for: the two names, the two descriptions, the creator, and an
   * exact tag.
   *
   * A tag matches whole or not at all — Prisma compares array members, it cannot look inside one —
   * so a partial tag is the tag catalogue's job, not this one's.
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
      const threshold = this.getReleaseWindowThreshold(filters.releaseWindow);

      if (threshold) {
        andClauses.push({
          OR: [
            { publishedAt: { gte: threshold } },
            {
              AND: [{ publishedAt: null }, { createdAt: { gte: threshold } }]
            }
          ]
        });
      }
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
        include: {
          collaborators: {
            select: ProjectService.COLLABORATOR_SELECT
          },
          creator: {
            select: ProjectService.CREATOR_SELECT
          }
        },
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
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
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
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    try {
      return await this.prisma.project.create({
        data: {
          ...createProjectDto,
          tags: this.normalizeTags(createProjectDto.tags),
          collaborators: {
            connect: [{ id: userId }]
          },
          creator: { connect: { id: userId } }
        },
        include: {
          collaborators: {
            select: ProjectService.COLLABORATOR_SELECT
          },
          creator: {
            select: ProjectService.CREATOR_SELECT
          }
        }
      });
    } catch (error) {
      throw new InternalServerErrorException("Failed to create project", {
        cause: error
      });
    }
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

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    // The sessions go first, in the same transaction as the project. Both session tables point at
    // a project with ON DELETE RESTRICT, and opening the editor always creates a work session --
    // so whoever asks for the delete is sitting in the row that would refuse it. Together, because
    // a project must never be left without the sessions that pointed at it.
    await this.prisma.$transaction([
      this.prisma.gameSession.deleteMany({ where: { projectId: id } }),
      this.prisma.workSession.deleteMany({ where: { projectId: id } }),
      this.prisma.project.delete({ where: { id } })
    ]);

    // Only once the row is gone, and never fatally: content dropped ahead of a delete that then
    // fails is content lost for nothing. A blob nobody points at any more is recoverable; a game
    // is not.
    await this.removeStoredContent(id);
  }

  private async removeStoredContent(id: number): Promise<void> {
    try {
      await this.s3Service.deleteFile({ key: `release/${id}` });

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

  private async findUserByIdentifier(
    dto: AddCollaboratorDto | RemoveCollaboratorDto
  ): Promise<User> {
    let user: User | null = null;
    let identifier: string;

    if ("userId" in dto && dto.userId) {
      identifier = dto.userId.toString();
      user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    } else if ("username" in dto && dto.username) {
      identifier = dto.username;
      user = await this.prisma.user.findUnique({
        where: { username: dto.username }
      });
    } else if ("email" in dto && dto.email) {
      identifier = dto.email;
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
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
  ): Promise<Project> {
    const user = await this.findUserByIdentifier(addCollaboratorDto);

    if (!user) {
      const identifier =
        addCollaboratorDto.userId ||
        addCollaboratorDto.username ||
        addCollaboratorDto.email;
      throw new NotFoundException(
        `User with identifier '${identifier}' not found`
      );
    }

    const project = await this.findOne(id);

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

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
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });

    // Being given a project is the one collaboration event the invitee has no other way to learn
    // about: nothing tells them, and the project simply appears in their list at the next reload.
    // The id is what turns the notification into a way in.
    //
    // Resolved from the graph rather than imported: notifications reach auth for the JWT their
    // socket checks, auth reaches users, and users reach projects. Importing the module here
    // closes that ring at the ES level, where forwardRef cannot help -- a module in the ring is
    // still undefined when the one before it is decorated.
    const notifications = this.moduleRef.get(NotificationsService, {
      strict: false
    });
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
  ): Promise<Project> {
    const user = await this.findUserByIdentifier(removeCollaboratorDto);
    const project = await this.findOne(id);
    const projectWithRelations = project;

    if (user.id === project.userId) {
      throw new ForbiddenException("Cannot remove the project creator");
    }

    if (
      !projectWithRelations.collaborators.some(
        (collab) => collab.id === user.id
      )
    ) {
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
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });

    // Losing the project is worth the same word as being given it, and for the same reason: without
    // one, someone who was editing a minute ago finds the project gone from their list and has no
    // way to tell an eviction from a bug. No projectId travels with it -- there is nothing left to
    // open.
    //
    // Both services are resolved from the graph rather than imported, for the reason spelled out
    // in addCollaborator.
    const notifications = this.moduleRef.get(NotificationsService, {
      strict: false
    });
    await notifications.createNotification({
      userId: user.id,
      title: updated.name,
      message: `${project.creator.username} removed you from ${updated.name}`,
      type: "INFO",
      kind: "COLLABORATOR_REMOVED"
    });

    // A revoked collaborator kept editing until their next reload: the live session holds its own
    // list of who is in the room, and disconnecting them from the project never touched it.
    const sessions = this.moduleRef.get(WorkSessionService, { strict: false });
    await sessions.kick(id, user.id).catch(() => {
      // No open session on the project, which is the common case and not a failure of the removal.
    });

    return updated;
  }

  async updateLastTimeUpdate(projectId: number): Promise<void> {
    const sessions = await this.prisma.workSession.findMany({
      where: { projectId }
    });
    if (sessions.length === 0) return;
    await this.prisma.workSession.update({
      data: {
        lastSaveAt: new Date()
      },
      where: { projectId }
    });
  }

  async updateContentInfo(
    projectId: number,
    contentKey: string,
    extension: string
  ): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        contentKey,
        contentExtension: extension,
        contentUploadedAt: new Date()
      }
    });
  }

  /**
   * An autosave lands in a slot: one key per `auto_save_delay` window, rewritten by every save
   * inside the window, so a long session costs one slot per window rather than one per pause in
   * the typing. Past the window a new slot opens and the oldest go, keeping `max_history_version`.
   */
  async save(projectId: number, file: Express.Multer.File): Promise<void> {
    // Read, merge, write — so a second save arriving while the first is mid-flight has to wait for
    // it. Otherwise both read the same stored state, each merges only its own view into it, and the
    // write that lands second drops the other's work: exactly the loss merging was added to prevent.
    // Held per project, so unrelated projects never queue behind each other. This covers the
    // requests one process receives; a second Backend instance would need a lock the store itself
    // enforces, which is a larger change than this and is not claimed here.
    // Counted before queueing, so the limit covers waiting and running together.
    const queued = this.pending.get(projectId) ?? 0;
    if (queued >= this.max_pending_saves) {
      // Retry-After, because the client cannot guess: a save refused for a busy queue is not the
      // same as one that was turned down, and treating them alike is what turned a transient limit
      // into a lost change.
      const refused = new ServiceUnavailableException("Too many saves are already waiting for this project");
      (refused.getResponse() as { setHeader?: (k: string, v: string) => void }).setHeader?.("Retry-After", "5");
      throw refused;
    }
    this.pending.set(projectId, queued + 1);
    const previous = this.saving.get(projectId) ?? Promise.resolve();
    try {
      await this.enqueueSave(projectId, previous, file);
    } finally {
      const left = (this.pending.get(projectId) ?? 1) - 1;
      if (left <= 0) this.pending.delete(projectId);
      else this.pending.set(projectId, left);
    }
  }

  private async enqueueSave(projectId: number, previous: Promise<void>, file: Express.Multer.File): Promise<void> {
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const queue = previous.then(() => held);
    this.saving.set(projectId, queue);
    await previous;
    try {
      await this.saveNow(projectId, file);
    } finally {
      release();
      // Drop the entry once nothing is queued behind it, so the map does not grow with every project
      // ever saved to.
      if (this.saving.get(projectId) === queue) this.saving.delete(projectId);
    }
  }

  private async saveNow(projectId: number, file: Express.Multer.File): Promise<void> {
    const saves = (await this.listVersions(projectId)).sort(newestFirst);
    const now = Date.now();
    const newest = saves[0];
    const slot = newest && now - Number(newest.name) < this.auto_save_delay ? newest.name : String(now);

    // Read before pruning, because the newest slot is what a new window merges into and the prune
    // can include it: `kept` is one less than the history size, so a history of one would have
    // deleted the very slot being carried forward.
    const stored = slot === newest?.name ? await this.storedSave(projectId, slot) : null;
    const carried = slot === newest?.name ? null : await this.storedSave(projectId, newest?.name ?? "");

    // The prune is deferred until the upload has landed — see below. Deleting first meant a save
    // that then failed took the old slots with it, and with a short history the newest slot was
    // among them, so one failed save could leave the project with no save at all.
    await this.updateLastTimeUpdate(projectId);
    // Merged into what is already stored rather than written over it. A save is one editor's view of
    // a CRDT, and two of them can be written in the same instant — the host saving while an assistant
    // change is applied, say — with neither having seen the other's latest keystrokes. Last writer wins
    // on a whole blob, so whichever landed second would erase the first, and an applied change the
    // database records as applied would be missing from the project. Merging is what a CRDT is for.
    // A new window merges the previous one's state rather than starting from nothing. Every save in
    // a window rewrites one slot, so the state anyone loads is the newest slot — and starting a new
    // one from whichever writer arrived first drops everything the previous window held that this
    // save's author had not seen. Two editors in a partition is where that shows: each becomes host,
    // each saves, and the one whose save opened the window decides what everyone else loads.
    const base = stored ?? carried;
    // The merged result is bounded too. Merging only ever grows a document, so a slot can creep
    // past the ceiling over a window and then be read as "too large to merge" — replaced, not
    // merged, by every save after that. Failing here instead leaves the slot as it was.
    let buffer: Buffer | undefined;
    if (file.buffer) {
      try {
        buffer = await mergeStates(base, file.buffer);
      } catch {
        // Refused rather than stored: bytes that are not a document would be written as the newest
        // slot, and opening the project would then fail, with no editor open to repair it.
        throw new BadRequestException("The uploaded file cannot be read as a game document");
      }
    }
    if (buffer && buffer.length > PROJECT_BLOB_MAX_BYTES) {
      throw new PayloadTooLargeException("The merged document is past the maximum size for a save");
    }

    await this.s3Service.uploadFile({
      file: buffer ? { ...file, buffer, size: buffer.length } : file,
      keyName: `save/${projectId}/${slot}`
    });

    // Now that the new slot exists, the old ones can go. Ordered after every step that can fail, so
    // a save that was refused or that timed out leaves the history it found rather than a gap.
    if (slot !== newest?.name) {
      const kept = Math.max(this.max_history_version - 1, 0);
      for (const stale of saves.slice(kept)) {
        await this.s3Service.deleteFile({
          key: `save/${projectId}/${stale.name}`
        });
      }
    }

    if (buffer) {
      await this.storeContentSize(projectId, computeContentSize(buffer));
      await recordSavedAiProvenance(this.prisma, projectId, buffer);
    }
  }

  /**
   * The bytes already stored for this slot, or null when there are none, or when what is there is
   * not a document this build can read — an older format, say. A legacy blob is replaced rather than
   * merged, because there is nothing in it to merge with.
   *
   * "None" is decided by asking whether the object exists, not by whether reading it worked. A read
   * that fails for any other reason — the bucket throttling, a dropped connection, a 503 — is not
   * evidence of an empty slot, and treating it as one made the save that followed overwrite the slot
   * with a state missing whatever the failed read was about to return. Those now propagate and fail
   * the save, which the editor retries: losing a keystroke is recoverable, losing an applied change
   * is not.
   */
  private async storedSave(projectId: number, slot: string): Promise<Buffer | null> {
    if (!slot) return null;
    const key = `save/${projectId}/${slot}`;
    const metadata = await this.s3Service.getFileMetadataOrNull(key);
    if (!metadata) return null;

    // Bounded on both axes. The length comes from the object itself, so a stream that never ends
    // cannot pin the request open, and a body past the blob ceiling is not something to merge.
    //
    // The blob ceiling, not the content budget: a CRDT update is far larger than the content it
    // carries, because it holds the history that content came from. A map repainted a handful of
    // times is tens of kilobytes of content and megabytes of blob, so bounding the blob by the
    // content budget switched merging off for ordinary projects — quietly, and only for the ones
    // big enough to reach it, which is the last thing a data-loss guard should do.
    const declared = Number(metadata.ContentLength ?? 0);
    if (declared > PROJECT_BLOB_MAX_BYTES) return null;
    let bytes: Buffer;
    try {
      bytes = Buffer.concat(await this.readStoredBody(key));
    } catch (error) {
      // Too large to be this build's document, so there is nothing in it worth merging. Anything
      // else — a timeout, a dropped connection — leaves the slot intact and fails the save.
      if (error instanceof StoredSaveTooLargeError) return null;
      throw error;
    }
    // A Yjs update that is not one fails to parse, which is how a legacy format is recognised.
    const probe = new Y.Doc();
    try {
      Y.applyUpdate(probe, bytes);
      return bytes;
    } catch {
      return null;
    } finally {
      probe.destroy();
    }
  }

  /**
   * The stored bytes, read under a deadline and a size cap. A stream that stalls with no more data
   * arriving would otherwise hold the request open indefinitely, since a merge cannot start until the
   * whole stored state is in hand.
   */
  private async readStoredBody(key: string): Promise<Buffer[]> {
    const { body } = await this.s3Service.downloadFile({ key });
    const read = (async (): Promise<Buffer[]> => {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of body as Readable) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        total += buf.length;
        if (total > PROJECT_BLOB_MAX_BYTES) throw new StoredSaveTooLargeError();
        chunks.push(buf);
      }
      return chunks;
    })();
    // Losing the race must not leave the connection reading: the loser destroys the stream, so the
    // slot is not held open by a body nobody is waiting for.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new StoredSaveUnreadableError()), this.stored_save_timeout_ms);
      timer.unref?.();
    });
    try {
      return await Promise.race([read, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
      (body as Readable).destroy?.();
    }
  }

  // ─── Content size budget ────────────────────────────────────────────

  /** The save-window and queue bounds, for a caller that has to reason about them. */
  autoSaveWindowMs(): number {
    return this.auto_save_delay;
  }
  maxPendingSaves(): number {
    return this.max_pending_saves;
  }

  getLimits(): ProjectLimits {
    return {
      maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
      maxBlobBytes: PROJECT_BLOB_MAX_BYTES,
      maxCheckpoints: this.max_checkpoints,
      maxAutosaves: this.max_history_version
    };
  }

  private async storeContentSize(
    projectId: number,
    contentSize: ContentSizeBreakdown
  ): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        contentSize: contentSize as unknown as Prisma.InputJsonObject,
        contentSizeTotal: contentSize.total
      }
    });
  }

  /** Decodes the latest save and persists its size breakdown. */
  async recomputeContentSize(projectId: number): Promise<ContentSizeBreakdown> {
    const file = await this.fetchLastVersion(projectId);
    const contentSize = computeContentSize(await streamToBuffer(file.body));
    await this.storeContentSize(projectId, contentSize);
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
    const buffer = await streamToBuffer(file.body);
    const contentSize = computeContentSize(buffer);
    await this.storeContentSize(projectId, contentSize);

    if (contentSize.total > PROJECT_CONTENT_MAX_BYTES) {
      throw new ProjectTooLargeException(
        contentSize,
        PROJECT_CONTENT_MAX_BYTES
      );
    }

    return {
      body: Readable.from(buffer),
      contentType: file.contentType ?? "application/octet-stream",
      contentLength: buffer.byteLength
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
    if (!overwriting && existing.length >= this.max_checkpoints) {
      throw new CheckpointLimitException(
        existing.length,
        this.max_checkpoints
      );
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
   * Puts the latest save on the hub and only then marks the row: a project that says published
   * while the hub has nothing to hand out is the state `unpublish` used to leave behind.
   */
  private async writeRelease(
    projectId: number,
    snapshot: Pick<Project, "name" | "shortDesc" | "longDesc" | "tags" | "aiCategories">
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
        publishedTags: snapshot.tags,
        publishedAiCategories: snapshot.aiCategories
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
        tags: true,
        aiCategories: true
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
        tags: true,
        aiCategories: true
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
   * Removes one autosave. The editor lets an author prune its history; only autosaves are
   * removable — a checkpoint is a deliberate marker, and a release is not a save at all.
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
    return this.s3Service.downloadFile({ key: `save/${projectId}/${version}` });
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

  async fetchRelease(projectId: number): Promise<ReleaseProject> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        },
        // The parent by name, so lineage reads without a second request that 404s whenever the
        // original was never published.
        forkedFrom: {
          select: {
            id: true,
            name: true,
            publishedName: true,
            creator: { select: { username: true } }
          }
        },
        _count: {
          select: {
            forks: true,
            comments: {
              where: { deleted: false }
            }
          }
        }
      }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const parent = (
      project as unknown as {
        forkedFrom?: {
          id: number;
          name: string;
          publishedName: string | null;
          creator: { username: string };
        } | null;
      }
    ).forkedFrom;

    return {
      ...this.applyPublishedSnapshot(
        this.withCommentCount(project as unknown as ProjectWithCounts)
      ),
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
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        },
        _count: {
          select: {
            forks: true,
            comments: { where: { deleted: false } }
          }
        }
      }
    });
    return projects.map((project) =>
      this.applyPublishedSnapshot(
        this.withCommentCount(project as ProjectWithCounts)
      )
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
        include: {
          collaborators: {
            select: ProjectService.COLLABORATOR_SELECT
          },
          creator: {
            select: ProjectService.CREATOR_SELECT
          },
          _count: {
            select: {
              forks: true,
              comments: { where: { deleted: false } }
            }
          }
        },
        orderBy: RELEASE_ORDER_BY[sort],
        skip,
        take: safeLimit
      })
    ]);

    return {
      projects: projects.map((project) =>
        this.applyPublishedSnapshot(
          this.withCommentCount(project as ProjectWithCounts)
        )
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

  async fetchPublishedGamesByUser(
    userId: number,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
    ownedOnly = false
  ): Promise<ReleaseProject[]> {
    return this.fetchPublishedGamesByUserWhere(
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

  /**
   * Games this person helped build but does not own. The profile draws GAMES and COLLABS as two
   * shelves, so the split has to happen in the query — `fetchPublishedGamesByUser` returns the
   * union of both and would put every collaboration on the owner's shelf too.
   */
  async fetchCollaborationsByUser(
    userId: number,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT
  ): Promise<ReleaseProject[]> {
    return this.fetchPublishedGamesByUserWhere(
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
    return this.fetchPublishedGamesByUserWhere(
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

  /** Totals for the profile header, counted rather than summed over one page of games. */
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
    return this.fetchPublishedGamesByUserWhere(
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

  private async fetchPublishedGamesByUserWhere(
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
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        },
        _count: {
          select: {
            forks: true,
            comments: { where: { deleted: false } }
          }
        }
      }
    });

    return projects.map((project) =>
      this.applyPublishedSnapshot(
        this.withCommentCount(project as ProjectWithCounts & {
          publishedName?: string | null;
          publishedShortDesc?: string | null;
          publishedLongDesc?: string | null;
          publishedTags?: string[];
        })
      )
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
      select: { id: true, viewCount: true }
    });

    if (!project) {
      throw new NotFoundException(
        `Published project with ID ${projectId} not found`
      );
    }

    const viewerKey = viewerKeyOf(viewer.userId, viewer.ip, this.view_secret);
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
        ...(seenBefore ? {} : { uniquePlayers: { increment: 1 } })
      },
      select: { viewCount: true }
    });

    return { viewCount: updated.viewCount };
  }

  // ─── Like Methods ───────────────────────────────────────────────────

  /**
   * Recompute the denormalized `likes` counter from the actual Like rows and
   * persist it. Using a count instead of increment/decrement keeps the counter
   * accurate even under concurrent / rapidly repeated requests (no drift).
   */
  private async syncLikeCount(projectId: number): Promise<number> {
    const likes = await this.prisma.like.count({ where: { projectId } });
    await this.prisma.project.update({
      where: { id: projectId },
      data: { likes }
    });
    return likes;
  }

  async likeProject(
    projectId: number,
    userId: number
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    // Idempotent: a user can only ever hold a single like for a project.
    // Spamming the endpoint creates no duplicates and never over-counts.
    await this.prisma.like.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId },
      update: {}
    });

    const likes = await this.syncLikeCount(projectId);
    return { likes, liked: true };
  }

  async unlikeProject(
    projectId: number,
    userId: number
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    // Idempotent: removing a non-existent like is a no-op rather than an error.
    await this.prisma.like.deleteMany({ where: { userId, projectId } });

    const likes = await this.syncLikeCount(projectId);
    return { likes, liked: false };
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
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const newProject = await this.prisma.project.create({
      data: {
        name: `Fork of ${sourceProject.name}`,
        aiCategories: sourceProject.publishedAiCategories,
        shortDesc: sourceProject.shortDesc,
        longDesc: sourceProject.longDesc,
        forkedFrom: { connect: { id: sourceProjectId } },
        creator: { connect: { id: userId } },
        collaborators: { connect: [{ id: userId }] }
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    }) as ProjectEx;

    const releaseContent = await this.s3Service.downloadFile({
      key: `release/${sourceProjectId}`
    });
    await this.s3Service.uploadFile({
      file: releaseContent,
      keyName: `save/${newProject.id}/${Date.now()}`
    });

    try {
      const imageKey = `projects/${sourceProjectId}/image`;
      const imageExists = await this.s3Service.fileExists(imageKey);
      if (imageExists) {
        const imageFile = await this.s3Service.downloadFile({ key: imageKey });
        const newImageKey = `projects/${newProject.id}/image`;
        await this.s3Service.uploadFile({
          file: imageFile,
          keyName: newImageKey
        });
        await this.s3Service.setObjectPublicRead(newImageKey);
      }
    } catch {
      // Image copy failure is non-critical
    }

    return newProject;
  }
}
