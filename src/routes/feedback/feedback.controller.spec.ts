import { HttpStatus, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { ViolationValidationPipe } from '../../common/pipes/violation-validation.pipe';
import { useTextJsonParser } from '../analytics/analytics-ingest-paths';
import { ANALYTICS_THROTTLERS } from '../analytics/analytics-throttler.guard';
import { CrashService } from './crash.service';
import { CrashIngestController } from './crash-ingest.controller';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { SCREENSHOT_MAX_BYTES } from './screenshot-upload';

// The signature detector is an ES module this Jest setup cannot load, and the upload validator
// refuses every file without it.
jest.mock('load-esm', () => ({
  loadEsm: async (): Promise<unknown> => ({
    fileTypeFromBuffer: async (buffer: Buffer): Promise<{ mime: string } | undefined> =>
      buffer.subarray(1, 4).toString('latin1') === 'PNG' ? { mime: 'image/png' } : undefined,
  }),
}));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

describe('FeedbackController and CrashIngestController', () => {
  let app: INestApplication;
  const feedback = {
    assertEnabled: jest.fn(),
    promptState: jest.fn(),
    updatePrompt: jest.fn(),
    createRating: jest.fn(),
    createBugReport: jest.fn(),
  };
  const crashes = { recordSafely: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    feedback.createRating.mockResolvedValue({ id: 1 });
    feedback.createBugReport.mockResolvedValue({ id: 2 });
    crashes.recordSafely.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: ANALYTICS_THROTTLERS })],
      controllers: [FeedbackController, CrashIngestController],
      providers: [
        { provide: FeedbackService, useValue: feedback },
        { provide: CrashService, useValue: crashes },
      ],
    }).compile();
    app = module.createNestApplication();
    useTextJsonParser(app);
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: unknown }).user = { id: 7 };
      next();
    });
    app.useGlobalPipes(
      new ViolationValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const bug = (): request.Test =>
    request(app.getHttpServer())
      .post('/feedback/bugs')
      .field('category', 'GAMEPLAY')
      .field('title', 'Jump is stuck')
      .field('description', 'Pressing jump twice freezes the player.')
      .field('route', '/play/42')
      .field('releaseId', '42');

  it('answers 404 for every route while feedback is off', async () => {
    feedback.assertEnabled.mockImplementation(() => {
      throw new NotFoundException();
    });

    const response = await request(app.getHttpServer()).get('/feedback/prompt');

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(feedback.promptState).not.toHaveBeenCalled();
  });

  it('takes a score with no comment', async () => {
    const response = await request(app.getHttpServer())
      .post('/feedback/ratings')
      .send({ score: 9, context: 'PLAYER', source: 'PROMPT' });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(feedback.createRating).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ score: 9, context: 'PLAYER', source: 'PROMPT' }),
    );
  });

  it.each([0, 11, 4.5])('refuses a score of %s', async (score) => {
    const response = await request(app.getHttpServer())
      .post('/feedback/ratings')
      .send({ score, context: 'PLAYER', source: 'MANUAL' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(feedback.createRating).not.toHaveBeenCalled();
  });

  it('takes a bug report without a screenshot, and parses its context', async () => {
    const response = await bug().field(
      'context',
      JSON.stringify({ viewport: '1280x720', console: ['[error] boom'] }),
    );

    expect(response.status).toBe(HttpStatus.CREATED);
    const [userId, dto, , file] = feedback.createBugReport.mock.calls[0] as unknown[];
    expect(userId).toBe(7);
    expect(dto).toMatchObject({
      releaseId: 42,
      context: { viewport: '1280x720', console: ['[error] boom'] },
    });
    expect(file).toBeUndefined();
  });

  it('refuses a context field it does not know', async () => {
    const response = await bug().field('context', JSON.stringify({ cookies: 'secret' }));

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('takes a PNG screenshot', async () => {
    const response = await bug().attach('screenshot', PNG, {
      filename: 'shot.png',
      contentType: 'image/png',
    });

    expect(response.status).toBe(HttpStatus.CREATED);
    const file = feedback.createBugReport.mock.calls[0]?.[3] as Express.Multer.File;
    expect(file.mimetype).toBe('image/png');
  });

  it('refuses a screenshot that is not an image with 422', async () => {
    const response = await bug().attach('screenshot', Buffer.from('<svg></svg>'), {
      filename: 'shot.svg',
      contentType: 'image/svg+xml',
    });

    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(feedback.createBugReport).not.toHaveBeenCalled();
  });

  it('refuses a screenshot over 2 MB with 413', async () => {
    const response = await bug().attach(
      'screenshot',
      Buffer.concat([PNG, Buffer.alloc(SCREENSHOT_MAX_BYTES)]),
      { filename: 'shot.png', contentType: 'image/png' },
    );

    expect(response.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(feedback.createBugReport).not.toHaveBeenCalled();
  });

  it('takes a crash report sent as text/plain, without an account', async () => {
    const response = await request(app.getHttpServer())
      .post('/reports/crash')
      .set('Content-Type', 'text/plain')
      .set('User-Agent', BROWSER)
      .send(
        JSON.stringify({
          source: 'engine',
          name: 'Error',
          message: 'WebGL context lost',
          stack: '',
          route: '/play/42',
          extra: { kind: 'webgl-context-lost' },
        }),
      );

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(crashes.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ENGINE',
        route: '/play/42',
        extra: { kind: 'webgl-context-lost' },
      }),
    );
  });

  it('ignores a crash report from a bot', async () => {
    const response = await request(app.getHttpServer())
      .post('/reports/crash')
      .set('User-Agent', 'Googlebot/2.1')
      .send({ source: 'web', name: 'Error', message: 'x', stack: '', route: '/hub' });

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(crashes.recordSafely).not.toHaveBeenCalled();
  });

  it('refuses a crash report naming a page with its query', async () => {
    const response = await request(app.getHttpServer())
      .post('/reports/crash')
      .set('User-Agent', BROWSER)
      .send({ source: 'web', name: 'Error', message: 'x', stack: '', route: '/hub?token=abc' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
  });
});
