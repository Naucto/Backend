import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModerationActionType, ModerationTargetType } from '@prisma/client';

import { ADMIN, readsAddresses, RoleName, STAFF_ROLE_NAMES } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationLogService } from '../moderation/moderation-log.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly log: ModerationLogService,
  ) {}

  async me(userId: number): Promise<AccountSummaryDto> {
    return toAccountSummary(await this.liveAccount(userId));
  }

  async admins(reader: RoleName): Promise<AdminAccountListDto> {
    const rows = await this.prisma.user.findMany({
      where: { role: ADMIN, deletedAt: null },
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((row) => toAccountSummary(row, readsAddresses(reader))) };
  }

  /** Everyone who signs in to the console, whatever their role there. */
  async staff(reader: RoleName): Promise<AdminAccountListDto> {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: [...STAFF_ROLE_NAMES] }, deletedAt: null },
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((row) => toAccountSummary(row, readsAddresses(reader))) };
  }

  async search(query: string, reader: RoleName): Promise<AccountSearchResultDto> {
    const term = query.trim();
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { nickname: { contains: term, mode: 'insensitive' } },
          // An address is searched only by who may read it back, or a match would give it away.
          ...(readsAddresses(reader)
            ? [{ email: { contains: term, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      select: ADMIN_ACCOUNT_SELECT,
      orderBy: { username: 'asc' },
      take: SEARCH_LIMIT,
    });
    return { items: rows.map((row) => toAccountSummary(row, readsAddresses(reader))) };
  }

  /**
   * An admin cannot change their own role, so nobody locks themselves out by mistake, and the
   * last admin always stays one. A change is written to the moderation log with the role it left
   * and the role it took.
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
    if (target.role === role) {
      return toAccountSummary(target);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: targetId },
        data: { role },
        select: ADMIN_ACCOUNT_SELECT,
      });
      await this.log.record(tx, {
        action: ModerationActionType.ROLE_CHANGED,
        actorId,
        targetType: ModerationTargetType.USER,
        targetId,
        subjectUserId: targetId,
        internalNote: `From ${target.role} to ${role}`,
      });
      return row;
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
