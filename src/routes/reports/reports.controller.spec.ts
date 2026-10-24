import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { ViolationValidationPipe } from '../../common/pipes/violation-validation.pipe';
import { ANALYTICS_THROTTLERS } from '../analytics/analytics-throttler.guard';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let app: INestApplication;
  const reports = { promptState: jest.fn(), updatePrompt: jest.fn(), createRating: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    reports.createRating.mockResolvedValue({ id: 1 });
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
});
