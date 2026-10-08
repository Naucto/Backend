import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';

import { withEnv } from '../../../test/env';
import { encodeGame, ProjectMocks } from '../../../test/project-mocks';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsFactService } from '../analytics/analytics-fact.service';
import { EdgeService } from '../s3/edge.service';
import { S3Service } from '../s3/s3.service';
import { PROJECT_CONTENT_MAX_BYTES } from './content-size';
import { ProjectNotPublishedException, ProjectTooLargeException } from './project.error';
import { ProjectService } from './project.service';
import { ProjectContentService } from './project-content.service';

describe('ProjectContentService', () => {
  let service: ProjectContentService;

  const mocks = new ProjectMocks();
  const {
    prismaMock,
    txMock,
    factsMock,
    s3ServiceMock,
    edgeMock,
    mockLastVersion,
    mockPublishable,
  } = mocks;

  beforeEach(async () => {
    withEnv({
      JWT_SECRET: 'jwt-secret',
      S3_MAX_AUTO_HISTORY_VERSION: '5',
      S3_AUTO_HISTORY_DELAY: '10',
      S3_MAX_CHECKPOINTS: '5',
    });

    const module: TestingModule = await mocks.compile();
    service = module.get<ProjectContentService>(ProjectContentService);

    jest.clearAllMocks();
  });

  describe('configuration', () => {
    const RELEVANT_KEYS = [
      'S3_MAX_AUTO_HISTORY_VERSION',
      'S3_AUTO_HISTORY_DELAY',
      'S3_MAX_CHECKPOINTS',
      'VIEW_HASH_SECRET',
      'JWT_SECRET',
    ] as const;

    const serviceWith = (
      env: Partial<Record<(typeof RELEVANT_KEYS)[number], string>>,
    ): ProjectContentService => {
      withEnv(Object.fromEntries(RELEVANT_KEYS.map((key) => [key, env[key]])));

      const projectService = new ProjectService(
        prismaMock as unknown as PrismaService,
        s3ServiceMock as unknown as S3Service,
        edgeMock as unknown as EdgeService,
        {} as ModuleRef,
        {} as AnalyticsFactService,
      );

      return new ProjectContentService(
        prismaMock as unknown as PrismaService,
        s3ServiceMock as unknown as S3Service,
        edgeMock as unknown as EdgeService,
        projectService,
        {} as AnalyticsFactService,
      );
    };
    const blank = {
      S3_MAX_AUTO_HISTORY_VERSION: '',
      S3_AUTO_HISTORY_DELAY: '',
      S3_MAX_CHECKPOINTS: '',
      VIEW_HASH_SECRET: '',
      JWT_SECRET: 'jwt-secret',
    };

    it('falls back to the defaults for values the environment leaves blank', () => {
      expect(serviceWith(blank).getLimits()).toMatchObject({
        maxCheckpoints: 20,
        maxAutosaves: 4,
      });
    });

    it('keeps an autosave slot open for the default window when the delay is blank', async () => {
      const newest = Date.now() - 30_000;
      s3ServiceMock.listObjects.mockResolvedValue([
        { Key: `save/1/${newest}`, LastModified: new Date(newest) },
      ]);
      prismaMock.workSession.updateMany.mockResolvedValue({ count: 1 });
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);

      await serviceWith(blank).save(1, {
        originalname: 'game.bin',
      } as Express.Multer.File);

      expect(s3ServiceMock.deleteFile).not.toHaveBeenCalled();
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: `save/1/${newest}` }),
      );
    });
  });

  describe('save', () => {
    const file = { originalname: 'game.bin' } as Express.Multer.File;
    const saves = (ages: number[]): void => {
      s3ServiceMock.listObjects.mockResolvedValue(
        ages.map((age) => {
          const at = Date.now() - age;
          return { Key: `save/1/${at}`, LastModified: new Date(at) };
        }),
      );
    };

    beforeEach(() => {
      prismaMock.workSession.updateMany.mockResolvedValue({ count: 1 });
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);
    });

    it('rewrites the open slot while the window lasts', async () => {
      saves([30_000, 700_000, 1_400_000, 2_100_000, 2_800_000]);
      const newest = (await service.listVersions(1))[0]!.name;

      await service.save(1, file);

      expect(s3ServiceMock.deleteFile).not.toHaveBeenCalled();
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: `save/1/${newest}` }),
      );
    });

    it('opens a new slot past the window and lets the oldest go', async () => {
      saves([660_000, 1_400_000, 2_100_000, 2_800_000, 3_500_000]);
      const listed = await service.listVersions(1);
      const oldest = listed[listed.length - 1]!.name;

      await service.save(1, file);

      expect(s3ServiceMock.deleteFile).toHaveBeenCalledTimes(1);
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({
        key: `save/1/${oldest}`,
      });
      const key = s3ServiceMock.uploadFile.mock.calls[0]![0]!.keyName as string;
      expect(key).not.toBe(`save/1/${oldest}`);
      expect(Number(key.split('/').pop())).toBeGreaterThan(Date.now() - 1000);
    });

    it('prunes everything beyond the slots it keeps', async () => {
      saves([660_000, 1e6, 2e6, 3e6, 4e6, 5e6, 6e6]);

      await service.save(1, file);

      expect(s3ServiceMock.deleteFile).toHaveBeenCalledTimes(3);
    });

    it('keeps a single slot without reading past the list', async () => {
      Object.assign(service, { maxAutosaves: 1 });
      saves([660_000]);

      await service.save(1, file);

      expect(s3ServiceMock.deleteFile).toHaveBeenCalledTimes(1);
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('starts the first slot on an empty history', async () => {
      saves([]);

      await service.save(1, file);

      expect(s3ServiceMock.deleteFile).not.toHaveBeenCalled();
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('records the save on the work session in one statement, open or not', async () => {
      saves([]);
      prismaMock.workSession.updateMany.mockResolvedValue({ count: 0 });

      await service.save(1, file);

      expect(prismaMock.workSession.updateMany).toHaveBeenCalledWith({
        where: { projectId: 1 },
        data: { lastSaveAt: expect.any(Date) },
      });
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledTimes(1);
    });

    it('refuses a blob that is not a game document before storing it', async () => {
      saves([]);

      await expect(
        service.save(1, {
          buffer: Buffer.from('hello world, not a yjs update'),
        } as unknown as Express.Multer.File),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(s3ServiceMock.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('checkpoint', () => {
    const named = (names: string[]): void => {
      s3ServiceMock.listObjects.mockResolvedValue(
        names.map((name) => ({ Key: `checkpoint/1/${name}`, LastModified: new Date() })),
      );
    };

    beforeEach(() => {
      jest.spyOn(service, 'fetchLastVersion').mockResolvedValue({
        body: Readable.from([]),
        contentType: 'application/octet-stream',
        contentLength: 0,
      });
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
    });

    it('refuses a new name once the project holds as many as it may', async () => {
      named(['a', 'b', 'c', 'd', 'e']);

      await expect(service.checkpoint(1, 'f')).rejects.toMatchObject({
        count: 5,
        max: 5,
      });
      expect(s3ServiceMock.uploadFile).not.toHaveBeenCalled();
    });

    it('rewrites a name that exists even at the cap', async () => {
      named(['a', 'b', 'c', 'd', 'e']);

      await service.checkpoint(1, ' c ');

      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: 'checkpoint/1/c' }),
      );
    });

    it("refuses a name that could leave the project's prefix", async () => {
      named([]);

      await expect(service.checkpoint(1, '../x')).rejects.toBeInstanceOf(BadRequestException);
      expect(s3ServiceMock.listObjects).not.toHaveBeenCalled();
    });
  });

  describe('deleteVersion', () => {
    it('should delete an existing autosave', async () => {
      s3ServiceMock.listObjects.mockResolvedValue([
        { Key: 'save/1/1742901234567', LastModified: new Date() },
      ]);
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);

      await service.deleteVersion(1, '1742901234567');

      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({
        key: 'save/1/1742901234567',
      });
    });

    it('should refuse a name that could climb out of the project prefix', async () => {
      await expect(service.deleteVersion(1, '../release/2')).rejects.toThrow(BadRequestException);
      expect(s3ServiceMock.deleteFile).not.toHaveBeenCalled();
    });

    it("should 404 rather than delete a key that is not one of this project's saves", async () => {
      s3ServiceMock.listObjects.mockResolvedValue([]);

      await expect(service.deleteVersion(1, '1742901234567')).rejects.toThrow(NotFoundException);
      expect(s3ServiceMock.deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('fetchSavedVersion', () => {
    it('should refuse a name that could climb out of the project prefix', async () => {
      await expect(service.fetchSavedVersion(1, '../../save/7/1700000000000')).rejects.toThrow(
        BadRequestException,
      );
      expect(s3ServiceMock.downloadFile).not.toHaveBeenCalled();
    });
  });

  describe('fetchLastVersion', () => {
    it('takes the newest save when two land in the same second, whatever the listing order', async () => {
      const sameSecond = new Date(5000);
      for (const keys of [
        ['save/1/1000', 'save/1/1500'],
        ['save/1/1500', 'save/1/1000'],
      ]) {
        s3ServiceMock.listObjects.mockResolvedValue(
          keys.map((Key) => ({ Key, LastModified: sameSecond })),
        );
        s3ServiceMock.downloadFile.mockResolvedValue({
          body: Readable.from([]),
          contentType: 'application/octet-stream',
          contentLength: 0,
        });

        await service.fetchLastVersion(1);

        expect(s3ServiceMock.downloadFile).toHaveBeenLastCalledWith({
          key: 'save/1/1500',
        });
      }
    });
  });

  describe('content size budget', () => {
    it('exposes the limits', () => {
      expect(service.getLimits()).toEqual({
        maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
        maxBlobBytes: 16 * 1024 * 1024,
        maxCheckpoints: 5,
        maxAutosaves: 5,
      });
    });

    it('stores the breakdown when saving', async () => {
      s3ServiceMock.listObjects.mockResolvedValue([]);
      prismaMock.workSession.updateMany.mockResolvedValue({ count: 0 });
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
      prismaMock.project.update.mockResolvedValue({});

      await service.save(1, {
        buffer: encodeGame(10),
      } as unknown as Express.Multer.File);

      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          contentSize: expect.objectContaining({ code: 10, schemaVersion: 1 }),
          contentSizeTotal: 10,
        },
      });
    });

    it('returns the stored breakdown without touching S3', async () => {
      const contentSize = {
        code: 5,
        sprites: 0,
        flags: 0,
        map: 0,
        sound: 0,
        palette: 0,
        total: 5,
        schemaVersion: 1,
      };
      prismaMock.project.findUnique.mockResolvedValue({ contentSize });

      const result = await service.getContentSize(1);

      expect(result).toEqual({
        projectId: 1,
        contentSize,
        maxContentBytes: PROJECT_CONTENT_MAX_BYTES,
        withinBudget: true,
      });
      expect(s3ServiceMock.downloadFile).not.toHaveBeenCalled();
    });

    it('computes and persists the breakdown when it is missing', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ contentSize: null });
      prismaMock.project.update.mockResolvedValue({});
      mockLastVersion(encodeGame(7));

      const result = await service.getContentSize(1);

      expect(result.contentSize.code).toBe(7);
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contentSizeTotal: 7 }),
        }),
      );
    });

    it('sizes a project without marking it as edited', async () => {
      const updatedAt = new Date('2026-01-01T00:00:00Z');
      prismaMock.project.findUnique.mockResolvedValue({ updatedAt });
      prismaMock.project.update.mockResolvedValue({});
      mockLastVersion(encodeGame(7));

      await service.recomputeContentSize(1);

      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contentSizeTotal: 7, updatedAt }),
        }),
      );
    });

    it('rejects publishing a project above the budget with a 413', async () => {
      mockPublishable(encodeGame(PROJECT_CONTENT_MAX_BYTES + 1));

      await expect(service.publish(1, 9)).rejects.toBeInstanceOf(ProjectTooLargeException);

      expect(txMock.project.update).not.toHaveBeenCalled();
      expect(factsMock.record).not.toHaveBeenCalled();
      expect(s3ServiceMock.uploadFile).not.toHaveBeenCalled();
    });

    it('publishes a project within the budget, and marks the row only once the blob is up', async () => {
      mockPublishable(encodeGame(3));

      await service.publish(1, 9);

      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: 'release/1' }),
      );
      const [marked] = txMock.project.update.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >;
      expect(marked?.[0].data).toHaveProperty('publishedAt');
      expect(marked?.[0].data).not.toHaveProperty('status');
      expect(s3ServiceMock.uploadFile.mock.invocationCallOrder[0]).toBeLessThan(
        txMock.project.update.mock.invocationCallOrder[0]!,
      );
    });
  });

  describe('releases', () => {
    it('tells the edge to ask again before serving a release it kept', async () => {
      mockPublishable(encodeGame(3));

      await service.publish(1, 9);

      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: 'release/1', cacheControl: 'no-cache' }),
      );
    });

    it('unpublishes by clearing the row before dropping the blob', async () => {
      txMock.project.update.mockResolvedValue({});
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);

      await service.unpublish(1, 9);

      expect(txMock.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { publishedAt: null, releaseRevision: 0 },
      });
      expect(s3ServiceMock.deleteFile).toHaveBeenCalledWith({ key: 'release/1' });
      expect(txMock.project.update.mock.invocationCallOrder[0]).toBeLessThan(
        s3ServiceMock.deleteFile.mock.invocationCallOrder[0]!,
      );
    });

    it('refuses to update the release of a project that has none', async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        publishedAt: null,
        name: 'Small',
        shortDesc: '',
        longDesc: null,
        tags: [],
      });

      await expect(service.updateRelease(1, 9)).rejects.toBeInstanceOf(
        ProjectNotPublishedException,
      );
      expect(s3ServiceMock.uploadFile).not.toHaveBeenCalled();
    });
  });
  describe('release transitions', () => {
    /** The release state of the project row, as the row lock reads it and the update writes it. */
    let row: {
      publishedAt: Date | null;
      releaseContentHash: string | null;
      releaseRevision: number;
    };

    const recorded = (): Array<{ type: string; dedupeKey: string }> =>
      (factsMock.record.mock.calls as Array<[unknown, { type: string; dedupeKey: string }]>).map(
        ([, fact]) => ({ type: fact.type, dedupeKey: fact.dedupeKey }),
      );

    const releaseWith = async (content: Buffer): Promise<void> => {
      mockLastVersion(content);
      await (row.publishedAt ? service.updateRelease(1, 9) : service.publish(1, 9));
    };

    beforeEach(() => {
      row = { publishedAt: null, releaseContentHash: null, releaseRevision: 0 };
      mockPublishable(encodeGame(3));
      prismaMock.project.findUnique.mockImplementation(() =>
        Promise.resolve({
          publishedAt: row.publishedAt,
          name: 'Small',
          shortDesc: '',
          longDesc: null,
          tags: [],
        }),
      );
      txMock.$queryRaw.mockImplementation(() => Promise.resolve([{ ...row }]));
      txMock.project.update.mockImplementation(({ data }: { data: Partial<typeof row> }) => {
        row = { ...row, ...data };
        return Promise.resolve({});
      });
      s3ServiceMock.deleteFile.mockResolvedValue(undefined);
    });

    it('records a publish, then an update per content change, and nothing for a retry', async () => {
      const contentA = encodeGame(3);
      const contentB = encodeGame(4);

      await releaseWith(contentA);
      await releaseWith(contentB);
      await releaseWith(contentA);
      await releaseWith(contentB);
      await releaseWith(contentB);

      expect(recorded()).toEqual([
        { type: 'RELEASE_PUBLISHED', dedupeKey: 'release:1:1' },
        { type: 'RELEASE_UPDATED', dedupeKey: 'release:1:2' },
        { type: 'RELEASE_UPDATED', dedupeKey: 'release:1:3' },
        { type: 'RELEASE_UPDATED', dedupeKey: 'release:1:4' },
      ]);
      expect(row.releaseRevision).toBe(4);
    });

    it('records the acting collaborator and the project with each transition', async () => {
      await releaseWith(encodeGame(3));

      expect(factsMock.record).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({ actorUserId: 9, projectId: 1 }),
      );
    });

    it('records an unpublish only when the project was published', async () => {
      await service.unpublish(1, 9);
      expect(recorded()).toEqual([]);

      await releaseWith(encodeGame(3));
      await service.unpublish(1, 9);

      expect(recorded()).toEqual([
        { type: 'RELEASE_PUBLISHED', dedupeKey: 'release:1:1' },
        { type: 'RELEASE_UNPUBLISHED', dedupeKey: 'release:1:2' },
      ]);
    });

    it('treats a changed published description as an update of the same content', async () => {
      const content = encodeGame(3);
      await releaseWith(content);

      prismaMock.project.findUnique.mockImplementation(() =>
        Promise.resolve({
          publishedAt: row.publishedAt,
          name: 'Small',
          shortDesc: 'Now with a description',
          longDesc: null,
          tags: [],
        }),
      );
      await releaseWith(content);

      expect(recorded().map((fact) => fact.type)).toEqual(['RELEASE_PUBLISHED', 'RELEASE_UPDATED']);
    });
  });
});
