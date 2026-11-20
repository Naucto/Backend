import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { ADMIN, MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ContentModerationService } from './content-moderation.service';
import { CommentDirectoryQueryDto, ModerationCommentListDto } from './dto/directory.dto';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ContentDecisionDto, ModerationNoteDto } from './dto/moderation-decision.dto';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationDirectoryService } from './moderation-directory.service';
import { staffOf } from './staff-actor';

@ApiTags('admin')
@Controller('admin/moderation/comments')
@RequiresStaffSession(MODERATOR)
export class AdminModerationCommentController {
  constructor(
    private readonly directory: ModerationDirectoryService,
    private readonly content: ContentModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Comments across every game, newest first, by text, author or game' })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationCommentListDto })
  list(
    @Req() req: RequestWithUser,
    @Query() query: CommentDirectoryQueryDto,
  ): Promise<ModerationCommentListDto> {
    return this.directory.comments(staffOf(req), query);
  }

  @Post(':id/hide')
  @ApiOperation({ summary: 'Remove a comment from view, keeping its text for a restore' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such comment' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Hidden already (${MODERATION_ERROR.ALREADY_HIDDEN}), or deleted by a user (${MODERATION_ERROR.COMMENT_DELETED})`,
  })
  hide(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return this.content.hideComment(staffOf(req), id, dto);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Put a hidden comment back as it was' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such comment' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Not hidden (${MODERATION_ERROR.NOT_HIDDEN})`,
  })
  restore(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return this.content.restoreComment(staffOf(req), id, dto);
  }

  @Delete(':id')
  @RequiresStaffSession(ADMIN)
  @ApiOperation({ summary: 'Delete a comment for good' })
  @ApiBody({ type: ContentDecisionDto })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such comment' })
  remove(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return this.content.removeComment(staffOf(req), id, dto);
  }
}
