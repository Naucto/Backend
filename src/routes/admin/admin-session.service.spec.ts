import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { withEnv } from '../../../test/env';
import { ADMIN, USER } from '../../auth/access/roles';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAccountRow, AdminSessionService } from './admin-session.service';

const SECRET = 'admin-session-spec-secret';

describe('AdminSessionService', () => {
  const jwt = new JwtService({ secret: SECRET });
  let rows: Map<number, AdminAccountRow>;
  const auth = { validateUser: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn(({ where }: { where: { id: number } }) => rows.get(where.id)) },
  };
  let service: AdminSessionService;

  const row = (overrides: Partial<AdminAccountRow>): AdminAccountRow => ({
    id: 1,
    username: 'ada',
    nickname: null,
    email: 'ada@example.com',
    role: ADMIN,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    withEnv({ JWT_SECRET: SECRET });
    rows = new Map([
      [1, row({})],
      [2, row({ id: 2, email: 'bob@example.com', role: USER })],
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

  it('refuses an account that is not an admin', async () => {
    await expect(service.login('bob@example.com', 'pw', '1.1.1.1')).rejects.toBeInstanceOf(
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

  it('ends the session of an account that lost the admin role', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');
    rows.set(1, row({ role: USER }));

    await expect(service.refresh(sessionToken!)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a session that is not one', async () => {
    await expect(service.refresh('not-a-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
