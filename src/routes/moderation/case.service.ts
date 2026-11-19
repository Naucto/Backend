import { Injectable } from '@nestjs/common';
import { ModerationTargetType } from '@prisma/client';

import { CaseDetailDto, CaseListDto, CaseQueryDto, OpenCaseCountDto } from './dto/case.dto';
import { InternalNoteDto } from './dto/moderation-decision.dto';
import { notAvailableYet } from './moderation.error';
import { StaffActor } from './staff-actor';

/** The queue staff work through: the flags on one target read as one case. */
@Injectable()
export class CaseService {
  count(): Promise<OpenCaseCountDto> {
    return notAvailableYet();
  }

  list(_staff: StaffActor, _query: CaseQueryDto): Promise<CaseListDto> {
    return notAvailableYet();
  }

  detail(
    _staff: StaffActor,
    _targetType: ModerationTargetType,
    _targetId: number,
  ): Promise<CaseDetailDto> {
    return notAvailableYet();
  }

  dismiss(
    _staff: StaffActor,
    _targetType: ModerationTargetType,
    _targetId: number,
    _note: InternalNoteDto,
  ): Promise<CaseDetailDto> {
    return notAvailableYet();
  }
}
