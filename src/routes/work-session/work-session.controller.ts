import {
  Controller,
  Post,
  Param,
  UseGuards,
  Req,
  HttpStatus,
  ParseIntPipe,
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

@ApiTags('work-sessions')
@Controller('work-sessions')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, ProjectCollaboratorGuard)
export class WorkSessionController {
  constructor(private readonly workSessionService: WorkSessionService) {}


  @Post(':id')
  @ApiOperation({ summary: 'Join a work session' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'The work session has been successfully created.'})
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request.'})
  @ApiParam({ name: 'id', description: 'Project ID' })
  async join(@Param('id', ParseIntPipe) projectId: number, @Req() req: any): Promise<JoinRoomResult> {
    return await this.workSessionService.join(projectId, req.user);
  }
}
