import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { withEnv } from '../../../test/env';
import { UserService } from '../../routes/user/user.service';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { Public, RequiresAuth, RequiresRole } from './access.decorators';
import { AccessGuard } from './access.guard';
import { ADMIN, MODERATOR, RoleName, USER } from './roles';

const SECRET = 'access-guard-spec-secret';

const PLAIN_USER = 1;
const MODERATOR_USER = 2;
const ADMIN_USER = 3;
const DELETED_USER = 4;
const TWO_FACTOR_ADMIN = 5;

const ROLES: Record<number, RoleName> = {
  [PLAIN_USER]: USER,
  [MODERATOR_USER]: MODERATOR,
  [ADMIN_USER]: ADMIN,
  [DELETED_USER]: ADMIN,
  [TWO_FACTOR_ADMIN]: ADMIN,
};

type Caller = { user: { id: number } | null };

@Controller('probe')
@RequiresAuth()
class ProbeController {
  @Public()
  @Get('public')
  open(@Req() req: { user?: { id: number } | null }): Caller {
    return { user: req.user ? { id: req.user.id } : null };
  }

  @Get('auth')
  signedIn(@Req() req: { user: { id: number } }): Caller {
    return { user: { id: req.user.id } };
  }

  @RequiresRole(MODERATOR)
  @Get('moderator')
  moderator(): void {}

  @RequiresRole(ADMIN)
  @Get('admin')
  admin(): void {}
}

@Controller('bare')
class BareController {
  @Get()
  unannotated(): void {}
}

describe('AccessGuard', () => {
  let app: INestApplication;
  const userService = {
    findOne: jest.fn(async (id: number) => {
      if (ROLES[id] === undefined) {
        throw new NotFoundException();
      }
      return { id, password: 'hash', deletedAt: id === DELETED_USER ? new Date() : null };
    }),
    getAccessFacts: jest.fn(async (id: number) => ({
      role: ROLES[id] ?? USER,
      twoFactorEnabled: id === TWO_FACTOR_ADMIN,
    })),
  };
  const tokenFor = (userId: number, mfa?: boolean): string =>
    `Bearer ${new JwtService({ secret: SECRET }).sign({ sub: userId, email: 'someone@example.com', mfa })}`;

  beforeEach(async () => {
    jest.clearAllMocks();
    withEnv({ JWT_SECRET: SECRET });
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController, BareController],
      providers: [
        JwtStrategy,
        { provide: UserService, useValue: userService },
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('a public route', () => {
    it('lets an anonymous caller through, with no user', async () => {
      const response = await request(app.getHttpServer()).get('/probe/public');

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual({ user: null });
    });

    it('identifies a caller presenting a valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/public')
        .set('Authorization', tokenFor(PLAIN_USER));

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual({ user: { id: PLAIN_USER } });
    });

    it('lets a caller with a bad token through, with no user', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/public')
        .set('Authorization', 'Bearer not-a-token');

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual({ user: null });
    });
  });

  describe('a route requiring authentication', () => {
    it('refuses an anonymous caller', async () => {
      const response = await request(app.getHttpServer()).get('/probe/auth');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('lets a signed-in user through', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/auth')
        .set('Authorization', tokenFor(PLAIN_USER));

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual({ user: { id: PLAIN_USER } });
    });

    it('refuses a still-valid token whose account was deleted', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/auth')
        .set('Authorization', tokenFor(DELETED_USER));

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('a route requiring a role', () => {
    it.each([
      ['a moderator', '/probe/moderator', MODERATOR_USER, HttpStatus.OK],
      ['an admin, who outranks it', '/probe/moderator', ADMIN_USER, HttpStatus.OK],
      ['a plain user', '/probe/moderator', PLAIN_USER, HttpStatus.FORBIDDEN],
      ['an admin', '/probe/admin', ADMIN_USER, HttpStatus.OK],
      ['a moderator, who ranks below it', '/probe/admin', MODERATOR_USER, HttpStatus.FORBIDDEN],
    ])('answers %s on %s with %s', async (_caller, path, userId, status) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', tokenFor(userId));

      expect(response.status).toBe(status);
    });

    it('refuses an anonymous caller before looking any role up', async () => {
      const response = await request(app.getHttpServer()).get('/probe/moderator');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(userService.getAccessFacts).not.toHaveBeenCalled();
    });

    it.each([
      ['a token from the code step', true, HttpStatus.OK],
      ['a token from the site sign-in', undefined, HttpStatus.FORBIDDEN],
    ])(
      'admits an admin with a second factor on an admin route only with %s',
      async (_token, mfa, status) => {
        const response = await request(app.getHttpServer())
          .get('/probe/admin')
          .set('Authorization', tokenFor(TWO_FACTOR_ADMIN, mfa));

        expect(response.status).toBe(status);
      },
    );

    it('does not ask an admin with a second factor for it on a moderator route', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/moderator')
        .set('Authorization', tokenFor(TWO_FACTOR_ADMIN));

      expect(response.status).toBe(HttpStatus.OK);
    });
  });

  describe('a route declaring nothing', () => {
    it.each([
      ['an anonymous caller', undefined, HttpStatus.UNAUTHORIZED],
      ['a moderator', MODERATOR_USER, HttpStatus.FORBIDDEN],
      ['an admin', ADMIN_USER, HttpStatus.OK],
    ])('is admin-only: %s gets %s', async (_caller, userId, status) => {
      const pending = request(app.getHttpServer()).get('/bare');
      const response = await (userId === undefined
        ? pending
        : pending.set('Authorization', tokenFor(userId)));

      expect(response.status).toBe(status);
    });
  });
});
