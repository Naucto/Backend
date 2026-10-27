import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { ViolationValidationPipe } from '../../common/pipes/violation-validation.pipe';
import { ANALYTICS_THROTTLERS } from '../analytics/analytics-throttler.guard';
import { SCREENSHOT_MAX_BYTES } from './report-screenshot';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

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

describe('ReportsController', () => {
  let app: INestApplication;
  const reports = {
    promptState: jest.fn(),
    updatePrompt: jest.fn(),
    createRating: jest.fn(),
    createBugReport: jest.fn(),
    attachScreenshot: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    reports.createRating.mockResolvedValue({ id: 1 });
    reports.createBugReport.mockResolvedValue({ id: 2 });
    reports.attachScreenshot.mockResolvedValue(undefined);
    reports.updatePrompt.mockResolvedValue({ eligible: false, declined: true });

    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: ANALYTICS_THROTTLERS })],
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: reports }],
    }).compile();
    app = module.createNestApplication();
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

  const rate = (body: object): request.Test =>
    request(app.getHttpServer()).post('/reports/ratings').send(body);

  it('takes a score with no comment, as a player or a creator', async () => {
    const response = await rate({ score: 9, role: 'CREATOR', origin: 'PROMPT' });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toEqual({ id: 1 });
    expect(reports.createRating).toHaveBeenCalledWith(7, {
      score: 9,
      role: 'CREATOR',
      origin: 'PROMPT',
      reasons: [],
      liked: undefined,
      improve: undefined,
      releaseId: undefined,
    });
  });

  it('trims the comments and keeps the reasons of a low score', async () => {
    await rate({
      score: 3,
      role: 'PLAYER',
      origin: 'MANUAL',
      reasons: ['BUGS'],
      liked: '  the sprites  ',
      improve: 'loading ',
    });

    expect(reports.createRating).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ reasons: ['BUGS'], liked: 'the sprites', improve: 'loading' }),
    );
  });

  it.each([
    ['a score of 0', { score: 0, role: 'PLAYER', origin: 'PROMPT' }],
    ['a score of 11', { score: 11, role: 'PLAYER', origin: 'PROMPT' }],
    ['no role', { score: 5, origin: 'PROMPT' }],
    ['an unknown reason', { score: 2, role: 'PLAYER', origin: 'PROMPT', reasons: ['NOPE'] }],
    [
      'a comment over 1000 characters',
      { score: 6, role: 'PLAYER', origin: 'PROMPT', liked: 'a'.repeat(1001) },
    ],
  ])('refuses %s', async (_, body) => {
    const response = await rate(body);

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(reports.createRating).not.toHaveBeenCalled();
  });

  it('acts on the prompt of the signed-in account', async () => {
    const response = await request(app.getHttpServer())
      .put('/reports/prompt')
      .send({ action: 'decline' });

    expect(response.status).toBe(HttpStatus.OK);
    expect(reports.updatePrompt).toHaveBeenCalledWith(7, 'decline');
  });

  it('refuses an unknown prompt action', async () => {
    const response = await request(app.getHttpServer())
      .put('/reports/prompt')
      .send({ action: 'forget' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
  });

  const bug = {
    category: 'GAMEPLAY',
    title: 'Jump is stuck',
    description: 'Pressing jump twice freezes the player.',
    route: '/play/42',
    releaseId: 42,
    context: { viewport: '1280x720', console: ['[error] boom'] },
  };
  const report = (body: object): request.Test =>
    request(app.getHttpServer()).post('/reports/bugs').set('User-Agent', 'Firefox').send(body);

  it('takes a bug report as JSON, with the context the page lists', async () => {
    const response = await report(bug);

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toEqual({ id: 2 });
    expect(reports.createBugReport).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        category: 'GAMEPLAY',
        title: 'Jump is stuck',
        releaseId: 42,
        context: expect.objectContaining({ viewport: '1280x720', console: ['[error] boom'] }),
      }),
      'Firefox',
    );
  });

  it.each([
    ['a context that is an array', { ...bug, context: [{}] }],
    ['a context that is a string', { ...bug, context: 'x' }],
    ['a context field it does not know', { ...bug, context: { cookies: 'secret' } }],
    ['too many console lines', { ...bug, context: { console: Array(51).fill('x') } }],
    ['a route with a query', { ...bug, route: '/play/42?token=x' }],
    ['a summary under 3 characters', { ...bug, title: 'ab' }],
  ])('refuses %s', async (_, body) => {
    const response = await report(body);

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(reports.createBugReport).not.toHaveBeenCalled();
  });

  const attach = (file: Buffer, contentType: string): request.Test =>
    request(app.getHttpServer())
      .put('/reports/bugs/31/screenshot')
      .attach('screenshot', file, { filename: 'shot', contentType });

  it('attaches a PNG screenshot', async () => {
    const response = await attach(PNG, 'image/png');

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(reports.attachScreenshot).toHaveBeenCalledWith(
      7,
      31,
      expect.objectContaining({ mimetype: 'image/png' }),
    );
  });

  it('refuses a file that is not an image with 422', async () => {
    const response = await attach(Buffer.from('not an image'), 'image/png');

    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('refuses a screenshot over 2 MB with 413', async () => {
    const response = await attach(Buffer.alloc(SCREENSHOT_MAX_BYTES + 1), 'image/png');

    expect(response.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(reports.attachScreenshot).not.toHaveBeenCalled();
  });
});
