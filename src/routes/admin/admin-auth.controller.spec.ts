import { HttpStatus, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionService } from './admin-session.service';
import { ADMIN_SESSION_COOKIE } from './admin-session-cookie';

describe('AdminAuthController refresh', () => {
  let app: INestApplication;
  const refresh = jest.fn();

  beforeEach(async () => {
    refresh.mockReset();
    const module = await Test.createTestingModule({
      controllers: [AdminAuthController],
      providers: [{ provide: AdminSessionService, useValue: { refresh } }],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (cookie?: string): request.Test => {
    const pending = request(app.getHttpServer()).post('/admin/auth/refresh');
    return cookie === undefined
      ? pending
      : pending.set('Cookie', `${ADMIN_SESSION_COOKIE}=${cookie}`);
  };

  it('answers no content when there is no session cookie', async () => {
    const response = await post();

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('clears a cookie that no longer opens a session, and answers no content', async () => {
    refresh.mockRejectedValue(new UnauthorizedException('Session expired'));

    const response = await post('stale');

    expect(response.status).toBe(HttpStatus.NO_CONTENT);
    expect(response.headers['set-cookie']?.[0]).toMatch(
      new RegExp(`^${ADMIN_SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`),
    );
  });

  it('answers a new access token while the session lasts', async () => {
    const session = { accessToken: 'token', expiresIn: 900, account: { id: 1 } };
    refresh.mockResolvedValue({ session });

    const response = await post('live');

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body).toEqual(session);
    expect(refresh).toHaveBeenCalledWith('live');
  });

  it('lets any other failure through', async () => {
    refresh.mockRejectedValue(new Error('database down'));

    const response = await post('live');

    expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
