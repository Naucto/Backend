import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { ViolationValidationPipe } from '../../common/pipes/violation-validation.pipe';
import { useTextJsonParser } from '../analytics/analytics-ingest-paths';
import { ANALYTICS_THROTTLERS } from '../analytics/analytics-throttler.guard';
import { CrashService } from './crash.service';
import { CrashIngestController } from './crash-ingest.controller';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

describe('CrashIngestController', () => {
  let app: INestApplication;
  const crashes = { recordSafely: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    crashes.recordSafely.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: ANALYTICS_THROTTLERS })],
      controllers: [CrashIngestController],
      providers: [{ provide: CrashService, useValue: crashes }],
    }).compile();
    app = module.createNestApplication();
    useTextJsonParser(app);
    app.useGlobalPipes(
      new ViolationValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const crash = {
    source: 'engine',
    name: 'WebGlError',
    message: 'WebGL context lost',
    stack: 'WebGlError: lost',
    route: '/play/42',
    extra: { kind: 'webgl-context-lost' },
  };
  const send = (body: object, userAgent = BROWSER): request.Test =>
    request(app.getHttpServer())
      .post('/reports/crash')
      .set('Content-Type', 'text/plain')
      .set('User-Agent', userAgent)
      .send(JSON.stringify(body));

  it('takes a crash as text/plain JSON, without an account', async () => {
    const response = await send(crash);

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(crashes.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'ENGINE',
        name: 'WebGlError',
        route: '/play/42',
        userAgent: BROWSER,
        extra: { kind: 'webgl-context-lost' },
      }),
    );
  });

  it('ignores a bot', async () => {
    const response = await send(crash, 'Googlebot/2.1 (+http://www.google.com/bot.html)');

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(crashes.recordSafely).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown source', { ...crash, source: 'backend' }],
    ['a route with a query', { ...crash, route: '/play/42?x=1' }],
    ['an extra field it does not know', { ...crash, extra: { cookie: 'x' } }],
  ])('refuses %s', async (_, body) => {
    const response = await send(body);

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(crashes.recordSafely).not.toHaveBeenCalled();
  });
});
