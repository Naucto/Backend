import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Req,
  HttpStatus,
  ParseIntPipe
} from '@nestjs/common';
import { WorkSessionService } from './work-session.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
} from '@nestjs/swagger';
import { ProjectCollaboratorGuard } from '../../auth/guards/project.guard';
import { JoinRoomResult } from './work-session.types';
import {FetchWorkSessionDto} from "src/routes/work-session/dto/fetch-work-session.dto";

@ApiTags('work-sessions')
@Controller('work-sessions')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, ProjectCollaboratorGuard)
export class WorkSessionController {
  constructor(private readonly workSessionService: WorkSessionService) {}


  @Post('join/:id')
  @ApiOperation({ summary: 'Join a work session' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'The work session has been successfully created.'})
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request.'})
  @ApiParam({ name: 'id', description: 'Project ID' })
  async join(@Param('id', ParseIntPipe) projectId: number, @Req() req: any): Promise<JoinRoomResult> {
    return await this.workSessionService.join(projectId, req.user);
  }

  @Post('leave/:id')
  @ApiOperation({ summary: 'Leave a work session' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Successfully left the work session.'})
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request.'})
  @ApiParam({ name: 'id', description: 'Project ID' })
  async leave(@Param('id', ParseIntPipe) projectId: number, @Req() req: any): Promise<void> {
    return await this.workSessionService.leave(projectId, req.user);
  }

  @Get('info/:id')
  @ApiOperation({ summary: 'Get work session info' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Work session info retrieved successfully.', type: FetchWorkSessionDto})
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Work session not found.'})
  @ApiParam({ name: 'id', description: 'Work session ID' })
  async getInfo(@Param('id', ParseIntPipe) workSessionId: number): Promise<any> {
    return await this.workSessionService.getInfo(workSessionId);
  }
}
