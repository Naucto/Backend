import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Req, Res, HttpStatus, HttpCode, ParseIntPipe, Patch, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectCollaboratorGuard } from '../../auth/guards/project.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ProjectCreatorGuard } from '../../auth/guards/project.guard';
import { AddCollaboratorDto, RemoveCollaboratorDto } from './dto/collaborator-project.dto';
import { S3Service } from '../s3/s3.service';
import { S3DownloadException } from '../s3/s3.error';
import { Response } from 'express';
import { UserDto } from 'src/auth/dto/user.dto';

interface RequestWithUser extends Request {
  user: UserDto;
}

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ProjectController {
  constructor(private readonly projectService: ProjectService, private readonly s3Service: S3Service) {}

  @Get()
  @ApiOperation({ summary: 'Retrieve the list of projects' })
  @ApiResponse({ status: 200, description: 'A JSON array of projects' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findAll(@Req() request: RequestWithUser) {
    const user =  request.user;
    return this.projectService.findAll(user.id);
  }

  @Get(':id')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Retrieve a single project' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the project to retrieve' })
  @ApiResponse({ status: 200, description: 'Project object' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @ApiResponse({ status: 403, description: 'Invalid user or project ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  @ApiBody({ type: CreateProjectDto })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request – invalid input' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createProjectDto: CreateProjectDto, @Req() req) {
    const userId = req.user.id;
    return this.projectService.create(createProjectDto, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing project' })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Numeric ID of the project to update',
  })
  @ApiBody({ type: UpdateProjectDto })
  @ApiResponse({ status: 200, description: 'Updated project object' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Error updating project' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectService.update(id, updateProjectDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Patch(':id/add-collaborator')
  @ApiOperation({ summary: 'Add a new collaborator' })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Numeric ID of the project to update',
  })
  @ApiBody({ type: AddCollaboratorDto })
  @ApiResponse({ status: 200, description: 'Patch project object' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Error Patching project' })
  async addCollaborator(
    @Param('id', ParseIntPipe) id: number,
    @Body() addCollaboratorDto: AddCollaboratorDto,
  ) {
    return this.projectService.addCollaborator(id, addCollaboratorDto);
  }

  @UseGuards(ProjectCreatorGuard)
  @Delete(':id/remove-collaborator')
  @ApiOperation({ summary: 'Remove a collaborator' })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Numeric ID of the project to update',
  })
  @ApiBody({ type: RemoveCollaboratorDto })
  @ApiResponse({ status: 200, description: 'Patch project object' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({
    status: 500,
    description: 'Error remove collaborator on project',
  })
  async removeCollaborator(
    @Param('id', ParseIntPipe) id: number,
    @Body() removeCollaboratorDto: RemoveCollaboratorDto,
    @Req() request: RequestWithUser,
  ) {
    const initiator = request.user.id;
    return this.projectService.removeCollaborator(id, initiator, removeCollaboratorDto);
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
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.remove(id);
  }

  @Patch(':id/saveContent')
  @UseGuards(ProjectCollaboratorGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Save content file to S3 for a project' })
  @ApiConsumes('multipart/form-data')
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
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @HttpCode(HttpStatus.CREATED)
  async saveProjectContent(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    const metadata = {
      uploadedBy: req.user.id.toString(),
      id,
    };

    await this.s3Service.uploadFile(file, metadata, undefined, id);

    return { message: 'File uploaded successfully', id };
  }

  @Get(':id/fetchContent')
  @UseGuards(ProjectCollaboratorGuard)
  @ApiOperation({ summary: 'Fetch content file from S3 for a project' })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({ status: 200, description: 'File fetched successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async fetchProjectContent(@Param('id') id: string, @Res() res: Response) {
    try {
      const file = await this.s3Service.downloadFile(id);

      res.set({
        'Content-Type': file.contentType,
        'Content-Length': file.contentLength,
      });

      file.body.pipe(res);
    } catch (error) {
      if (error instanceof S3DownloadException) {
        return res.status(404).json({ message: 'File not found' });
      }
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
}

