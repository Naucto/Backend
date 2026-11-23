import { Body, Controller, Delete, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { ADMIN, MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ContentModerationService } from './content-moderation.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ContentDecisionDto, ModerationNoteDto } from './dto/moderation-decision.dto';
import { MODERATION_ERROR } from './moderation.error';
import { staffOf } from './staff-actor';

const FORBIDDEN = `The role is missing, or the collection is the caller's own (${MODERATION_ERROR.OWN_CASE})`;

/** Decisions only: staff reach a collection through the case its flags opened, not by a list. */
@ApiTags('admin')
@Controller('admin/moderation/collections')
@RequiresStaffSession(MODERATOR)
export class AdminModerationCollectionController {
  constructor(private readonly content: ContentModerationService) {}

  @Post(':id/hide')
  @ApiOperation({ summary: 'Hide a collection from everyone but its owner, for a restore to undo' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: FORBIDDEN })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such collection' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Hidden already (${MODERATION_ERROR.ALREADY_HIDDEN})`,
  })
  hide(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return this.content.hideCollection(staffOf(req), id, dto);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Put a hidden collection back as it was' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: FORBIDDEN })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such collection' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Not hidden (${MODERATION_ERROR.NOT_HIDDEN})`,
  })
  restore(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return this.content.restoreCollection(staffOf(req), id, dto);
  }

  @Delete(':id')
  @RequiresStaffSession(ADMIN)
  @ApiOperation({ summary: 'Delete a collection for good; the games it listed stay' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: ContentDecisionDto })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: FORBIDDEN })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such collection' })
  remove(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return this.content.removeCollection(staffOf(req), id, dto);
  }
}
