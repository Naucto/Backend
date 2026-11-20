import { Injectable } from '@nestjs/common';

import { ModerationActionDto } from './dto/moderation-action.dto';
import {
  ClearProfileDto,
  ModerationNoteDto,
  StaffDeleteAccountDto,
  SuspendAccountDto,
  WarnAccountDto,
} from './dto/moderation-decision.dto';
import { notAvailableYet } from './moderation.error';
import { StaffActor } from './staff-actor';

/** What staff decide about an account. */
@Injectable()
export class AccountModerationService {
  warn(
    _staff: StaffActor,
    _accountId: number,
    _input: WarnAccountDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
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
}
