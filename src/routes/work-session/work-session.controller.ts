import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AllowedWhileSuspended, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { ProjectCollaboratorGuard } from '../../auth/guards/project.guard';
import { ProjectId } from '../project/project-id.decorator';
import { FetchWorkSessionDto } from './dto/fetch-work-session.dto';
import { JoinWorkSessionDto } from './dto/join-work-session.dto';
import { KickWorkSessionDto } from './dto/kick-work-session.dto';
import { WorkSessionService } from './work-session.service';

@ApiTags('work-sessions')
@Controller('work-sessions')
@RequiresAuth()
@UseGuards(ProjectCollaboratorGuard)
export class WorkSessionController {
  constructor(private readonly workSessionService: WorkSessionService) {}

  @Post('join/:id')
  @ApiOperation({ summary: 'Join a work session' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The work session has been successfully created.',
    type: JoinWorkSessionDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Project ID' })
  async join(
    @ProjectId() projectId: string,
    @Req() req: RequestWithUser,
  ): Promise<JoinWorkSessionDto> {
    return await this.workSessionService.join(projectId, req.user);
  }

  @Post('leave/:id')
  @AllowedWhileSuspended()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Leave a work session' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Successfully left the work session.',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Project ID' })
  async leave(@ProjectId() projectId: string, @Req() req: RequestWithUser): Promise<void> {
    return await this.workSessionService.leave(projectId, req.user);
  }

  @Post('kick/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Kick user from work session' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The user was removed from the work session.',
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Project ID' })
  async kick(@ProjectId() projectId: string, @Body() kick: KickWorkSessionDto): Promise<void> {
    return await this.workSessionService.kick(projectId, kick.userId);
  }

  @Get('info/:id')
  @ApiOperation({ summary: 'Get work session info' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Work session info retrieved successfully.',
    type: FetchWorkSessionDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Work session not found.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Project ID' })
  async getInfo(@ProjectId() projectId: string): Promise<FetchWorkSessionDto> {
    return await this.workSessionService.getInfo(projectId);
  }
}
