import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ADMIN, holdsRole, parseRole } from '../../auth/access/roles';
import { AuthService } from '../../auth/auth.service';
import { JwtPayload } from '../../auth/auth.types';
import { getEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { AttemptLimiter } from './attempt-limiter';
import { AdminAccountDto } from './dto/admin-account.dto';
import { AdminSessionDto } from './dto/admin-auth.dto';
import { TwoFactorService } from './two-factor.service';

export const ADMIN_ACCESS_LIFETIME_S = 15 * 60;
export const ADMIN_SESSION_LIFETIME_S = 8 * 60 * 60;
const CHALLENGE_LIFETIME_S = 5 * 60;
const SETUP_LIFETIME_S = 10 * 60;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Each kind of admin token is signed with a key of its own, so none of them verifies as another:
 * a challenge or a session cookie can never be presented as a bearer token.
 */
type Purpose = 'challenge' | 'setup' | 'session';

interface PurposeClaims {
  challenge: { sub: number };
  setup: { sub: number; secret: string };
  session: { sub: number; mfa: boolean };
}

export const ADMIN_ACCOUNT_SELECT = {
  id: true,
  username: true,
  nickname: true,
  email: true,
  role: true,
  createdAt: true,
  deletedAt: true,
  twoFactorSecret: true,
  twoFactorEnabledAt: true,
} as const;

export interface AdminAccountRow {
  id: number;
  username: string;
  nickname: string | null;
  email: string;
  role: string;
  createdAt: Date;
  deletedAt: Date | null;
  twoFactorSecret: string | null;
  twoFactorEnabledAt: Date | null;
}

export function toAdminAccount(row: AdminAccountRow): AdminAccountDto {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    role: parseRole(row.role),
    createdAt: row.createdAt,
    twoFactorEnabled: row.twoFactorSecret !== null,
    twoFactorEnabledAt: row.twoFactorEnabledAt,
  };
}

export interface IssuedSession {
  session: AdminSessionDto;
  /** Goes into the httpOnly session cookie; absent while the code step is pending. */
  sessionToken?: string;
}

/** Signing in to the admin panel: a password, an admin role, and the second factor when enabled. */
@Injectable()
export class AdminSessionService {
  private readonly passwordAttempts = new AttemptLimiter(10, WINDOW_MS);
  private readonly codeAttempts = new AttemptLimiter(5, WINDOW_MS);

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly twoFactor: TwoFactorService,
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

    const account = await this.adminAccount(userId, ForbiddenException);
    if (account.twoFactorSecret) {
      return {
        session: {
          status: 'two_factor_required',
          challengeToken: await this.sign('challenge', { sub: account.id }, CHALLENGE_LIFETIME_S),
        },
      };
    }
    return this.issue(account, false);
  }

  async completeTwoFactor(challengeToken: string, code: string): Promise<IssuedSession> {
    const { sub } = await this.verify('challenge', challengeToken);
    const account = await this.adminAccount(sub, UnauthorizedException);
    if (!account.twoFactorSecret) {
      throw new UnauthorizedException('Two-factor sign-in is not enabled for this account');
    }
    this.checkCode(account.id, account.twoFactorSecret, code);
    return this.issue(account, true);
  }

  async refresh(sessionToken: string): Promise<IssuedSession> {
    const { sub, mfa } = await this.verify('session', sessionToken);
    const account = await this.adminAccount(sub, UnauthorizedException);
    if (account.twoFactorSecret && !mfa) {
      throw new UnauthorizedException('Sign in again with your authenticator code');
    }
    const issued = await this.issue(account, mfa);
    // The session ends when it was always going to: renewing the access token does not extend it.
    return { session: issued.session };
  }

  /** Verifies a code against a sealed secret, counting failures against the account. */
  checkCode(userId: number, sealedSecret: string, code: string): void {
    const key = `account:${userId}`;
    this.codeAttempts.assertAllowed(key);
    if (!this.twoFactor.verify(this.twoFactor.openSecret(sealedSecret), code)) {
      this.codeAttempts.fail(key);
      throw new UnauthorizedException('That code is not valid. Check the time on your device.');
    }
    this.codeAttempts.clear(key);
  }

  async issue(account: AdminAccountRow, mfa: boolean): Promise<IssuedSession> {
    const payload: JwtPayload = { sub: account.id, email: account.email, mfa };
    return {
      session: {
        status: 'authenticated',
        accessToken: await this.jwt.signAsync(payload, { expiresIn: ADMIN_ACCESS_LIFETIME_S }),
        expiresIn: ADMIN_ACCESS_LIFETIME_S,
        account: toAdminAccount(account),
      },
      sessionToken: await this.sign('session', { sub: account.id, mfa }, ADMIN_SESSION_LIFETIME_S),
    };
  }

  signSetup(userId: number, secret: string): Promise<string> {
    return this.sign('setup', { sub: userId, secret }, SETUP_LIFETIME_S);
  }

  verifySetup(token: string): Promise<PurposeClaims['setup']> {
    return this.verify('setup', token);
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

  private secretFor(purpose: Purpose): string {
    return `${getEnv('JWT_SECRET')}:admin-${purpose}`;
  }

  private sign<P extends Purpose>(
    purpose: P,
    claims: PurposeClaims[P],
    lifetimeSeconds: number,
  ): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.secretFor(purpose),
      expiresIn: lifetimeSeconds,
    });
  }

  private async verify<P extends Purpose>(purpose: P, token: string): Promise<PurposeClaims[P]> {
    try {
      return await this.jwt.verifyAsync<PurposeClaims[P]>(token, {
        secret: this.secretFor(purpose),
      });
    } catch {
      throw new UnauthorizedException(
        purpose === 'session' ? 'Session expired' : 'This step expired, start again',
      );
    }
  }
}
