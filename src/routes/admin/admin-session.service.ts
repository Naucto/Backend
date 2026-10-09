import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ADMIN, holdsRole, parseRole } from '../../auth/access/roles';
import { AuthService } from '../../auth/auth.service';
import { JwtPayload } from '../../auth/auth.types';
import { getEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptLimiter } from './attempt-limiter';
import { AccountSummaryDto } from './dto/admin-account.dto';
import { AdminSessionDto } from './dto/admin-auth.dto';

export const ADMIN_ACCESS_LIFETIME_S = 15 * 60;
export const ADMIN_SESSION_LIFETIME_S = 8 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;

export const ADMIN_ACCOUNT_SELECT = {
  id: true,
  username: true,
  nickname: true,
  email: true,
  role: true,
  createdAt: true,
  deletedAt: true,
} as const;

export interface AdminAccountRow {
  id: number;
  username: string;
  nickname: string | null;
  email: string;
  role: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export function toAccountSummary(row: AdminAccountRow): AccountSummaryDto {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    role: parseRole(row.role),
    createdAt: row.createdAt,
  };
}

export interface IssuedSession {
  session: AdminSessionDto;
  /** Goes into the httpOnly session cookie. */
  sessionToken?: string;
}

/** Signing in to the admin console: a password, and an account holding the admin role. */
@Injectable()
export class AdminSessionService {
  private readonly passwordAttempts = new AttemptLimiter(10, WINDOW_MS);

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(email: string, password: string, ip: string): Promise<IssuedSession> {
    const key = `ip:${ip}`;
    this.passwordAttempts.assertAllowed(key);
    let userId: number;
    try {
      userId = (await this.auth.validateUser(email, password)).id;
    } catch (error) {
      this.passwordAttempts.fail(key);
      throw error;
    }
    return this.issue(await this.adminAccount(userId, ForbiddenException));
  }

  async refresh(sessionToken: string): Promise<IssuedSession> {
    let sub: number;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: number }>(sessionToken, {
        secret: this.sessionSecret(),
      }));
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    const issued = await this.issue(await this.adminAccount(sub, UnauthorizedException));
    // The session ends when it was always going to: renewing the access token does not extend it.
    return { session: issued.session };
  }

  private async issue(account: AdminAccountRow): Promise<IssuedSession> {
    const payload: JwtPayload = { sub: account.id, email: account.email };
    return {
      session: {
        accessToken: await this.jwt.signAsync(payload, { expiresIn: ADMIN_ACCESS_LIFETIME_S }),
        expiresIn: ADMIN_ACCESS_LIFETIME_S,
        account: toAccountSummary(account),
      },
      sessionToken: await this.jwt.signAsync(
        { sub: account.id },
        { secret: this.sessionSecret(), expiresIn: ADMIN_SESSION_LIFETIME_S },
      ),
    };
  }

  /** A live account holding the admin role, or `refusal` for anything else. */
  private async adminAccount(
    userId: number,
    refusal: typeof ForbiddenException | typeof UnauthorizedException,
  ): Promise<AdminAccountRow> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ADMIN_ACCOUNT_SELECT,
    });
    if (!account || account.deletedAt) {
      throw new UnauthorizedException('Account not found');
    }
    if (!holdsRole(parseRole(account.role), ADMIN)) {
      throw new refusal('This account is not an admin');
    }
    return account;
  }

  /** A key of its own, so a session cookie never verifies as a bearer token. */
  private sessionSecret(): string {
    return `${getEnv('JWT_SECRET')}:admin-session`;
  }
}
