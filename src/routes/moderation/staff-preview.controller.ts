import { pipeline } from 'node:stream/promises';

import { Controller, Get, HttpStatus, Logger, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { RequiresRole } from '../../auth/access/access.decorators';
import { MODERATOR } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ProjectId } from '../project/project-id.decorator';
import { PreviewContentQueryDto, ProjectPreviewDto } from './dto/project-preview.dto';
import { staffOf } from './staff-actor';
import { StaffPreviewService } from './staff-preview.service';

/**
 * Read by the web app, so with the token of a site sign-in: staff open a game there in the editor,
 * which loads read-only for them, and nothing on these routes writes to it.
 */
@ApiTags('moderation')
@Controller('moderation/projects')
@RequiresRole(MODERATOR)
export class StaffPreviewController {
  private readonly logger = new Logger(StaffPreviewController.name);

  constructor(private readonly previews: StaffPreviewService) {}

  @Get(':id/preview')
  @ApiOperation({ summary: 'Any game as its collaborators read it, published or not' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: ProjectPreviewDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such game' })
  preview(@Req() req: RequestWithUser, @ProjectId() id: string): Promise<ProjectPreviewDto> {
    return this.previews.preview(staffOf(req), id);
  }

  @Get(':id/preview/content')
  @ApiOperation({ summary: 'The latest save of any game, or its released build' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiProduces('application/octet-stream')
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The game file',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Nothing saved or released yet' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such game' })
  async content(
    @Req() req: RequestWithUser,
    @ProjectId() id: string,
    @Query() query: PreviewContentQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.previews.content(staffOf(req), id, query.source ?? 'draft');
    if (!file) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    res.set({
      'Content-Type': file.contentType ?? 'application/octet-stream',
      ...(file.contentLength !== undefined ? { 'Content-Length': String(file.contentLength) } : {}),
      'Cache-Control': 'private, no-store',
    });
    try {
      await pipeline(file.body, res);
    } catch (error) {
      this.logger.warn(
        `Preview download interrupted: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
