import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Req, HttpStatus, HttpCode, ParseIntPipe } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
//import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
//@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  @ApiOperation({ summary: 'Retrieve the list of projects' })
  @ApiResponse({ status: 200, description: 'A JSON array of projects' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findAll() {
    return this.projectService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single project' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the project to retrieve' })
  @ApiResponse({ status: 200, description: 'Project object' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
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
    // The user ID can be extracted from the JWT token
    // assuming it's attached to the request by the JwtAuthGuard
    const userId = req.user.id;
    return this.projectService.create(createProjectDto, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing project' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the project to update' })
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

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the project to delete' })
  @ApiResponse({ status: 204, description: 'Project deleted successfully (no content)' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Error deleting project' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.remove(id);
  }
}