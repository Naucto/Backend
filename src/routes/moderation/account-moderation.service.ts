import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationTargetType, Prisma } from '@prisma/client';

import { outranks, parseRole } from '../../auth/access/roles';
import { CodedException } from '../../common/coded.exception';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import {
  ClearProfileDto,
  ModerationNoteDto,
  StaffDeleteAccountDto,
  SuspendAccountDto,
  WarnAccountDto,
} from './dto/moderation-decision.dto';
import { resolveOpenFlags } from './flag-resolution';
import { MODERATION_ERROR, notAvailableYet } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';
import { ACCOUNT_REF_SELECT, toActionDto } from './moderation-mappers';
import { StaffActor } from './staff-actor';

const SUBJECT_SELECT = { ...ACCOUNT_REF_SELECT, description: true } as const;

type SubjectRow = Prisma.UserGetPayload<{ select: typeof SUBJECT_SELECT }>;

/** What staff decide about an account. */
@Injectable()
export class AccountModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly log: ModerationLogService,
    private readonly notifications: NotificationsService,
  ) {}

  async warn(
    staff: StaffActor,
    accountId: number,
    input: WarnAccountDto,
  ): Promise<ModerationActionDto> {
    const account = await this.subject(staff, accountId);

    const row = await this.prisma.$transaction(async (tx) => {
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.ACCOUNT_WARNED,
        actorId: staff.id,
        targetType: ModerationTargetType.USER,
        targetId: account.id,
        subjectUserId: account.id,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        snapshot: { title: account.nickname ?? account.username, body: account.description },
      });
      if (input.resolveFlags !== false) {
        await resolveOpenFlags(tx, {
          targetType: ModerationTargetType.USER,
          targetId: account.id,
          status: FlagStatus.ACTIONED,
          resolvedById: staff.id,
          resolutionId: recorded.id,
        });
      }
      return recorded;
    });

    await this.notifications.notifyBestEffort({
      userId: account.id,
      title: 'You received a warning',
      message: input.publicMessage,
      type: 'WARNING',
      kind: 'MODERATION',
      data: { actionId: row.id, action: row.action },
    });

    return toActionDto(row, staff);
  }

  suspend(
    _staff: StaffActor,
    _accountId: number,
    _input: SuspendAccountDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  reinstate(
    _staff: StaffActor,
    _accountId: number,
    _input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  clearProfile(
    _staff: StaffActor,
    _accountId: number,
    _input: ClearProfileDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  remove(
    _staff: StaffActor,
    _accountId: number,
    _input: StaffDeleteAccountDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  /** The account a decision bears on, once the caller is known to be allowed to decide about it. */
  private async subject(staff: StaffActor, accountId: number): Promise<SubjectRow> {
    if (staff.id === accountId) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        MODERATION_ERROR.CANNOT_MODERATE_SELF,
        'You cannot moderate your own account',
      );
    }
    const account = await this.prisma.user.findUnique({
      where: { id: accountId },
      select: SUBJECT_SELECT,
    });
    if (!account || account.deletedAt) {
      throw new NotFoundException('Account not found');
    }
    if (!outranks(staff.role, parseRole(account.role))) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        MODERATION_ERROR.TARGET_OUTRANKS_ACTOR,
        'This account holds a role that is not ranked below yours',
      );
    }
    return account;
  }
}
