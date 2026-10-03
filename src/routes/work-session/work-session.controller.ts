import {
  Controller,
  Post,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Body
} from "@nestjs/common";
import { WorkSessionService } from "./work-session.service";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam
} from "@nestjs/swagger";
import { ProjectCollaboratorGuard } from "@auth/guards/project.guard";
import { ProjectId } from "@project/project-id.decorator";
import { FetchWorkSessionDto } from "@work-session/dto/fetch-work-session.dto";
import { KickWorkSessionDto } from "@work-session/dto/kick-work-session.dto";
import { JoinWorkSessionDto } from "@work-session/dto/join-work-session.dto";

@ApiTags("work-sessions")
@Controller("work-sessions")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, ProjectCollaboratorGuard)
export class WorkSessionController {
  constructor(private readonly workSessionService: WorkSessionService) {}

  @Post("join/:id")
  @ApiOperation({ summary: "Join a work session" })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "The work session has been successfully created.",
    type: JoinWorkSessionDto
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Bad request." })
  @ApiParam({ name: "id", type: "number", description: "Project ID" })
  async join(
    @ProjectId() projectId: number,
    @Req() req: RequestWithUser
  ): Promise<JoinWorkSessionDto> {
    return await this.workSessionService.join(projectId, req.user);
  }

  @Post("leave/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Leave a work session" })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: "Successfully left the work session."
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Bad request." })
  @ApiParam({ name: "id", type: "number", description: "Project ID" })
  async leave(
    @ProjectId() projectId: number,
    @Req() req: RequestWithUser
  ): Promise<void> {
    return await this.workSessionService.leave(projectId, req.user);
  }

  @Post("kick/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Kick user from work session" })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: "The user was removed from the work session."
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Bad request." })
  @ApiParam({ name: "id", type: "number", description: "Project ID" })
  async kick(
    @ProjectId() projectId: number,
    @Body() kick: KickWorkSessionDto
  ): Promise<void> {
    return await this.workSessionService.kick(projectId, kick.userId);
  }

  @Get("info/:id")
  @ApiOperation({ summary: "Get work session info" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Work session info retrieved successfully.",
    type: FetchWorkSessionDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Work session not found."
  })
  @ApiParam({ name: "id", type: "number", description: "Project ID" })
  async getInfo(
    @ProjectId() projectId: number
  ): Promise<FetchWorkSessionDto> {
    return await this.workSessionService.getInfo(projectId);
  }
}
