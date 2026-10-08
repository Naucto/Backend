import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Secret, TOTP } from 'otpauth';

import { withEnv } from '../../../test/env';
import { ADMIN, USER } from '../../auth/access/roles';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAccountRow, AdminSessionService } from './admin-session.service';
import { TwoFactorService } from './two-factor.service';

const SECRET = 'admin-session-spec-secret';

describe('AdminSessionService', () => {
  const twoFactor = new TwoFactorService();
  const jwt = new JwtService({ secret: SECRET });
  let rows: Map<number, AdminAccountRow>;
  let base32: string;
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
    twoFactorSecret: null,
    twoFactorEnabledAt: null,
    ...overrides,
  });
  const currentCode = (): string => new TOTP({ secret: Secret.fromBase32(base32) }).generate();

  beforeEach(() => {
    withEnv({ JWT_SECRET: SECRET });
    base32 = twoFactor.enrol('ada@example.com').secret;
    rows = new Map([
      [1, row({})],
      [2, row({ id: 2, email: 'bob@example.com', role: USER })],
      [3, row({ id: 3, email: 'cy@example.com', twoFactorSecret: twoFactor.sealSecret(base32) })],
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
      twoFactor,
    );
  });

  it('signs an admin without a second factor straight in, unverified', async () => {
    const { session, sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');

    expect(session.status).toBe('authenticated');
    expect(session.account?.twoFactorEnabled).toBe(false);
    expect(jwt.verify<{ sub: number; mfa: boolean }>(session.accessToken!)).toMatchObject({
      sub: 1,
      mfa: false,
    });
    expect(sessionToken).toBeDefined();
  });

  it('refuses an account that is not an admin', async () => {
    await expect(service.login('bob@example.com', 'pw', '1.1.1.1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('asks for the code, then signs in verified with it', async () => {
    const first = await service.login('cy@example.com', 'pw', '1.1.1.1');

    expect(first.session).toEqual({
      status: 'two_factor_required',
      challengeToken: expect.any(String),
    });
    expect(first.sessionToken).toBeUndefined();

    const { session } = await service.completeTwoFactor(
      first.session.challengeToken!,
      currentCode(),
    );
    expect(jwt.verify<{ mfa: boolean }>(session.accessToken!).mfa).toBe(true);
  });

  it('never lets a challenge stand in for an access token', async () => {
    const { session } = await service.login('cy@example.com', 'pw', '1.1.1.1');

    expect(() => jwt.verify(session.challengeToken!)).toThrow();
  });

  it('locks the code step after five wrong codes', async () => {
    const { session } = await service.login('cy@example.com', 'pw', '1.1.1.1');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.completeTwoFactor(session.challengeToken!, '000000'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    await expect(
      service.completeTwoFactor(session.challengeToken!, currentCode()),
    ).rejects.toBeInstanceOf(HttpException);
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

  it('renews the access token from the session, keeping whether it was verified', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');

    const { session } = await service.refresh(sessionToken!);

    expect(jwt.verify<{ mfa: boolean }>(session.accessToken!).mfa).toBe(false);
  });

  it('ends an unverified session once the account turns its second factor on', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');
    rows.set(1, row({ twoFactorSecret: twoFactor.sealSecret(base32) }));

    await expect(service.refresh(sessionToken!)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ends the session of an account that lost the admin role', async () => {
    const { sessionToken } = await service.login('ada@example.com', 'pw', '1.1.1.1');
    rows.set(1, row({ role: USER }));

    await expect(service.refresh(sessionToken!)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
