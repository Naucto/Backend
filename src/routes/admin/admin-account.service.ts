import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ADMIN, RoleName } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_ACCOUNT_SELECT, AdminAccountRow, toAccountSummary } from './admin-session.service';
import {
  AccountSearchResultDto,
  AccountSummaryDto,
  AdminAccountListDto,
} from './dto/admin-account.dto';

const SEARCH_LIMIT = 8;

/** Who administers Naucto. */
@Injectable()
export class AdminAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: number): Promise<AccountSummaryDto> {
    return toAccountSummary(await this.liveAccount(userId));
  }

  async admins(): Promise<AdminAccountListDto> {
    const rows = await this.prisma.user.findMany({
      where: { role: ADMIN, deletedAt: null },
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map(toAccountSummary) };
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
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { username: 'asc' },
      take: SEARCH_LIMIT,
    });
    return { items: rows.map(toAccountSummary) };
  }

  /**
   * An admin cannot change their own role, so nobody locks themselves out by mistake, and the
   * last admin always stays one.
   */
  async setRole(actorId: number, targetId: number, role: RoleName): Promise<AccountSummaryDto> {
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
    return toAccountSummary(updated);
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
