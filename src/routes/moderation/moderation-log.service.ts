import { Injectable } from '@nestjs/common';

import { LogQueryDto, ModerationLogDto } from './dto/moderation-action.dto';
import { notAvailableYet } from './moderation.error';
import { StaffActor } from './staff-actor';

/** The record of what staff did, read back. */
@Injectable()
export class ModerationLogService {
  list(_staff: StaffActor, _query: LogQueryDto): Promise<ModerationLogDto> {
    return notAvailableYet();
  }
}
