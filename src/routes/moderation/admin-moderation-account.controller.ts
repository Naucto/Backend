import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { ADMIN, MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { AccountModerationService } from './account-moderation.service';
import {
  AccountDirectoryQueryDto,
  ModerationAccountDetailDto,
  ModerationAccountListDto,
} from './dto/directory.dto';
import { ModerationActionDto } from './dto/moderation-action.dto';
import {
  ClearProfileDto,
  ModerationNoteDto,
  StaffDeleteAccountDto,
  SuspendAccountDto,
  WarnAccountDto,
} from './dto/moderation-decision.dto';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationDirectoryService } from './moderation-directory.service';
import { staffOf } from './staff-actor';

const RANK_REFUSALS = `Your own account (${MODERATION_ERROR.CANNOT_MODERATE_SELF}), or one holding a role not ranked below yours (${MODERATION_ERROR.TARGET_OUTRANKS_ACTOR})`;

@ApiTags('admin')
@Controller('admin/moderation/accounts')
@RequiresStaffSession(MODERATOR)
export class AdminModerationAccountController {
  constructor(
    private readonly directory: ModerationDirectoryService,
    private readonly accounts: AccountModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Accounts by handle or display name, with where each stands' })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationAccountListDto })
  list(
    @Req() req: RequestWithUser,
    @Query() query: AccountDirectoryQueryDto,
  ): Promise<ModerationAccountListDto> {
    return this.directory.accounts(staffOf(req), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One account, with what the caller may do about it' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationAccountDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such account' })
  detail(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
  ): Promise<ModerationAccountDetailDto> {
    return this.directory.account(staffOf(req), id);
  }

  @Post(':id/warn')
  @ApiOperation({ summary: 'Send an account a formal warning, kept on its record' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: RANK_REFUSALS })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such account' })
  warn(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: WarnAccountDto,
  ): Promise<ModerationActionDto> {
    return this.accounts.warn(staffOf(req), id, dto);
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspend an account for a number of days, or until reinstated' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: RANK_REFUSALS })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such account' })
  suspend(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: SuspendAccountDto,
  ): Promise<ModerationActionDto> {
    return this.accounts.suspend(staffOf(req), id, dto);
  }

  @Post(':id/reinstate')
  @ApiOperation({ summary: 'Lift the suspension of an account' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: RANK_REFUSALS })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such account' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Not suspended (${MODERATION_ERROR.NOT_SUSPENDED})`,
  })
  reinstate(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return this.accounts.reinstate(staffOf(req), id, dto);
  }

  @Post(':id/clear-profile')
  @ApiOperation({ summary: 'Clear parts of a profile: display name, bio, picture, background' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: RANK_REFUSALS })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such account' })
  clearProfile(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ClearProfileDto,
  ): Promise<ModerationActionDto> {
    return this.accounts.clearProfile(staffOf(req), id, dto);
  }

  @Delete(':id')
  @RequiresStaffSession(ADMIN)
  @ApiOperation({ summary: 'Erase an account for good, as its owner could' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: StaffDeleteAccountDto })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: RANK_REFUSALS })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such account' })
  remove(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: StaffDeleteAccountDto,
  ): Promise<ModerationActionDto> {
    return this.accounts.remove(staffOf(req), id, dto);
  }
}
