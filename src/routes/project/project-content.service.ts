import { buffer } from 'node:stream/consumers';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';
import { Readable } from 'stream';

import { getOptionalEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { EdgeService, versionedUrl } from '../s3/edge.service';
import { DownloadedFile } from '../s3/s3.interface';
import { S3Service } from '../s3/s3.service';
import {
  computeContentSize,
  ContentSizeBreakdown,
  isContentSizeBreakdown,
  PROJECT_BLOB_MAX_BYTES,
  PROJECT_CONTENT_MAX_BYTES,
} from './content-size';
import {
  PROJECT_DEFAULT_MAX_AUTOSAVES,
  PROJECT_DEFAULT_MAX_CHECKPOINTS,
} from './dto/project-field-limits';
import { keepEditTime } from './keep-edit-time';
import {
  CheckpointLimitException,
  ProjectNotPublishedException,
  ProjectTooLargeException,
} from './project.error';
import { ProjectService } from './project.service';
import { projectKeys } from './project-keys';

export type ProjectSave = {
  name: string;
  date: Date;
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

// The release sits at one key for the life of the game and the player fetches it straight from
// the edge, so every copy on the way has to ask before serving what it kept.
const RELEASE_CACHE_CONTROL = 'no-cache';

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
  if (!name || name.includes('/') || name.includes('..')) {
    throw new BadRequestException(`Invalid version name: ${raw}`);
  }

  return name;
};

@Injectable()
export class ProjectContentService {
  private readonly maxAutosaves: number;
  private readonly maxCheckpoints: number;
  private readonly autosaveWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly edgeService: EdgeService,
    private readonly projectService: ProjectService,
  ) {
    // The default keeps only the last few autosaves: a state worth keeping longer is one the
    // author names, and a named version is never pruned.
    this.maxAutosaves = getOptionalEnv(
      'S3_MAX_AUTO_HISTORY_VERSION',
      PROJECT_DEFAULT_MAX_AUTOSAVES,
    );
    this.maxCheckpoints = getOptionalEnv('S3_MAX_CHECKPOINTS', PROJECT_DEFAULT_MAX_CHECKPOINTS);
    // Minutes in the environment; a slot stays open this long.
    this.autosaveWindowMs = getOptionalEnv('S3_AUTO_HISTORY_DELAY', 10) * 60000;
  }

  /** Persists a size breakdown; passing the row keeps the write from counting as an edit. */
  private async storeContentSize(
    projectId: number,
    contentSize: ContentSizeBreakdown,
    unedited?: { updatedAt: Date } | null,
  ): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        contentSize: contentSize as unknown as Prisma.InputJsonObject,
        contentSizeTotal: contentSize.total,
        ...(unedited ? keepEditTime(unedited) : {}),
      },
    });
  }

  async listVersions(projectId: number): Promise<ProjectSave[]> {
    return (await this.s3Service.listObjects({ prefix: projectKeys.saves(projectId) })).map(
      (object) => ({
        name: object.Key!.split('/').pop()!,
        date: object.LastModified!,
      }),
    );
  }

  async listCheckpoints(projectId: number): Promise<ProjectSave[]> {
    return (await this.s3Service.listObjects({ prefix: projectKeys.checkpoints(projectId) })).map(
      (object) => ({
        name: object.Key!.split('/').pop()!,
        date: object.LastModified!,
      }),
    );
  }

  async fetchLastVersion(projectId: number): Promise<DownloadedFile> {
    const files = (await this.listVersions(projectId)).sort(newestFirst);

    if (files.length === 0 || !files[0]?.name) {
      return {
        body: Readable.from([]),
        contentType: 'application/octet-stream',
        contentLength: 0,
      };
    }

    return this.s3Service.downloadFile({ key: projectKeys.save(projectId, files[0].name) });
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
        throw new UnprocessableEntityException('Not a game document');
      }
    }

    const saves = (await this.listVersions(projectId)).sort(newestFirst);
    const now = Date.now();
    const newest = saves[0];
    const slot =
      newest && now - Number(newest.name) < this.autosaveWindowMs ? newest.name : String(now);

    if (slot !== newest?.name) {
      const kept = Math.max(this.maxAutosaves - 1, 0);
      for (const stale of saves.slice(kept)) {
        await this.s3Service.deleteFile({
          key: projectKeys.save(projectId, stale.name),
        });
      }
    }

    await this.prisma.workSession.updateMany({
      where: { projectId },
      data: { lastSaveAt: new Date() },
    });
    await this.s3Service.uploadFile({
      file,
      keyName: projectKeys.save(projectId, slot),
    });

    if (contentSize) {
      await this.storeContentSize(projectId, contentSize);
    }
  }

  /** Stores the release of `sourceProjectId` as a new autosave of `targetProjectId`. */
  async copyReleaseToSave(sourceProjectId: number, targetProjectId: number): Promise<void> {
    const releaseContent = await this.s3Service.downloadFile({
      key: projectKeys.release(sourceProjectId),
    });
    await this.s3Service.uploadFile({
      file: releaseContent,
      keyName: projectKeys.save(targetProjectId, String(Date.now())),
    });
  }

  getLimits(): ProjectLimits {
    return {
      maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
      maxBlobBytes: PROJECT_BLOB_MAX_BYTES,
      maxCheckpoints: this.maxCheckpoints,
      maxAutosaves: this.maxAutosaves,
    };
  }

  /** Decodes the latest save and persists its size breakdown, without counting as an edit. */
  async recomputeContentSize(projectId: number): Promise<ContentSizeBreakdown> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { updatedAt: true },
    });
    const file = await this.fetchLastVersion(projectId);
    const contentSize = computeContentSize(await buffer(file.body));
    await this.storeContentSize(projectId, contentSize, project);
    return contentSize;
  }

  /** Returns the stored breakdown, computing it from the latest save if missing. */
  async getContentSize(projectId: number): Promise<ProjectSize> {
    const project = await this.projectService.requireProject(projectId, { contentSize: true });

    const contentSize = isContentSizeBreakdown(project.contentSize)
      ? project.contentSize
      : await this.recomputeContentSize(projectId);

    return {
      projectId,
      contentSize,
      maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
      withinBudget: contentSize.total <= PROJECT_CONTENT_MAX_BYTES,
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
      throw new ProjectTooLargeException(contentSize, PROJECT_CONTENT_MAX_BYTES);
    }

    return {
      body: Readable.from(bytes),
      contentType: file.contentType ?? 'application/octet-stream',
      contentLength: bytes.byteLength,
    };
  }

  /** Projects whose size breakdown has never been computed (oldest first). */
  async findProjectsWithoutContentSize(limit: number): Promise<number[]> {
    const projects = await this.prisma.project.findMany({
      where: { contentSizeTotal: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return projects.map((project) => project.id);
  }

  /** Saving under a name that exists rewrites that version, so the cap only meets a new name. */
  async checkpoint(projectId: number, rawName: string): Promise<void> {
    const name = keyName(rawName);
    const existing = await this.listCheckpoints(projectId);
    const overwriting = existing.some((checkpoint) => checkpoint.name === name);
    if (!overwriting && existing.length >= this.maxCheckpoints) {
      throw new CheckpointLimitException(existing.length, this.maxCheckpoints);
    }

    const file = await this.fetchLastVersion(projectId);

    await this.s3Service.uploadFile({
      file: file,
      keyName: projectKeys.checkpoint(projectId, name),
    });
  }

  async removeCheckpoint(projectId: number, checkpoint: string): Promise<void> {
    await this.s3Service.deleteFile({
      key: projectKeys.checkpoint(projectId, keyName(checkpoint)),
    });
  }

  /**
   * Uploads the latest save as the release and only then marks the row, so a row never says
   * published while the hub has nothing to serve.
   */
  private async writeRelease(
    projectId: number,
    snapshot: Pick<Project, 'name' | 'shortDesc' | 'longDesc' | 'tags'>,
  ): Promise<void> {
    const file = await this.assertWithinBudget(projectId);
    const releaseKey = projectKeys.release(projectId);
    await this.s3Service.uploadFile({
      file: file,
      keyName: releaseKey,
      cacheControl: RELEASE_CACHE_CONTROL,
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
      },
    });
  }

  async publish(projectId: number): Promise<void> {
    const project = await this.projectService.requireProject(projectId, {
      name: true,
      shortDesc: true,
      longDesc: true,
      tags: true,
    });

    await this.writeRelease(projectId, project);
  }

  async unpublish(projectId: number): Promise<void> {
    // The row first: a blob nobody points at is harmless, a row pointing at a deleted blob is not.
    await this.prisma.project.update({
      where: { id: projectId },
      data: { publishedAt: null },
    });

    await this.s3Service.deleteFile({ key: projectKeys.release(projectId) });
  }

  async updateRelease(projectId: number): Promise<void> {
    const project = await this.projectService.requireProject(projectId, {
      publishedAt: true,
      name: true,
      shortDesc: true,
      longDesc: true,
      tags: true,
    });

    if (!project.publishedAt) {
      throw new ProjectNotPublishedException(projectId);
    }

    await this.writeRelease(projectId, project);
  }

  /**
   * Removes one autosave, or throws NotFoundException when the project holds no save of that name.
   */
  async deleteVersion(projectId: number, version: string): Promise<void> {
    const name = keyName(version);

    const existing = await this.listVersions(projectId);

    if (!existing.some((save) => save.name === name)) {
      throw new NotFoundException(`Version ${name} not found for project ${projectId}`);
    }

    await this.s3Service.deleteFile({ key: projectKeys.save(projectId, name) });
  }

  async fetchSavedVersion(projectId: number, version: string): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({
      key: projectKeys.save(projectId, keyName(version)),
    });
  }

  async fetchCheckpoint(projectId: number, checkpoint: string): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({
      key: projectKeys.checkpoint(projectId, keyName(checkpoint)),
    });
  }

  /** The versioned CDN URL of the release blob, or null when none is stored. */
  async releaseUrl(projectId: number): Promise<string | null> {
    const key = projectKeys.release(projectId);
    const head = await this.s3Service.getFileMetadataOrNull(key);

    return head ? versionedUrl(this.edgeService.getCDNUrl(key), head.ETag) : null;
  }

  async fetchReleaseContent(projectId: number): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({ key: projectKeys.release(projectId) });
  }
}
