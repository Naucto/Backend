import {
  ExecutionContext,
  HttpStatus,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { Readable, Writable } from 'stream';
import request from 'supertest';

import { withEnv } from '../../../test/env';
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from '../../auth/guards/project.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { EdgeService } from '../s3/edge.service';
import { S3DownloadException, S3ObjectNotFoundException } from '../s3/s3.error';
import { S3Service } from '../s3/s3.service';
import { PROJECT_BLOB_MAX_BYTES } from './content-size';
import { HubController } from './hub.controller';
import type { ReleaseWindow } from './hub.service';
import { HubService } from './hub.service';
import { ProjectController } from './project.controller';
import { ProjectModule } from './project.module';
import { ProjectService } from './project.service';
import { ProjectContentController } from './project-content.controller';
import { ProjectContentService } from './project-content.service';
import { projectIdOf } from './project-id.decorator';

const SIGNED_IN_USER = 7;
const OWN_PROJECT = 12;

/** The controllers in the order the module registers them, which is the order Express tries them. */
const CONTROLLERS = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ProjectModule) as Array<
  typeof HubController | typeof ProjectContentController | typeof ProjectController
>;

describe('project controllers', () => {
  let module: TestingModule;
  let projectController: ProjectController;
  let contentController: ProjectContentController;
  let hubController: HubController;
  let projectService: ProjectService;
  let contentService: ProjectContentService;
  let hubService: HubService;

  const prisma = {
    project: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    user: {},
    workSession: {},
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  const s3 = {
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    setObjectPublicRead: jest.fn(),
    getFileMetadataOrNull: jest.fn(),
  };
  const edge = {
    getCDNUrl: jest.fn((key: string) => `https://cdn.test/${key}`),
  };

  const stored = (): { body: Readable; contentType: string; contentLength: number } => ({
    body: Readable.from(['blob']),
    contentType: 'application/octet-stream',
    contentLength: 4,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    withEnv({
      JWT_SECRET: 'jwt-secret',
      S3_MAX_AUTO_HISTORY_VERSION: '5',
      S3_AUTO_HISTORY_DELAY: '10',
      S3_MAX_CHECKPOINTS: '5',
    });
    edge.getCDNUrl.mockImplementation((key: string) => `https://cdn.test/${key}`);
    // The signed-in user collaborates on, and created, one project only.
    prisma.project.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
      where.id === OWN_PROJECT
        ? {
            id: OWN_PROJECT,
            collaborators: [{ id: SIGNED_IN_USER }],
            creator: { id: SIGNED_IN_USER },
          }
        : { id: where.id, collaborators: [], creator: { id: SIGNED_IN_USER + 1 } },
    );

    module = await Test.createTestingModule({
      controllers: CONTROLLERS,
      providers: [
        ProjectService,
        ProjectContentService,
        HubService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3Service, useValue: s3 },
        { provide: EdgeService, useValue: edge },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (context: ExecutionContext): boolean => {
              context.switchToHttp().getRequest().user = { id: SIGNED_IN_USER };
              return true;
            },
          },
        },
      ],
    }).compile();

    projectController = module.get<ProjectController>(ProjectController);
    contentController = module.get<ProjectContentController>(ProjectContentController);
    hubController = module.get<HubController>(HubController);
    projectService = module.get<ProjectService>(ProjectService);
    contentService = module.get<ProjectContentService>(ProjectContentService);
    hubService = module.get<HubService>(HubService);
  });

  describe('getRelease', () => {
    it('does not describe a project the hub does not carry', async () => {
      jest.spyOn(hubService, 'fetchRelease').mockResolvedValue({
        id: 39,
        publishedAt: null,
      } as unknown as Awaited<ReturnType<HubService['fetchRelease']>>);

      await expect(hubController.getRelease(39)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('authorization', () => {
    const guardsOf = (method: string): unknown[] => {
      const owner = CONTROLLERS.find((controller) => method in controller.prototype);
      const handler = (owner?.prototype as Record<string, object> | undefined)?.[method];
      return (handler ? (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) : []) as unknown[];
    };

    it.each([
      'findOne',
      'getSize',
      'update',
      'saveProjectContent',
      'uploadProjectImage',
      'getProjectImage',
      'fetchProjectContent',
      'saveCheckpoint',
      'deleteCheckpoint',
      'publish',
      'unpublish',
      'updateRelease',
      'getVersions',
      'getCheckpoints',
      'deleteVersion',
      'getVersion',
      'getCheckpoint',
    ] as const)('%s is open to every collaborator, not the creator alone', (method) => {
      expect(guardsOf(method)).toContain(ProjectCollaboratorGuard);
      expect(guardsOf(method)).not.toContain(ProjectCreatorGuard);
    });

    it.each(['addCollaborator', 'removeCollaborator', 'remove'] as const)(
      "%s is the creator's alone",
      (method) => {
        expect(guardsOf(method)).toContain(ProjectCreatorGuard);
      },
    );

    it('reads every :id as the URL spells it, so a handler and its guard agree on the project', () => {
      const handlers = CONTROLLERS.flatMap((controller) => {
        const prototype = controller.prototype as unknown as Record<string, object>;
        return Object.getOwnPropertyNames(prototype)
          .filter((name) =>
            String(Reflect.getMetadata(PATH_METADATA, prototype[name]!) ?? '').includes(':id'),
          )
          .map((name) => ({ controller, name }));
      });
      expect(handlers.length).toBeGreaterThan(0);

      const lenient = handlers
        .filter(({ controller, name }) => {
          const args = Object.values(
            Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) as Record<
              string,
              { factory?: unknown }
            >,
          );
          return !args.some((arg) => arg.factory === projectIdOf);
        })
        .map(({ controller, name }) => `${controller.name}.${name}`);

      expect(lenient).toEqual([]);
    });
  });

  describe('catalogue filters', () => {
    it('should ignore a release window it does not know', async () => {
      const fetchPage = jest
        .spyOn(hubService, 'fetchPublishedGamesPaginated')
        .mockResolvedValue({ projects: [], total: 0, page: 1, limit: 24 });
      const count = jest.spyOn(hubService, 'countPublishedGames').mockResolvedValue(0);
      const unknown = '1y' as ReleaseWindow;

      await hubController.getPaginatedReleases(undefined, undefined, undefined, undefined, unknown);
      await hubController.countReleasedProjects(undefined, undefined, unknown);

      expect(fetchPage.mock.calls[0]![2]).toEqual({});
      expect(count).toHaveBeenCalledWith({});
    });

    it('should keep a release window it knows', async () => {
      const count = jest.spyOn(hubService, 'countPublishedGames').mockResolvedValue(0);

      await hubController.countReleasedProjects(undefined, undefined, '30d');

      expect(count).toHaveBeenCalledWith({ releaseWindow: '30d' });
    });

    it('should fall back to the default page and limit when they are not numbers', async () => {
      const findAll = jest
        .spyOn(projectService, 'findAll')
        .mockResolvedValue({ projects: [], total: 0, page: 1, limit: 24 });

      await projectController.findAll(
        { user: { id: SIGNED_IN_USER } } as Parameters<ProjectController['findAll']>[0],
        'abc',
        'many',
      );

      expect(findAll).toHaveBeenCalledWith(SIGNED_IN_USER, undefined, undefined);
    });
  });

  describe('getReleaseTags', () => {
    it('should keep a suggestion list to a handful however many are asked for', async () => {
      const fetchTags = jest.spyOn(hubService, 'fetchPublishedTags').mockResolvedValue([]);

      await hubController.getReleaseTags('sn', '500');

      expect(fetchTags).toHaveBeenCalledWith('sn', 12);
    });

    it('should keep to a handful when the limit is not a number', async () => {
      const fetchTags = jest.spyOn(hubService, 'fetchPublishedTags').mockResolvedValue([]);

      await hubController.getReleaseTags('sn', 'abc');

      expect(fetchTags).toHaveBeenCalledWith('sn', 12);
    });

    it('should ask for every tag when nothing was typed', async () => {
      const fetchTags = jest
        .spyOn(hubService, 'fetchPublishedTags')
        .mockResolvedValue([{ tag: 'snake', count: 4 }]);

      const result = await hubController.getReleaseTags();

      expect(fetchTags).toHaveBeenCalledWith('', 12);
      expect(result).toEqual({ tags: [{ tag: 'snake', count: 4 }] });
    });
  });

  describe('uploadProjectImage', () => {
    it("sends nothing of the file's own name to the store", async () => {
      const file = {
        originalname: 'écran.png',
        mimetype: 'image/png',
        buffer: Buffer.from('png'),
      } as Express.Multer.File;

      await projectController.uploadProjectImage(OWN_PROJECT, file, {
        user: { id: SIGNED_IN_USER },
      } as Parameters<ProjectController['uploadProjectImage']>[2]);

      const { metadata } = s3.uploadFile.mock.calls[0]![0] as {
        metadata: Record<string, string>;
      };
      expect(Object.values(metadata)).not.toContain('écran.png');
    });
  });

  describe('getPublishedProjectImage', () => {
    it('does not hand out the cover of a project the hub does not carry', async () => {
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(hubController.getPublishedProjectImage(OWN_PROJECT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(s3.getFileMetadataOrNull).not.toHaveBeenCalled();
    });
  });

  describe('downloads', () => {
    it('closes the connection when the stored stream fails mid-download', async () => {
      const body = new Readable({
        read(): void {
          this.push('partial');
          this.destroy(new Error('ECONNRESET mid-stream'));
        },
      });
      jest.spyOn(contentService, 'fetchLastVersion').mockResolvedValue({ ...stored(), body });
      const res = Object.assign(
        new Writable({
          write(_chunk, _encoding, done): void {
            done();
          },
        }),
        { set: jest.fn() },
      );

      await contentController.fetchProjectContent(OWN_PROJECT, res as unknown as Response);
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.destroyed).toBe(true);
    });
  });

  describe('over HTTP', () => {
    let app: INestApplication;
    const http = (): ReturnType<typeof request> => request(app.getHttpServer());

    beforeEach(async () => {
      app = module.createNestApplication({ logger: false });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    // parseInt reads "12.34e2" as 12, the user's own project; Number reads it as 1234.
    it.each([
      ['get', '/projects/12.34e2', 'findOne'],
      ['put', '/projects/12.34e2', 'update'],
      ['delete', '/projects/12.34e2', 'remove'],
      ['patch', '/projects/12.34e2/add-collaborator', 'addCollaborator'],
      ['delete', '/projects/12.34e2/remove-collaborator', 'removeCollaborator'],
      ['post', '/projects/12.34e2/image', 'uploadImage'],
    ] as const)(
      '%s %s never reaches a project other than the one the guard checked',
      async (verb, path, method) => {
        const reached = jest.spyOn(projectService, method).mockResolvedValue(undefined as never);
        const pending = http()[verb](path);
        if (method === 'uploadImage') {
          pending.attach('file', Buffer.from('blob'), 'game.bin');
        } else if (verb !== 'get') {
          pending.send({ name: 'Renamed', shortDesc: '', userId: 3 });
        }

        const response = await pending;

        expect(reached).not.toHaveBeenCalled();
        expect([HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN]).toContain(response.status);
      },
    );

    it.each([
      ['get', '/projects/12.34e2/size', 'getContentSize'],
      ['patch', '/projects/12.34e2/content', 'save'],
      ['get', '/projects/12.34e2/content', 'fetchLastVersion'],
      ['post', '/projects/12.34e2/publish', 'publish'],
      ['post', '/projects/12.34e2/unpublish', 'unpublish'],
      ['post', '/projects/12.34e2/update-release', 'updateRelease'],
      ['get', '/projects/12.34e2/versions', 'listVersions'],
      ['get', '/projects/12.34e2/checkpoints', 'listCheckpoints'],
      ['delete', '/projects/12.34e2/versions/1', 'deleteVersion'],
      ['get', '/projects/12.34e2/versions/1', 'fetchSavedVersion'],
      ['delete', '/projects/12.34e2/checkpoints/x', 'removeCheckpoint'],
      ['get', '/projects/12.34e2/checkpoints/x', 'fetchCheckpoint'],
      ['post', '/projects/12.34e2/checkpoints/x', 'save'],
    ] as const)(
      '%s %s never reaches a project other than the one the guard checked',
      async (verb, path, method) => {
        const reached = jest.spyOn(contentService, method).mockResolvedValue(undefined as never);
        const pending = http()[verb](path);
        if (method === 'save') {
          pending.attach('file', Buffer.from('blob'), 'game.bin');
        } else if (verb !== 'get') {
          pending.send({ name: 'Renamed', shortDesc: '', userId: 3 });
        }

        const response = await pending;

        expect(reached).not.toHaveBeenCalled();
        expect([HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN]).toContain(response.status);
      },
    );

    it.each([
      ['get', '/projects/releases/abc'],
      ['get', '/projects/releases/abc/content'],
      ['get', '/projects/releases/abc/content-url'],
      ['post', '/projects/releases/abc/like'],
      ['delete', '/projects/releases/abc/like'],
      ['get', '/projects/releases/abc/like-status'],
    ] as const)('%s %s refuses an id that is not a number', async (verb, path) => {
      await http()[verb](path).expect(HttpStatus.BAD_REQUEST);
    });

    it('refuses an update from someone who is not on the project', async () => {
      const update = jest.spyOn(projectService, 'update');

      await http()
        .put('/projects/99')
        .send({ name: 'Taken over', shortDesc: '' })
        .expect(HttpStatus.FORBIDDEN);

      expect(update).not.toHaveBeenCalled();
    });

    const downloads = [
      ['/projects/releases/12/content', 'fetchReleaseContent'],
      ['/projects/12/content', 'fetchLastVersion'],
      ['/projects/12/versions/1', 'fetchSavedVersion'],
      ['/projects/12/checkpoints/x', 'fetchCheckpoint'],
    ] as const;

    it.each(downloads)('GET %s streams what the store holds', async (path, method) => {
      jest.spyOn(contentService, method).mockResolvedValue(stored());

      const response = await http().get(path).expect(HttpStatus.OK);

      expect(response.body.toString()).toBe('blob');
    });

    it.each(downloads)(
      'GET %s answers 404 for an object the store does not hold',
      async (path, method) => {
        jest
          .spyOn(contentService, method)
          .mockRejectedValue(new S3ObjectNotFoundException('bucket', 'key'));

        await http().get(path).expect(HttpStatus.NOT_FOUND);
      },
    );

    it.each(downloads)(
      'GET %s does not pass a storage failure off as a missing file',
      async (path, method) => {
        jest
          .spyOn(contentService, method)
          .mockRejectedValue(new S3DownloadException('bucket', 'key', new Error('timeout')));

        await http().get(path).expect(HttpStatus.INTERNAL_SERVER_ERROR);
      },
    );

    it('downloads a checkpoint whose name is not plain ASCII', async () => {
      jest.spyOn(contentService, 'fetchCheckpoint').mockResolvedValue(stored());

      const response = await http()
        .get(`/projects/12/checkpoints/${encodeURIComponent('v1 – final')}`)
        .expect(HttpStatus.OK);

      expect(response.headers['content-disposition']).toContain(
        "filename*=UTF-8''v1%20%E2%80%93%20final",
      );
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers).not.toHaveProperty('etag');
    });

    it('answers 400, not 500, for a checkpoint name the store would not accept', async () => {
      await http()
        .get(`/projects/12/checkpoints/${encodeURIComponent('a/b')}`)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it.each([
      ['patch', '/projects/12/content', PROJECT_BLOB_MAX_BYTES],
      ['post', '/projects/12/checkpoints/x', PROJECT_BLOB_MAX_BYTES],
      ['post', '/projects/12/image', 5 * 1024 * 1024],
    ] as const)('%s %s stops reading an upload past its size limit', async (verb, path, limit) => {
      const save = jest.spyOn(contentService, 'save');

      await http()
        [verb](path)
        .attach('file', Buffer.alloc(limit + 1), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(HttpStatus.PAYLOAD_TOO_LARGE);

      expect(save).not.toHaveBeenCalled();
      expect(s3.uploadFile).not.toHaveBeenCalled();
    });

    it('answers the status it documents when a checkpoint is deleted', async () => {
      jest.spyOn(contentService, 'removeCheckpoint').mockResolvedValue();

      const response = await http().delete('/projects/12/checkpoints/x').expect(HttpStatus.OK);

      expect(response.body).toEqual({
        message: 'Checkpoint deleted successfully',
        id: OWN_PROJECT,
      });
    });

    it.each([
      ['/projects/releases', 'fetchPublishedGames'],
      ['/projects/releases/paginated', 'fetchPublishedGamesPaginated'],
      ['/projects/releases/tags', 'fetchPublishedTags'],
      ['/projects/releases/count', 'countPublishedGames'],
    ] as const)('GET %s answers from its own route, not from an :id one', async (path, method) => {
      const findOne = jest.spyOn(projectService, 'findOne');
      const fetchRelease = jest.spyOn(hubService, 'fetchRelease');
      const reached = jest.spyOn(hubService, method).mockResolvedValue(undefined as never);

      await http().get(path).expect(HttpStatus.OK);

      expect(reached).toHaveBeenCalledTimes(1);
      expect(findOne).not.toHaveBeenCalled();
      expect(fetchRelease).not.toHaveBeenCalled();
    });

    it('GET /projects/limits answers from its own route, not from the :id one', async () => {
      const findOne = jest.spyOn(projectService, 'findOne');
      const getLimits = jest.spyOn(contentService, 'getLimits');

      await http().get('/projects/limits').expect(HttpStatus.OK);

      expect(getLimits).toHaveBeenCalledTimes(1);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('GET /projects/count answers from its own route, not from the :id one', async () => {
      const findOne = jest.spyOn(projectService, 'findOne');
      const count = jest.spyOn(projectService, 'countUserProjects').mockResolvedValue(3);

      const response = await http().get('/projects/count').expect(HttpStatus.OK);

      expect(response.body).toEqual({ total: 3 });
      expect(count).toHaveBeenCalledWith(SIGNED_IN_USER, {});
      expect(findOne).not.toHaveBeenCalled();
    });
  });
});
