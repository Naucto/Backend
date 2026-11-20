import { Controller, Get, HttpStatus, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { LogQueryDto, ModerationLogDto } from './dto/moderation-action.dto';
import { ModerationLogService } from './moderation-log.service';
import { staffOf } from './staff-actor';

@ApiTags('admin')
@Controller('admin/moderation/log')
@RequiresStaffSession(MODERATOR)
export class AdminModerationLogController {
  constructor(private readonly log: ModerationLogService) {}

  @Get()
  @ApiOperation({
    summary: 'What staff did, newest first. Filtered by target, it is the history of that target',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationLogDto })
  list(@Req() req: RequestWithUser, @Query() query: LogQueryDto): Promise<ModerationLogDto> {
    return this.log.list(staffOf(req), query);
  }
}
