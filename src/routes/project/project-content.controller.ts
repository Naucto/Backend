import { pipeline } from 'node:stream/promises';

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { Public, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { ProjectCollaboratorGuard } from '../../auth/guards/project.guard';
import { S3ObjectNotFoundException } from '../s3/s3.error';
import { DownloadedFile } from '../s3/s3.interface';
import {
  ProjectActionResponseDto,
  VersionDeletedResponseDto,
} from './dto/project-action-response.dto';
import { SignedUrlResponseDto } from './dto/project-response.dto';
import { ProjectCheckpointsResponseDto, ProjectVersionsResponseDto } from './dto/project-saves.dto';
import {
  CheckpointLimitDto,
  ProjectLimitsDto,
  ProjectSizeDto,
  ProjectTooLargeDto,
} from './dto/project-size.dto';
import { GameBlobUpload, REQUIRED_GAME_BLOB } from './game-blob-upload.decorator';
import { ProjectContentService } from './project-content.service';
import { ProjectId } from './project-id.decorator';

@ApiTags('projects')
@Controller('projects')
@RequiresAuth()
export class ProjectContentController {
  constructor(private readonly contentService: ProjectContentService) {}

  private readonly logger = new Logger(ProjectContentController.name);

  /**
   * Streams a stored file as the response. A missing object answers 404; once the body has started
   * a failure can only close the connection, the status line being already sent.
   */
  private async sendFile(
    res: Response,
    fetch: () => Promise<DownloadedFile>,
    headers: Record<string, string> = {},
  ): Promise<void> {
    let file: DownloadedFile;
    try {
      file = await fetch();
    } catch (error) {
      if (error instanceof S3ObjectNotFoundException) {
        throw new NotFoundException('File not found');
      }
      throw error;
    }

    res.set({
      'Content-Type': file.contentType,
      'Content-Length': file.contentLength,
      ...headers,
    });

    try {
      await pipeline(file.body, res);
    } catch (error) {
      this.logger.warn(
        `Download interrupted: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  @Public()
  @Get('releases/:id/content')
  @ApiOperation({
    summary: 'Get project release version',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Project release file',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async getReleaseContent(@ProjectId() id: number, @Res() res: Response): Promise<void> {
    await this.sendFile(res, () => this.contentService.fetchReleaseContent(id));
  }

  @Public()
  @Get('releases/:id/content-url')
  @ApiOperation({
    summary: 'Get the CDN URL of a release',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'CDN URL of the release, versioned by upload',
    type: SignedUrlResponseDto,
  })
  async getReleaseContentUrl(@ProjectId() id: number): Promise<SignedUrlResponseDto> {
    const url = await this.contentService.releaseUrl(id);
    if (!url) {
      throw new NotFoundException('Release not found');
    }

    return { signedUrl: url };
  }

  @Public()
  @Get('limits')
  @ApiOperation({
    summary: 'Get the project size limits',
  })
  @ApiResponse({
    status: 200,
    description: 'Content budget and blob size limits',
    type: ProjectLimitsDto,
  })
  getLimits(): ProjectLimitsDto {
    return this.contentService.getLimits();
  }

  @Get(':id/size')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Get the size breakdown of the project's latest save",
    description:
      'Logical content size per category (code, sprites, flags, map, sound, palette) ' +
      'computed from the decoded game document, compared against the publishing budget.',
  })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiResponse({
    status: 200,
    description: 'Size breakdown',
    type: ProjectSizeDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getSize(@ProjectId() id: number): Promise<ProjectSizeDto> {
    return this.contentService.getContentSize(id);
  }

  @Patch(':id/content')
  @UseGuards(ProjectCollaboratorGuard)
  @GameBlobUpload()
  @ApiOperation({
    summary: "Save project's content (Upload)",
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The game document, as a Yjs update',
        },
      },
    },
  })
  @ApiParam({ name: 'id', type: 'number' })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @HttpCode(HttpStatus.CREATED)
  async saveProjectContent(
    @ProjectId() id: number,
    @UploadedFile(REQUIRED_GAME_BLOB) file: Express.Multer.File,
  ): Promise<ProjectActionResponseDto> {
    await this.contentService.save(id, file);

    return { message: 'File uploaded successfully', id };
  }

  @Get(':id/content')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Fetch project's content",
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'File fetched successfully',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async fetchProjectContent(@ProjectId() id: number, @Res() res: Response): Promise<void> {
    await this.sendFile(res, () => this.contentService.fetchLastVersion(id));
  }

  @Post(':id/checkpoints/:name')
  @UseGuards(ProjectCollaboratorGuard)
  @GameBlobUpload()
  @ApiOperation({
    summary: "Save project's checkpoint",
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'name', type: 'string' })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The project holds as many named versions as it may',
    type: CheckpointLimitDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @HttpCode(HttpStatus.CREATED)
  async saveCheckpoint(
    @ProjectId() id: number,
    @Param('name') name: string,
    @UploadedFile(REQUIRED_GAME_BLOB) file: Express.Multer.File,
  ): Promise<ProjectActionResponseDto> {
    await this.contentService.save(id, file);
    await this.contentService.checkpoint(id, name);

    return { message: 'Checkpoint saved successfully', id };
  }

  @Delete(':id/checkpoints/:name')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Delete project's checkpoint",
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'name', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Checkpoint deleted successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async deleteCheckpoint(
    @ProjectId() id: number,
    @Param('name') name: string,
  ): Promise<ProjectActionResponseDto> {
    await this.contentService.removeCheckpoint(id, name);

    return { message: 'Checkpoint deleted successfully', id };
  }

  @Post(':id/publish')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Publish project' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 201,
    description: 'Project published successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 413,
    description: 'Project content exceeds the publishing budget',
    type: ProjectTooLargeDto,
  })
  @HttpCode(HttpStatus.CREATED)
  async publish(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<ProjectActionResponseDto> {
    await this.contentService.publish(id, req.user.id);

    return { message: 'Project published successfully', id };
  }

  @Post(':id/unpublish')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Unpublish project' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 201,
    description: 'Project unpublished successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @HttpCode(HttpStatus.CREATED)
  async unpublish(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<ProjectActionResponseDto> {
    await this.contentService.unpublish(id, req.user.id);

    return { message: 'Project unpublished successfully', id };
  }

  @Get(':id/versions')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Get project versions' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Project versions retrieved successfully',
    type: ProjectVersionsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getVersions(@ProjectId() id: number): Promise<ProjectVersionsResponseDto> {
    const versions = await this.contentService.listVersions(id);

    return { versions };
  }

  @Get(':id/checkpoints')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: 'Get project checkpoints',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Project checkpoints retrieved successfully',
    type: ProjectCheckpointsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getCheckpoints(@ProjectId() id: number): Promise<ProjectCheckpointsResponseDto> {
    const checkpoints = await this.contentService.listCheckpoints(id);

    return { checkpoints };
  }

  @Delete(':id/versions/:version')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: 'Delete a project autosave',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'version', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Version deleted successfully',
    type: VersionDeletedResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'No such version' })
  async deleteVersion(
    @ProjectId() id: number,
    @Param('version') version: string,
  ): Promise<VersionDeletedResponseDto> {
    await this.contentService.deleteVersion(id, version);

    return { message: 'Version deleted successfully', name: version };
  }

  @Get(':id/versions/:version')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Fetch a project version' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'version', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Project version retrieved successfully',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getVersion(
    @ProjectId() id: number,
    @Param('version') version: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendFile(res, () => this.contentService.fetchSavedVersion(id, version));
  }

  @Get(':id/checkpoints/:name')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: 'Fetch a project checkpoint',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiParam({ name: 'name', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Project checkpoint retrieved successfully',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getCheckpoint(
    @ProjectId() id: number,
    @Param('name') name: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendFile(
      res,
      async () => {
        const file = await this.contentService.fetchCheckpoint(id, name);
        // attachment() also guesses a Content-Type from the name, so it runs before the stored
        // type is set.
        res.attachment(name);
        return file;
      },
      {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    );
  }

  @Post(':id/update-release')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: "Update an already published project's release content",
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Release updated successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Project is not published' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 413,
    description: 'Project content exceeds the publishing budget',
    type: ProjectTooLargeDto,
  })
  @HttpCode(HttpStatus.OK)
  async updateRelease(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<ProjectActionResponseDto> {
    await this.contentService.updateRelease(id, req.user.id);

    return { message: 'Release updated successfully', id };
  }
}
