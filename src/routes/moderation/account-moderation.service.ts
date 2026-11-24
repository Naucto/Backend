import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationTargetType, Prisma } from '@prisma/client';

import { outranks, parseRole } from '../../auth/access/roles';
import { currentSuspension } from '../../auth/access/suspension';
import { CodedException } from '../../common/coded.exception';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiplayerService } from '../multiplayer/multiplayer.service';
import { AccountDeletionService } from '../user/account-deletion.service';
import { ProfileAsset, ProfileAssetService } from '../user/profile-asset.service';
import { WorkSessionService } from '../work-session/work-session.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import {
  ClearProfileDto,
  ModerationNoteDto,
  ProfilePart,
  StaffDeleteAccountDto,
  SuspendAccountDto,
  WarnAccountDto,
} from './dto/moderation-decision.dto';
import { resolveOpenFlags } from './flag-resolution';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationLogService, RecordedAction } from './moderation-log.service';
import { ACCOUNT_REF_SELECT, ActionRow, toActionDto } from './moderation-mappers';
import { StaffActor } from './staff-actor';

const DAY_MS = 24 * 60 * 60 * 1000;

const PROFILE_IMAGES: readonly [ProfilePart, ProfileAsset][] = [
  ['PICTURE', 'profile'],
  ['BACKGROUND', 'background'],
];

const SUBJECT_SELECT = {
  ...ACCOUNT_REF_SELECT,
  description: true,
  suspendedAt: true,
  suspendedUntil: true,
} as const;

type SubjectRow = Prisma.UserGetPayload<{ select: typeof SUBJECT_SELECT }>;

type AccountDecision = Pick<
  RecordedAction,
  'action' | 'reason' | 'publicMessage' | 'internalNote' | 'expiresAt'
>;

/** What staff decide about an account. */
@Injectable()
export class AccountModerationService {
  private readonly logger = new Logger(AccountModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly log: ModerationLogService,
    private readonly notifications: NotificationsService,
    private readonly multiplayer: MultiplayerService,
    private readonly workSessions: WorkSessionService,
    private readonly deletion: AccountDeletionService,
    private readonly profileAssets: ProfileAssetService,
  ) {}

  async warn(
    staff: StaffActor,
    accountId: string,
    input: WarnAccountDto,
  ): Promise<ModerationActionDto> {
    const account = await this.subject(staff, accountId);

    const row = await this.prisma.$transaction(async (tx) => {
      const recorded = await this.record(tx, staff, account, {
        action: ModerationActionType.ACCOUNT_WARNED,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      return recorded;
    });

    await this.notify(row, 'You received a warning', input.publicMessage);
    return toActionDto(row, staff);
  }

  async suspend(
    staff: StaffActor,
    accountId: string,
    input: SuspendAccountDto,
  ): Promise<ModerationActionDto> {
    const account = await this.subject(staff, accountId);
    const since = new Date();
    const until =
      input.durationDays === undefined
        ? null
        : new Date(since.getTime() + input.durationDays * DAY_MS);

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: account.id },
        data: { suspendedAt: since, suspendedUntil: until },
      });
      const recorded = await this.record(tx, staff, account, {
        action: ModerationActionType.ACCOUNT_SUSPENDED,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
        expiresAt: until ?? undefined,
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      return recorded;
    });

    await this.endLiveSessions(account.id);
    await this.notify(row, 'Your account is suspended', input.publicMessage);
    return toActionDto(row, staff);
  }

  async reinstate(
    staff: StaffActor,
    accountId: string,
    input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    const account = await this.subject(staff, accountId);
    if (!currentSuspension(account)) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.NOT_SUSPENDED,
        'This account is not suspended',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: account.id },
        data: { suspendedAt: null, suspendedUntil: null },
      });
      return this.record(tx, staff, account, {
        action: ModerationActionType.ACCOUNT_REINSTATED,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
      });
    });

    await this.notify(
      row,
      'Your account is reinstated',
      input.publicMessage || 'Your suspension was lifted.',
    );
    return toActionDto(row, staff);
  }

  async clearProfile(
    staff: StaffActor,
    accountId: string,
    input: ClearProfileDto,
  ): Promise<ModerationActionDto> {
    const account = await this.subject(staff, accountId);
    const parts = new Set(input.parts);

    // The images first: a row saying the profile was cleared while a picture still stands would be
    // a false record, and removing a picture twice does no harm.
    for (const [part, asset] of PROFILE_IMAGES) {
      if (parts.has(part)) {
        await this.profileAssets.remove(account.id, asset);
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: account.id },
        data: {
          ...(parts.has('NICKNAME') ? { nickname: null } : {}),
          ...(parts.has('DESCRIPTION') ? { description: null } : {}),
        },
      });
      const recorded = await this.record(tx, staff, account, {
        action: ModerationActionType.PROFILE_CLEARED,
        reason: input.reason,
        publicMessage: input.publicMessage,
        internalNote: input.internalNote,
      });
      await this.settleFlags(tx, staff, recorded, input.resolveFlags);
      return recorded;
    });

    await this.notify(
      row,
      'Your profile was edited',
      input.publicMessage || 'A moderator removed part of your profile.',
    );
    return toActionDto(row, staff);
  }

  /** Erases the account as its owner could, with the record of who did and why. */
  async remove(
    staff: StaffActor,
    accountId: string,
    input: StaffDeleteAccountDto,
  ): Promise<ModerationActionDto> {
    const account = await this.subject(staff, accountId);

    let row: ActionRow | undefined;
    await this.deletion.deleteAccount(
      account.id,
      input.removePublishedGames,
      { by: 'admin' },
      async (tx) => {
        // No snapshot: the erasure this row records is the one that removes the profile for good.
        const recorded = await this.log.record(tx, {
          action: ModerationActionType.ACCOUNT_DELETED,
          actorId: staff.id,
          targetType: ModerationTargetType.USER,
          targetId: account.id,
          subjectUserId: account.id,
          reason: input.reason,
          internalNote: input.internalNote,
        });
        await this.settleFlags(tx, staff, recorded, input.resolveFlags);
        row = recorded;
      },
    );
    if (!row) {
      throw new InternalServerErrorException('The deletion was not recorded');
    }

    return toActionDto(row, staff);
  }

  /** The account a decision bears on, once the caller is known to be allowed to decide about it. */
  private async subject(staff: StaffActor, accountId: string): Promise<SubjectRow> {
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

  private record(
    tx: Prisma.TransactionClient,
    staff: StaffActor,
    account: SubjectRow,
    decision: AccountDecision,
  ): Promise<ActionRow> {
    return this.log.record(tx, {
      ...decision,
      actorId: staff.id,
      targetType: ModerationTargetType.USER,
      targetId: account.id,
      subjectUserId: account.id,
      snapshot: { title: account.nickname ?? account.username, body: account.description },
    });
  }

  private async settleFlags(
    tx: Prisma.TransactionClient,
    staff: StaffActor,
    recorded: ActionRow,
    resolveFlags: boolean | undefined,
  ): Promise<void> {
    if (resolveFlags === false) {
      return;
    }
    await resolveOpenFlags(tx, {
      targetType: ModerationTargetType.USER,
      targetId: recorded.targetId,
      status: FlagStatus.ACTIONED,
      resolvedById: staff.id,
      resolutionId: recorded.id,
    });
  }

  private notify(row: ActionRow, title: string, message: string): Promise<void> {
    return this.notifications.notifyBestEffort({
      userId: row.targetId,
      title,
      message,
      type: 'WARNING',
      kind: 'MODERATION',
      data: { actionId: row.id, action: row.action },
    });
  }

  /**
   * A suspended account hosts and joins nothing. The suspension is already written when this runs,
   * so a failure here is logged and never undoes it: the guard refuses the account either way.
   */
  private async endLiveSessions(accountId: string): Promise<void> {
    try {
      await this.multiplayer.removeAccount(accountId);
      await this.workSessions.kickEverywhere(accountId);
    } catch (error) {
      this.logger.warn(
        `Could not end the live sessions of account ${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
