import { Injectable } from '@nestjs/common';

import { ModerationActionDto } from './dto/moderation-action.dto';
import { ContentDecisionDto, ModerationNoteDto } from './dto/moderation-decision.dto';
import { notAvailableYet } from './moderation.error';
import { StaffActor } from './staff-actor';

/** What staff decide about a game or a comment. */
@Injectable()
export class ContentModerationService {
  hideProject(
    _staff: StaffActor,
    _projectId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  restoreProject(
    _staff: StaffActor,
    _projectId: number,
    _input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  removeProject(
    _staff: StaffActor,
    _projectId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  hideComment(
    _staff: StaffActor,
    _commentId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  restoreComment(
    _staff: StaffActor,
    _commentId: number,
    _input: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }

  removeComment(
    _staff: StaffActor,
    _commentId: number,
    _input: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return notAvailableYet();
  }
}
