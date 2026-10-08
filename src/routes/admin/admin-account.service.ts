import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ADMIN, parseRole, RoleName } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_ACCOUNT_SELECT,
  AdminAccountRow,
  AdminSessionService,
  IssuedSession,
  toAdminAccount,
} from './admin-session.service';
import {
  AccountSearchResultDto,
  AdminAccountDto,
  AdminAccountListDto,
  AdminMeDto,
  TwoFactorSetupDto,
} from './dto/admin-account.dto';
import { TwoFactorService } from './two-factor.service';

const SEARCH_LIMIT = 8;

/** Who administers Naucto, and each admin's own second factor. */
@Injectable()
export class AdminAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async me(userId: number, sessionVerified: boolean): Promise<AdminMeDto> {
    return { ...toAdminAccount(await this.liveAccount(userId)), sessionVerified };
  }

  async admins(): Promise<AdminAccountListDto> {
    const rows = await this.prisma.user.findMany({
      where: { role: ADMIN, deletedAt: null },
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map(toAdminAccount) };
  }

  async search(query: string): Promise<AccountSearchResultDto> {
    const term = query.trim();
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { nickname: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        nickname: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { username: 'asc' },
      take: SEARCH_LIMIT,
    });
    return { items: rows.map((row) => ({ ...row, role: parseRole(row.role) })) };
  }

  /**
   * An admin cannot change their own role, so nobody locks themselves out by mistake, and the
   * last admin always stays one.
   */
  async setRole(actorId: number, targetId: number, role: RoleName): Promise<AdminAccountDto> {
    if (actorId === targetId) {
      throw new BadRequestException('You cannot change your own role');
    }
    const target = await this.liveAccount(targetId);
    if (target.role === ADMIN && role !== ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: ADMIN, deletedAt: null } });
      if (admins <= 1) {
        throw new ConflictException('Naucto needs at least one admin');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: ADMIN_ACCOUNT_SELECT,
    });
    return toAdminAccount(updated);
  }

  async startTwoFactor(userId: number): Promise<TwoFactorSetupDto> {
    const account = await this.liveAccount(userId);
    if (account.twoFactorSecret) {
      throw new ConflictException('Two-factor sign-in is already on');
    }
    const { secret, otpauthUri } = this.twoFactor.enrol(account.email);
    return { secret, otpauthUri, setupToken: await this.sessions.signSetup(userId, secret) };
  }

  /** Turns the second factor on, and hands back a session that has passed it. */
  async confirmTwoFactor(userId: number, setupToken: string, code: string): Promise<IssuedSession> {
    const setup = await this.sessions.verifySetup(setupToken);
    if (setup.sub !== userId) {
      throw new ForbiddenException('This setup belongs to another account');
    }
    const sealed = this.twoFactor.sealSecret(setup.secret);
    this.sessions.checkCode(userId, sealed, code);
    const account = await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: sealed, twoFactorEnabledAt: new Date() },
      select: ADMIN_ACCOUNT_SELECT,
    });
    return this.sessions.issue(account, true);
  }

  async disableTwoFactor(userId: number, code: string): Promise<AdminMeDto> {
    const account = await this.liveAccount(userId);
    if (!account.twoFactorSecret) {
      throw new ConflictException('Two-factor sign-in is already off');
    }
    this.sessions.checkCode(userId, account.twoFactorSecret, code);
    return { ...toAdminAccount(await this.clearTwoFactor(userId)), sessionVerified: false };
  }

  /** For an admin who lost their authenticator: another admin turns it off for them. */
  async resetTwoFactor(actorId: number, targetId: number): Promise<AdminAccountDto> {
    if (actorId === targetId) {
      throw new BadRequestException('Turn off your own two-factor sign-in from your settings');
    }
    await this.liveAccount(targetId);
    return toAdminAccount(await this.clearTwoFactor(targetId));
  }

  private clearTwoFactor(userId: number): Promise<AdminAccountRow> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: null, twoFactorEnabledAt: null },
      select: ADMIN_ACCOUNT_SELECT,
    });
  }

  private async liveAccount(userId: number): Promise<AdminAccountRow> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ADMIN_ACCOUNT_SELECT,
    });
    if (!account || account.deletedAt) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }
}
