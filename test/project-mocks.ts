import { Test, TestingModule } from '@nestjs/testing';
import { MonetizationType, Prisma, ProjectStatus } from '@prisma/client';
import { Readable } from 'stream';
import * as Y from 'yjs';

import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsFactService } from '../src/routes/analytics/analytics-fact.service';
import { GAME_KEYS } from '../src/routes/project/content-size';
import { HubService } from '../src/routes/project/hub.service';
import { ProjectService } from '../src/routes/project/project.service';
import { ProjectContentService } from '../src/routes/project/project-content.service';
import { COLLABORATOR_SELECT, CREATOR_SELECT } from '../src/routes/project/project-select';
import { EdgeService } from '../src/routes/s3/edge.service';
import { S3Service } from '../src/routes/s3/s3.service';
import { WorkSessionService } from '../src/routes/work-session/work-session.service';

type ProjectWithPeople = Prisma.ProjectGetPayload<{
  include: {
    creator: { select: typeof CREATOR_SELECT };
    collaborators: { select: typeof COLLABORATOR_SELECT };
  };
}>;

/** A draft nobody has released; a test overrides only the fields its case is about. */
export const aProject = (overrides: Partial<ProjectWithPeople> = {}): ProjectWithPeople => ({
  id: 1,
  name: 'Project A',
  shortDesc: 'Short A',
  longDesc: 'Long A',
  tags: ['Action'],
  publishedName: null,
  publishedShortDesc: null,
  publishedLongDesc: null,
  publishedTags: [],
  status: ProjectStatus.IN_PROGRESS,
  iconUrl: null,
  monetization: MonetizationType.NONE,
  price: 0,
  createdAt: new Date(),
  userId: 1,
  viewCount: 0,
  uniquePlayers: 0,
  likes: 0,
  updatedAt: new Date(),
  publishedAt: null,
  releaseRevision: 0,
  releaseContentHash: null,
  forkedFromId: null,
  contentSize: null,
  contentSizeTotal: null,
  creator: { id: 42, username: 'creatorUser' },
  collaborators: [{ id: 1, username: 'user1' }],
  ...overrides,
});

export const draft = aProject();
export const released = aProject({
  id: 2,
  name: 'Project B',
  shortDesc: 'Short B',
  longDesc: 'Long B',
  tags: ['Shooter', 'Adventure'],
  publishedName: 'Project B',
  publishedShortDesc: 'Short B',
  publishedLongDesc: 'Long B',
  publishedTags: ['Shooter', 'Adventure'],
  publishedAt: new Date(),
  viewCount: 42,
  likes: 187,
});

export const knownError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

export const encodeGame = (codeLength: number): Buffer => {
  const doc = new Y.Doc();
  doc.getMap<unknown>(GAME_KEYS.meta).set('schemaVersion', 1);
  const file = new Y.Map<unknown>();
  const text = new Y.Text();
  doc.getMap<unknown>(GAME_KEYS.codeFiles).set('main', file);
  file.set('text', text);
  text.insert(0, 'x'.repeat(codeLength));
  return Buffer.from(Y.encodeStateAsUpdate(doc));
};

/** The release state a release change reads under its row lock. */
export interface ReleaseStateRow {
  publishedAt: Date | null;
  releaseContentHash: string | null;
  releaseRevision: number;
}

/** The stores the three project services stand on, mocked, and the services built over them. */
export class ProjectMocks {
  /** The client an interactive `$transaction` callback receives, kept apart so a test can tell the two. */
  readonly txMock = {
    // The row lock of a release change; an unpublished project by default.
    $queryRaw: jest.fn(
      (): Promise<ReleaseStateRow[]> =>
        Promise.resolve([{ publishedAt: null, releaseContentHash: null, releaseRevision: 0 }]),
    ),
    like: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    project: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  readonly prismaMock = {
    releaseView: {
      count: jest.fn(),
      create: jest.fn(),
    },
    project: {
      aggregate: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    like: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
    workSession: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    gameSession: {
      deleteMany: jest.fn(),
    },
    tx: this.txMock,
    $transaction: jest.fn(
      (arg: Array<Promise<unknown>> | ((tx: ProjectMocks['txMock']) => unknown)) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(this.txMock),
    ),
  };

  readonly s3ServiceMock = {
    deleteFile: jest.fn(),
    listObjects: jest.fn(),
    deleteFiles: jest.fn(),
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    fileExists: jest.fn(),
    setObjectPublicRead: jest.fn(),
  };

  readonly edgeMock = {
    getCDNUrl: jest.fn((key: string) => `https://cdn.test/${key}`),
  };

  readonly notificationsMock = {
    notifyBestEffort: jest.fn(),
  };

  readonly workSessionsMock = {
    kick: jest.fn().mockResolvedValue(undefined),
  };

  readonly factsMock = {
    record: jest.fn(),
  };

  readonly mockLastVersion = (blob: Buffer): void => {
    this.s3ServiceMock.listObjects.mockResolvedValue([
      { Key: 'save/1/100', LastModified: new Date(100) },
    ]);
    this.s3ServiceMock.downloadFile.mockResolvedValue({
      body: Readable.from(blob),
      contentType: 'application/octet-stream',
      contentLength: blob.byteLength,
    });
  };

  /** A project whose latest save holds `blob`, and a store that accepts its release. */
  readonly mockPublishable = (blob: Buffer): void => {
    this.prismaMock.project.findUnique.mockResolvedValue({
      name: 'Small',
      shortDesc: '',
      longDesc: null,
      tags: [],
    });
    this.prismaMock.project.update.mockResolvedValue({});
    this.txMock.project.update.mockResolvedValue({});
    this.s3ServiceMock.uploadFile.mockResolvedValue(undefined);
    this.s3ServiceMock.setObjectPublicRead.mockResolvedValue(undefined);
    this.mockLastVersion(blob);
  };

  async compile(): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        ProjectService,
        ProjectContentService,
        HubService,
        { provide: PrismaService, useValue: this.prismaMock },
        { provide: S3Service, useValue: this.s3ServiceMock },
        { provide: EdgeService, useValue: this.edgeMock },
        { provide: NotificationsService, useValue: this.notificationsMock },
        { provide: WorkSessionService, useValue: this.workSessionsMock },
        { provide: AnalyticsFactService, useValue: this.factsMock },
      ],
    }).compile();
  }
}
