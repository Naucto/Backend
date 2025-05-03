import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Req, HttpStatus, HttpCode, ParseIntPipe } from '@nestjs/common';
import { WorkSessionService } from './work-session.service';
import { CreateWorkSessionDto } from './dto/create-work-session.dto';
import { UpdateWorkSessionDto } from './dto/update-work-session.dto';
//import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('work-sessions')
@ApiBearerAuth()
@Controller('work-sessions')
//@UseGuards(JwtAuthGuard)
export class WorkSessionController {
  constructor(private readonly workSessionService: WorkSessionService) {}

  @Get()
  @ApiOperation({ summary: 'Retrieve the list of work sessions' })
  @ApiResponse({ status: 200, description: 'A JSON array of work sessions' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findAll() {
    return this.workSessionService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a single work session' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the work session to retrieve' })
  @ApiResponse({ status: 200, description: 'Work session object' })
  @ApiResponse({ status: 404, description: 'Work session not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.workSessionService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new work session' })
  @ApiBody({ type: CreateWorkSessionDto })
  @ApiResponse({ status: 201, description: 'Work session created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request – invalid input' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createWorkSessionDto: CreateWorkSessionDto, @Req() req) {
    // The user ID can be extracted from the JWT token
    // assuming it's attached to the request by the JwtAuthGuard
    const userId = req.user.id;
    return this.workSessionService.create(createWorkSessionDto, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing work session' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the work session to update' })
  @ApiBody({ type: UpdateWorkSessionDto })
  @ApiResponse({ status: 200, description: 'Updated work session object' })
  @ApiResponse({ status: 404, description: 'Work session not found' })
  @ApiResponse({ status: 500, description: 'Error updating work session' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateWorkSessionDto: UpdateWorkSessionDto,
  ) {
    return this.workSessionService.update(id, updateWorkSessionDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a work session' })
  @ApiParam({ name: 'id', type: 'number', description: 'Numeric ID of the work session to delete' })
  @ApiResponse({ status: 204, description: 'Work session deleted successfully (no content)' })
  @ApiResponse({ status: 404, description: 'Work session not found' })
  @ApiResponse({ status: 500, description: 'Error deleting work session' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.workSessionService.remove(id);
  }
}