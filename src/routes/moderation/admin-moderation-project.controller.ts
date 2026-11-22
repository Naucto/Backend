import { pipeline } from 'node:stream/promises';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { ADMIN, MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ContentModerationService } from './content-moderation.service';
import {
  ModerationProjectDetailDto,
  ModerationProjectListDto,
  ProjectDirectoryQueryDto,
} from './dto/directory.dto';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ContentDecisionDto, ModerationNoteDto } from './dto/moderation-decision.dto';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationDirectoryService } from './moderation-directory.service';
import { staffOf } from './staff-actor';

@ApiTags('admin')
@Controller('admin/moderation/projects')
@RequiresStaffSession(MODERATOR)
export class AdminModerationProjectController {
  private readonly logger = new Logger(AdminModerationProjectController.name);

  constructor(
    private readonly directory: ModerationDirectoryService,
    private readonly content: ContentModerationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Every game by name, published, unpublished or hidden' })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationProjectListDto })
  list(
    @Req() req: RequestWithUser,
    @Query() query: ProjectDirectoryQueryDto,
  ): Promise<ModerationProjectListDto> {
    return this.directory.projects(staffOf(req), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One game, with what the caller may do about it' })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationProjectDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such game' })
  detail(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ModerationProjectDetailDto> {
    return this.directory.project(staffOf(req), id);
  }

  @Get(':id/cover')
  @ApiOperation({ summary: 'The cover of a game, served privately even while it is hidden' })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiResponse({ status: HttpStatus.OK, description: 'The image' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No cover' })
  async cover(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const file = await this.directory.projectCover(id);
    res.set({
      'Content-Type': file.contentType ?? 'application/octet-stream',
      ...(file.contentLength !== undefined ? { 'Content-Length': String(file.contentLength) } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    try {
      await pipeline(file.body, res);
    } catch (error) {
      this.logger.warn(
        `Cover download interrupted: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  @Post(':id/hide')
  @ApiOperation({ summary: 'Take a game off the hub and stop serving its release' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such game' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Hidden already (${MODERATION_ERROR.ALREADY_HIDDEN})`,
  })
  hide(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return this.content.hideProject(staffOf(req), id, dto);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Put a hidden game back as it was' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such game' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Not hidden (${MODERATION_ERROR.NOT_HIDDEN})`,
  })
  restore(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ModerationNoteDto,
  ): Promise<ModerationActionDto> {
    return this.content.restoreProject(staffOf(req), id, dto);
  }

  @Delete(':id')
  @RequiresStaffSession(ADMIN)
  @ApiOperation({ summary: 'Delete a game for good, with its saves, release and comments' })
  @ApiBody({ type: ContentDecisionDto })
  @ApiResponse({ status: HttpStatus.OK, type: ModerationActionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such game' })
  remove(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ContentDecisionDto,
  ): Promise<ModerationActionDto> {
    return this.content.removeProject(staffOf(req), id, dto);
  }
}
