import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Secret, TOTP } from 'otpauth';

import { withEnv } from '../../../test/env';
import { ADMIN, USER } from '../../auth/access/roles';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAccountService } from './admin-account.service';
import { AdminAccountRow, AdminSessionService } from './admin-session.service';
import { TwoFactorService } from './two-factor.service';

const SECRET = 'admin-account-spec-secret';

describe('AdminAccountService', () => {
  const twoFactor = new TwoFactorService();
  let rows: Map<number, AdminAccountRow>;
  let service: AdminAccountService;
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) => rows.get(where.id)),
      findMany: jest.fn(),
      count: jest.fn(
        async () => [...rows.values()].filter((row) => row.role === ADMIN && !row.deletedAt).length,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: number }; data: Partial<AdminAccountRow> }) => {
          const next = { ...rows.get(where.id)!, ...data };
          rows.set(where.id, next);
          return next;
        },
      ),
    },
  };

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

  beforeEach(() => {
    withEnv({ JWT_SECRET: SECRET });
    rows = new Map([
      [1, row({})],
      [2, row({ id: 2, username: 'bob', email: 'bob@example.com', role: USER })],
    ]);
    const sessions = new AdminSessionService(
      {} as AuthService,
      new JwtService({ secret: SECRET }),
      prisma as unknown as PrismaService,
      twoFactor,
    );
    service = new AdminAccountService(prisma as unknown as PrismaService, sessions, twoFactor);
  });

  describe('roles', () => {
    it('promotes an account to admin, and demotes it back', async () => {
      await expect(service.setRole(1, 2, ADMIN)).resolves.toMatchObject({ id: 2, role: ADMIN });
      await expect(service.setRole(1, 2, USER)).resolves.toMatchObject({ id: 2, role: USER });
    });

    it('never changes your own role', async () => {
      await expect(service.setRole(1, 1, USER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the last admin one', async () => {
      rows.set(3, row({ id: 3, role: USER }));
      rows.set(1, row({ deletedAt: new Date() }));
      rows.set(4, row({ id: 4 }));

      await expect(service.setRole(3, 4, USER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('two-factor sign-in', () => {
    it('turns on with a first code from the enrolled secret, and answers a verified session', async () => {
      const setup = await service.startTwoFactor(1);
      const code = new TOTP({ secret: Secret.fromBase32(setup.secret) }).generate();

      const { session } = await service.confirmTwoFactor(1, setup.setupToken, code);

      expect(session.account?.twoFactorEnabled).toBe(true);
      expect(rows.get(1)?.twoFactorSecret).not.toContain(setup.secret);
      expect(rows.get(1)?.twoFactorEnabledAt).toBeInstanceOf(Date);
    });

    it('refuses a wrong first code and leaves it off', async () => {
      const setup = await service.startTwoFactor(1);

      await expect(service.confirmTwoFactor(1, setup.setupToken, '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(rows.get(1)?.twoFactorSecret).toBeNull();
    });

    it("refuses another account's setup", async () => {
      const setup = await service.startTwoFactor(1);

      await expect(service.confirmTwoFactor(2, setup.setupToken, '000000')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('turns off only with a current code', async () => {
      const setup = await service.startTwoFactor(1);
      const totp = new TOTP({ secret: Secret.fromBase32(setup.secret) });
      await service.confirmTwoFactor(1, setup.setupToken, totp.generate());

      await expect(service.disableTwoFactor(1, '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.disableTwoFactor(1, totp.generate())).resolves.toMatchObject({
        twoFactorEnabled: false,
      });
    });

    it("lets one admin reset another's, but not their own", async () => {
      rows.set(2, row({ id: 2, twoFactorSecret: 'sealed', twoFactorEnabledAt: new Date() }));

      await expect(service.resetTwoFactor(1, 2)).resolves.toMatchObject({
        twoFactorEnabled: false,
      });
      await expect(service.resetTwoFactor(1, 1)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
