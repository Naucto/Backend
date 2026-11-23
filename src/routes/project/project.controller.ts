import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { AllowedWhileSuspended, Public, RequiresAuth } from '../../auth/access/access.decorators';
import { UserDto } from '../../auth/dto/user.dto';
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from '../../auth/guards/project.guard';
import { AddCollaboratorDto, RemoveCollaboratorDto } from './dto/collaborator-project.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectDiskDto } from './dto/disk-style.dto';
import { ImageUrlResponseDto } from './dto/image-url-response.dto';
import { LegacyProjectDto } from './dto/legacy-project.dto';
import { ProjectActionResponseDto } from './dto/project-action-response.dto';
import { ProjectClipDto } from './dto/project-clip.dto';
import { PROJECT_CLIP_MAX_BYTES, PROJECT_CLIP_TYPES } from './dto/project-field-limits';
import { ProjectHiddenDto } from './dto/project-hidden.dto';
import {
  PaginatedProjectsResponseDto,
  ProjectExResponseDto,
  ProjectResponseDto,
  ProjectsCountResponseDto,
} from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import type { UserProjectFilters, UserProjectStatus } from './project.service';
import { ProjectService, USER_PROJECT_STATUSES } from './project.service';
import { ProjectId } from './project-id.decorator';
import { parseOptionalInt, parseTags } from './project-query';

interface RequestWithUser extends Request {
  user: UserDto;
}

/** Multer stops reading past it and answers 413 itself, before the route's pipe runs. */
const PROJECT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The clip is stored and served under the type the client declared, so that type is held to the
 * same list as the container read from the content.
 */
const CLIP_FILE = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: PROJECT_CLIP_TYPES })
  .addFileTypeValidator({ fileType: PROJECT_CLIP_TYPES, skipMagicNumbersValidation: true })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

@ApiTags('projects')
@Controller('projects')
@RequiresAuth()
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  private buildUserProjectFilters(
    search?: string,
    tags?: string,
    status?: UserProjectStatus,
  ): UserProjectFilters {
    const filters: UserProjectFilters = {};
    const parsedTags = parseTags(tags);

    if (search) {
      filters.search = search;
    }

    if (parsedTags) {
      filters.tags = parsedTags;
    }

    if (status) {
      filters.status = status;
    }

    return filters;
  }

  @Get()
  @ApiOperation({ summary: 'Retrieve the paginated list of projects' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: 200,
    description: 'A paginated list of projects with collaborators and creator information',
    type: PaginatedProjectsResponseDto,
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findAll(
    @Req() request: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedProjectsResponseDto> {
    const user = request.user;
    return this.projectService.findAll(user.id, parseOptionalInt(page), parseOptionalInt(limit));
  }

  @Get('count')
  @ApiOperation({ summary: "Count the user's projects with filters" })
  @ApiQuery({ name: 'search', type: 'string', required: false })
  @ApiQuery({
    name: 'tags',
    type: 'string',
    required: false,
    description: 'Comma-separated tag list',
  })
  @ApiQuery({
    name: 'status',
    enum: USER_PROJECT_STATUSES,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'The total number of user projects matching the request',
    type: ProjectsCountResponseDto,
  })
  async countProjects(
    @Req() request: RequestWithUser,
    @Query('search') search?: string,
    @Query('tags') tags?: string,
    @Query('status') status?: UserProjectStatus,
  ): Promise<ProjectsCountResponseDto> {
    const total = await this.projectService.countUserProjects(
      request.user.id,
      this.buildUserProjectFilters(search, tags, status),
    );

    return { total };
  }

  @Public()
  @Get('legacy/:number')
  @ApiOperation({
    summary: 'Translate the number a project was once known by into its id',
    description:
      'For links written while projects were numbered. Any project answers, published or not: the routes behind its id still decide who reads it.',
  })
  @ApiParam({ name: 'number', type: 'integer', example: 42 })
  @ApiResponse({ status: 200, description: 'The id of the project', type: LegacyProjectDto })
  @ApiResponse({ status: 400, description: 'Not a number' })
  @ApiResponse({ status: 404, description: 'No project was known by that number' })
  async findLegacy(@Param('number', ParseIntPipe) number: number): Promise<LegacyProjectDto> {
    return { id: await this.projectService.idOfLegacy(number) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  @ApiBody({ type: CreateProjectDto })
  @ApiResponse({
    status: 201,
    description: 'Project created successfully',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request – invalid input' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectResponseDto> {
    const userId = req.user.id;
    return await this.projectService.create(createProjectDto, userId);
  }

  @Get(':id')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Retrieve a single project' })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID of the project to retrieve',
  })
  @ApiResponse({
    status: 200,
    description: 'Project object',
    type: ProjectExResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 403, description: 'Invalid user or project ID' })
  async findOne(@ProjectId() id: string): Promise<ProjectExResponseDto> {
    return this.projectService.findOne(id);
  }

  @Put(':id')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Update an existing project' })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID of the project to update',
  })
  @ApiBody({ type: UpdateProjectDto })
  @ApiResponse({
    status: 200,
    description: 'Updated project object',
    type: ProjectResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Error updating project' })
  async update(
    @ProjectId() id: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projectService.update(id, updateProjectDto);
  }

  @Patch(':id/disk')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: 'Choose the disk of a project, or go back to the derived one with null',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: ProjectDiskDto })
  @ApiResponse({ status: 200, description: 'The disk as stored', type: ProjectDiskDto })
  @ApiResponse({ status: 400, description: 'A colour, finish or direction the disk cannot take' })
  @ApiResponse({
    status: 403,
    description:
      'Not a collaborator of the project (no `code`), or the game is withheld by moderation',
    type: ProjectHiddenDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async setDisk(@ProjectId() id: string, @Body() dto: ProjectDiskDto): Promise<ProjectDiskDto> {
    return { disk: await this.projectService.setDisk(id, dto.disk) };
  }

  @UseGuards(ProjectCreatorGuard)
  @Patch(':id/add-collaborator')
  @ApiOperation({
    summary: 'Add a new collaborator',
    description:
      'Add a collaborator to a project by providing either userId, username, or email. At least one must be provided.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID of the project to update',
  })
  @ApiBody({
    type: AddCollaboratorDto,
    examples: {
      byUserId: {
        summary: 'Add by User ID',
        value: {
          userId: 42,
        },
      },
      byUsername: {
        summary: 'Add by Username',
        value: {
          username: 'john_doe',
        },
      },

      byEmail: {
        summary: 'Add by Email',
        value: {
          email: 'john.doe@example.com',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Updated project object with collaborators',
    type: ProjectExResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - no valid identifier provided',
  })
  @ApiResponse({ status: 404, description: 'Project or user not found' })
  @ApiResponse({ status: 500, description: 'Error Patching project' })
  async addCollaborator(
    @ProjectId() id: string,
    @Body() addCollaboratorDto: AddCollaboratorDto,
  ): Promise<ProjectExResponseDto> {
    return this.projectService.addCollaborator(id, addCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(':id/remove-collaborator')
  @ApiOperation({
    summary: 'Remove a collaborator',
    description:
      'Remove a collaborator from a project by providing either userId, username, or email. At least one must be provided.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID of the project to update',
  })
  @ApiBody({
    type: RemoveCollaboratorDto,
    examples: {
      byUserId: {
        summary: 'Remove by User ID',
        value: {
          userId: 42,
        },
      },

      byUsername: {
        summary: 'Remove by Username',
        value: {
          username: 'john_doe',
        },
      },

      byEmail: {
        summary: 'Remove by Email',
        value: {
          email: 'john.doe@example.com',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Updated project object with collaborators',
    type: ProjectExResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - no valid identifier provided',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - cannot remove project creator',
  })
  @ApiResponse({ status: 404, description: 'Project or user not found' })
  @ApiResponse({
    status: 500,
    description: 'Error remove collaborator on project',
  })
  async removeCollaborator(
    @ProjectId() id: string,
    @Body() removeCollaboratorDto: RemoveCollaboratorDto,
  ): Promise<ProjectExResponseDto> {
    return this.projectService.removeCollaborator(id, removeCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(':id')
  @AllowedWhileSuspended()
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'ID of the project to delete',
  })
  @ApiResponse({
    status: 204,
    description: 'Project deleted successfully (no content)',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Error deleting project' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@ProjectId() id: string): Promise<void> {
    return this.projectService.remove(id);
  }

  @Post(':id/image')
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PROJECT_IMAGE_MAX_BYTES } }))
  @ApiOperation({ summary: 'Upload project image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Project image file (JPEG, PNG, GIF, WebP)',
        },
      },
    },
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Image uploaded successfully',
    type: ProjectActionResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 413, description: 'File too large' })
  @ApiResponse({ status: 422, description: 'Invalid file type or size' })
  @HttpCode(HttpStatus.CREATED)
  async uploadProjectImage(
    @ProjectId() id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|gif|webp)$/ })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
    @Req() req: RequestWithUser,
  ): Promise<ProjectActionResponseDto> {
    await this.projectService.uploadImage(id, file, req.user.id);

    return { message: 'Project image uploaded successfully', id };
  }

  @Get(':id/image')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({
    summary: 'Get CDN URL for project image (authenticated, any project status)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'CDN URL for the project image',
    type: ImageUrlResponseDto,
  })
  @ApiResponse({ status: 204, description: 'Project has no image' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getProjectImage(@ProjectId() id: string): Promise<ImageUrlResponseDto> {
    const url = await this.projectService.coverUrl(id);
    if (!url) {
      throw new HttpException('No content', HttpStatus.NO_CONTENT);
    }

    return { url };
  }

  @Post(':id/clip')
  @UseGuards(ProjectCollaboratorGuard)
  // Multer stops reading past the limit and answers 413 itself, before the route's pipe runs.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PROJECT_CLIP_MAX_BYTES, files: 1 } }),
  )
  @ApiOperation({ summary: 'Upload the gameplay clip of a project, over the one it has' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'WebM or MP4 video, 4 MiB' },
      },
    },
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Clip stored', type: ProjectClipDto })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 413, description: 'Larger than 4 MiB' })
  @ApiResponse({ status: 422, description: 'Not a WebM or MP4 video, by its type or its content' })
  @HttpCode(HttpStatus.CREATED)
  async uploadClip(
    @ProjectId() id: string,
    @UploadedFile(CLIP_FILE) file: Express.Multer.File,
    @Req() req: RequestWithUser,
  ): Promise<ProjectClipDto> {
    return { clipUrl: await this.projectService.uploadClip(id, file, req.user.id) };
  }

  @Delete(':id/clip')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Remove the gameplay clip of a project; no-op when it has none' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Clip removed' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeClip(@ProjectId() id: string): Promise<void> {
    await this.projectService.removeClip(id);
  }
}
