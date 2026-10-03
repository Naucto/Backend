import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  ParseFilePipeBuilder,
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

import { RequiresAuth } from '../../auth/access/access.decorators';
import { UserDto } from '../../auth/dto/user.dto';
import { ProjectCollaboratorGuard, ProjectCreatorGuard } from '../../auth/guards/project.guard';
import { AddCollaboratorDto, RemoveCollaboratorDto } from './dto/collaborator-project.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ImageUrlResponseDto } from './dto/image-url-response.dto';
import { ProjectActionResponseDto } from './dto/project-action-response.dto';
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
    type: 'number',
    description: 'Numeric ID of the project to retrieve',
  })
  @ApiResponse({
    status: 200,
    description: 'Project object',
    type: ProjectExResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 403, description: 'Invalid user or project ID' })
  async findOne(@ProjectId() id: number): Promise<ProjectExResponseDto> {
    return this.projectService.findOne(id);
  }

  @Put(':id')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Update an existing project' })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Numeric ID of the project to update',
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
    @ProjectId() id: number,
    @Body() updateProjectDto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projectService.update(id, updateProjectDto);
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
    type: 'number',
    description: 'Numeric ID of the project to update',
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
    @ProjectId() id: number,
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
    type: 'number',
    description: 'Numeric ID of the project to update',
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
    @ProjectId() id: number,
    @Body() removeCollaboratorDto: RemoveCollaboratorDto,
  ): Promise<ProjectExResponseDto> {
    return this.projectService.removeCollaborator(id, removeCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Numeric ID of the project to delete',
  })
  @ApiResponse({
    status: 204,
    description: 'Project deleted successfully (no content)',
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Error deleting project' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@ProjectId() id: number): Promise<void> {
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
  @ApiParam({ name: 'id', type: 'number' })
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
    @ProjectId() id: number,
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
  @ApiParam({ name: 'id', type: 'number' })
  @ApiResponse({
    status: 200,
    description: 'CDN URL for the project image',
    type: ImageUrlResponseDto,
  })
  @ApiResponse({ status: 204, description: 'Project has no image' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getProjectImage(@ProjectId() id: number): Promise<ImageUrlResponseDto> {
    const url = await this.projectService.coverUrl(id);
    if (!url) {
      throw new HttpException('No content', HttpStatus.NO_CONTENT);
    }

    return { url };
  }
}
