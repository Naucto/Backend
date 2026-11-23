import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ModerationTargetType } from '@prisma/client';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { CaseService } from './case.service';
import { CaseDetailDto, CaseListDto, CaseQueryDto, OpenCaseCountDto } from './dto/case.dto';
import { InternalNoteDto } from './dto/moderation-decision.dto';
import { MODERATION_ERROR } from './moderation.error';
import { staffOf } from './staff-actor';

const TARGET_TYPE = new ParseEnumPipe(ModerationTargetType);

@ApiTags('admin')
@Controller('admin/moderation/cases')
@RequiresStaffSession(MODERATOR)
export class AdminCaseController {
  constructor(private readonly cases: CaseService) {}

  @Get()
  @ApiOperation({ summary: 'Flagged targets, each with the flags it holds' })
  @ApiResponse({ status: HttpStatus.OK, type: CaseListDto })
  list(@Req() req: RequestWithUser, @Query() query: CaseQueryDto): Promise<CaseListDto> {
    return this.cases.list(staffOf(req), query);
  }

  @Get('count')
  @ApiOperation({ summary: 'How many cases and flags wait for staff' })
  @ApiResponse({ status: HttpStatus.OK, type: OpenCaseCountDto })
  count(): Promise<OpenCaseCountDto> {
    return this.cases.count();
  }

  @Get(':targetType/:targetId')
  @ApiOperation({ summary: 'One case in full: the target, its flags and what was done about it' })
  @ApiParam({ name: 'targetId', type: String, format: 'uuid' })
  @ApiParam({ name: 'targetType', enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  @ApiResponse({ status: HttpStatus.OK, type: CaseDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Nothing was ever flagged there' })
  detail(
    @Req() req: RequestWithUser,
    @Param('targetType', TARGET_TYPE) targetType: ModerationTargetType,
    @Param('targetId', ParseIdPipe) targetId: string,
  ): Promise<CaseDetailDto> {
    return this.cases.detail(staffOf(req), targetType, targetId);
  }

  @Post(':targetType/:targetId/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close the open flags of a case without acting on its target' })
  @ApiParam({ name: 'targetId', type: String, format: 'uuid' })
  @ApiParam({ name: 'targetType', enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  @ApiResponse({ status: HttpStatus.OK, type: CaseDetailDto })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: `A case about the caller's own content (${MODERATION_ERROR.OWN_CASE})`,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `No flag left open (${MODERATION_ERROR.NO_OPEN_FLAGS})`,
  })
  dismiss(
    @Req() req: RequestWithUser,
    @Param('targetType', TARGET_TYPE) targetType: ModerationTargetType,
    @Param('targetId', ParseIdPipe) targetId: string,
    @Body() dto: InternalNoteDto,
  ): Promise<CaseDetailDto> {
    return this.cases.dismiss(staffOf(req), targetType, targetId, dto);
  }
}
