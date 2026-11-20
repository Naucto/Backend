import {
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { withEnv } from '../../../test/env';
import { UserService } from '../../routes/user/user.service';
import { STAFF_SCOPE } from '../auth.types';
import { JwtStrategy } from '../strategies/jwt.strategy';
import {
  AllowedWhileSuspended,
  Public,
  RequiresAuth,
  RequiresRole,
  RequiresStaffSession,
  STAFF_SESSION_REQUIRED,
} from './access.decorators';
import { AccessGuard } from './access.guard';
import { ADMIN, MODERATOR, RoleName, USER } from './roles';
import { ACCOUNT_SUSPENDED } from './suspension';

const SECRET = 'access-guard-spec-secret';

const PLAIN_USER = 1;
const MODERATOR_USER = 2;
const ADMIN_USER = 3;
const DELETED_USER = 4;
const SUSPENDED_USER = 5;
const SUSPENDED_MODERATOR = 6;
const LAPSED_USER = 7;

const ROLES: Record<number, RoleName> = {
  [PLAIN_USER]: USER,
  [MODERATOR_USER]: MODERATOR,
  [ADMIN_USER]: ADMIN,
  [DELETED_USER]: ADMIN,
  [SUSPENDED_USER]: USER,
  [SUSPENDED_MODERATOR]: MODERATOR,
  [LAPSED_USER]: USER,
};

const SUSPENDED_UNTIL = new Date('2999-01-01T00:00:00.000Z');
const SUSPENSIONS: Record<number, { suspendedAt: Date; suspendedUntil: Date | null }> = {
  [SUSPENDED_USER]: { suspendedAt: new Date('2026-01-01'), suspendedUntil: SUSPENDED_UNTIL },
  [SUSPENDED_MODERATOR]: { suspendedAt: new Date('2026-01-01'), suspendedUntil: null },
  [LAPSED_USER]: { suspendedAt: new Date('2020-01-01'), suspendedUntil: new Date('2020-01-02') },
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

  @Post('write')
  write(): void {}

  @AllowedWhileSuspended()
  @Post('leave')
  leave(): void {}

  @Public()
  @Post('public-write')
  publicWrite(): void {}

  @RequiresStaffSession(MODERATOR)
  @Get('staff')
  staff(): void {}

  @RequiresStaffSession(ADMIN)
  @Get('staff-admin')
  staffAdmin(): void {}
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
      return {
        id,
        password: 'hash',
        deletedAt: id === DELETED_USER ? new Date() : null,
        suspendedAt: null,
        suspendedUntil: null,
        ...SUSPENSIONS[id],
      };
    }),
    getUserRole: jest.fn(async (id: number) => ROLES[id] ?? USER),
  };
  const tokenFor = (userId: number): string =>
    `Bearer ${new JwtService({ secret: SECRET }).sign({ sub: userId, email: 'someone@example.com' })}`;
  const staffTokenFor = (userId: number): string =>
    `Bearer ${new JwtService({ secret: SECRET }).sign({ sub: userId, email: 'someone@example.com', scope: STAFF_SCOPE })}`;

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
      expect(userService.getUserRole).not.toHaveBeenCalled();
    });
  });

  describe('a route requiring a staff session', () => {
    it('refuses the token of a site sign-in whatever its role, and names the refusal', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/staff')
        .set('Authorization', tokenFor(ADMIN_USER));

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body).toMatchObject({ code: STAFF_SESSION_REQUIRED });
      expect(userService.getUserRole).not.toHaveBeenCalled();
    });

    it.each([
      ['a moderator', '/probe/staff', MODERATOR_USER, HttpStatus.OK],
      ['an admin, who outranks it', '/probe/staff', ADMIN_USER, HttpStatus.OK],
      ['an account that lost its role', '/probe/staff', PLAIN_USER, HttpStatus.FORBIDDEN],
      ['an admin', '/probe/staff-admin', ADMIN_USER, HttpStatus.OK],
      [
        'a moderator, who ranks below it',
        '/probe/staff-admin',
        MODERATOR_USER,
        HttpStatus.FORBIDDEN,
      ],
    ])('answers the staff token of %s on %s with %s', async (_caller, path, userId, status) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', staffTokenFor(userId));

      expect(response.status).toBe(status);
    });

    it('refuses an anonymous caller', async () => {
      const response = await request(app.getHttpServer()).get('/probe/staff');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body).not.toHaveProperty('code');
    });

    it.each([
      ['asks for an account', '/probe/auth'],
      ['asks for a role its account holds', '/probe/admin'],
    ])('never lets a staff token open a site route that %s', async (_case, path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', staffTokenFor(ADMIN_USER));

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(userService.getUserRole).not.toHaveBeenCalled();
    });

    it('identifies nobody on a public route from a staff token', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/public')
        .set('Authorization', staffTokenFor(ADMIN_USER));

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual({ user: null });
    });
  });

  describe('a suspended account', () => {
    it('still reads', async () => {
      const response = await request(app.getHttpServer())
        .get('/probe/auth')
        .set('Authorization', tokenFor(SUSPENDED_USER));

      expect(response.status).toBe(HttpStatus.OK);
    });

    it('is refused a write, and told until when', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe/write')
        .set('Authorization', tokenFor(SUSPENDED_USER));

      expect(response.status).toBe(HttpStatus.FORBIDDEN);
      expect(response.body).toMatchObject({
        code: ACCOUNT_SUSPENDED,
        until: SUSPENDED_UNTIL.toISOString(),
      });
    });

    it('keeps a write the route leaves open to it', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe/leave')
        .set('Authorization', tokenFor(SUSPENDED_USER));

      expect(response.status).toBe(HttpStatus.CREATED);
    });

    it('is not held back on a public write, which acts for nobody', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe/public-write')
        .set('Authorization', tokenFor(SUSPENDED_USER));

      expect(response.status).toBe(HttpStatus.CREATED);
    });

    it.each([
      ['the token of a site sign-in', '/probe/moderator', tokenFor],
      ['a staff token', '/probe/staff', staffTokenFor],
    ])('holds no staff power with %s, even to read', async (_case, path, token) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', token(SUSPENDED_MODERATOR));

      expect(response.status).toBe(HttpStatus.FORBIDDEN);
      expect(response.body).toMatchObject({ code: ACCOUNT_SUSPENDED, until: null });
    });

    it('writes again once its suspension has run out, with nothing to clear', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe/write')
        .set('Authorization', tokenFor(LAPSED_USER));

      expect(response.status).toBe(HttpStatus.CREATED);
    });

    it('leaves an account in good standing alone', async () => {
      const response = await request(app.getHttpServer())
        .post('/probe/write')
        .set('Authorization', tokenFor(PLAIN_USER));

      expect(response.status).toBe(HttpStatus.CREATED);
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
