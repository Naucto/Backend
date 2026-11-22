import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { withEnv } from '../../../test/env';
import { ADMIN, MODERATOR, USER, VIEWER } from '../../auth/access/roles';
import { SuspensionState } from '../../auth/access/suspension';
import { AuthService } from '../../auth/auth.service';
import { JwtPayload, STAFF_SCOPE } from '../../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAccountRow, AdminSessionService } from './admin-session.service';

const SECRET = 'admin-session-spec-secret';

type StaffRow = AdminAccountRow & SuspensionState;

describe('AdminSessionService', () => {
  const jwt = new JwtService({ secret: SECRET });
  let rows: Map<number, StaffRow>;
  const auth = { validateUser: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn(({ where }: { where: { id: number } }) => rows.get(where.id)) },
  };
  let service: AdminSessionService;

  const row = (overrides: Partial<StaffRow>): StaffRow => ({
    id: 1,
    username: 'ada',
    nickname: null,
    email: 'ada@example.com',
    role: ADMIN,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
    suspendedAt: null,
    suspendedUntil: null,
    ...overrides,
  });

  beforeEach(() => {
    withEnv({ JWT_SECRET: SECRET });
    rows = new Map([
      [1, row({})],
      [2, row({ id: 2, email: 'bob@example.com', role: USER })],
      [3, row({ id: 3, email: 'mia@example.com', role: MODERATOR })],
    ]);
    auth.validateUser.mockImplementation(async (email: string) => {
      const found = [...rows.values()].find((account) => account.email === email);
      if (!found) {
        throw new UnauthorizedException('Invalid email or password');
      }
      return found;
    });
    service = new AdminSessionService(
      auth as unknown as AuthService,
      jwt,
      prisma as unknown as PrismaService,
    );
  });

  it('signs an admin in with an access token and a session for the cookie', async () => {
    const { session, sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');

    expect(jwt.verify<{ sub: number }>(session.accessToken).sub).toBe(1);
    expect(session.account).toMatchObject({ id: 1, role: ADMIN });
    expect(sessionToken).toBeDefined();
  });

  it('signs a moderator in, and says which role the session holds', async () => {
    const { session } = await service.login('mia@example.com', 'pw', '1.1.1.1');

    expect(session.account).toMatchObject({ id: 3, role: MODERATOR });
  });

  it('signs a viewer in, to observe', async () => {
    rows.set(4, row({ id: 4, email: 'vic@example.com', role: VIEWER }));

    const { session } = await service.login('vic@example.com', 'pw', '1.1.1.1');

    expect(session.account).toMatchObject({ id: 4, role: VIEWER });
  });

  it('scopes every access token it issues to staff, at sign-in and at renewal', async () => {
    const { session, sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');
    const renewed = await service.refresh(sessionToken!);

    expect(jwt.verify<JwtPayload>(session.accessToken).scope).toBe(STAFF_SCOPE);
    expect(jwt.verify<JwtPayload>(renewed.session.accessToken).scope).toBe(STAFF_SCOPE);
  });

  it('refuses an account that holds no staff role', async () => {
    await expect(service.login('bob@example.com', 'pw', '1.1.1.1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a suspended staff member', async () => {
    rows.set(3, row({ id: 3, email: 'mia@example.com', role: MODERATOR, suspendedAt: new Date() }));

    await expect(service.login('mia@example.com', 'pw', '1.1.1.1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('never lets the session cookie stand in for an access token', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');

    expect(() => jwt.verify(sessionToken!)).toThrow();
  });

  it('locks password attempts from one address after ten failures', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(service.login('nobody@example.com', 'pw', '2.2.2.2')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    await expect(service.login('ada@example.com', 'pw', '2.2.2.2')).rejects.toThrow(
      'Too many failed attempts',
    );
    await expect(service.login('ada@example.com', 'pw', '3.3.3.3')).resolves.toBeDefined();
  });

  it('renews the access token from the session, without a new cookie', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');

    const renewed = await service.refresh(sessionToken!);

    expect(jwt.verify<{ sub: number }>(renewed.session.accessToken).sub).toBe(1);
    expect(renewed.sessionToken).toBeUndefined();
  });

  it('follows a role change at renewal: an admin made moderator keeps a moderator session', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');
    rows.set(1, row({ role: MODERATOR }));

    const renewed = await service.refresh(sessionToken!);

    expect(renewed.session.account.role).toBe(MODERATOR);
  });

  it.each([
    ['lost every staff role', { role: USER }],
    ['was suspended', { suspendedAt: new Date() }],
    ['was erased', { deletedAt: new Date() }],
  ])('ends the session of an account that %s', async (_case, change) => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');
    rows.set(1, row(change));

    await expect(service.refresh(sessionToken!)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a session that is not one', async () => {
    await expect(service.refresh('not-a-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
