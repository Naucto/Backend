import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GameSessionEx, MultiplayerService } from "./multiplayer.service";
import { WebRTCService } from "src/webrtc/webrtc.service";
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Patch,
  Post,
  UseGuards
} from "@nestjs/common";
import { GameSession } from "@prisma/client";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { ProjectNotFoundError } from "@project/project.error";
import { OpenHostRequestDto, OpenHostResponseDto } from "./dto/open-host.dto";
import { LookupHostsResponseDto, LookupHostsResponseDtoHost } from "./dto/lookup-hosts.dto";
import { MultiplayerHostNotFoundError, MultiplayerHostOpenedError, MultiplayerUserAlreadyJoinedError, MultiplayerUserDoesNotExistError, MultiplayerUserNotInSessionError } from "./multiplayer.error";
import { CloseHostRequestDto } from "./dto/close-host.dto";
import { getExcerrMessage as getExcerrMessage } from "src/util/errors";
import { JoinHostRequestDto, JoinHostResponseDto } from "./dto/join-host.dto";
import { LeaveHostRequestDto } from "./dto/leave-host.dto";

@ApiTags("multiplayer")
@Controller("multiplayer")
@UseGuards(JwtAuthGuard)
export class MultiplayerController {
  private readonly logger = new Logger(MultiplayerController.name);

  constructor(
    private readonly multiplayerService: MultiplayerService,
    private readonly webrtcService: WebRTCService
  ) {}

  @Get("list-hosts")
  @ApiOperation({ summary: "List available game hosts/sessions from the user's perspective" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "A list of available game hosts is returned.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Bad request (wrong project ID)."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Unhandled server error."
  })
  async lookupHosts(requestCtx: RequestWithUser, projectId: number): Promise<LookupHostsResponseDto>
  {
    let hosts: GameSessionEx[];

    try {
      hosts = await this.multiplayerService.lookupHosts(projectId, requestCtx.user.id);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Error while looking up hosts for project ID ${projectId}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new LookupHostsResponseDto();
    responseDto.hosts = hosts.map((host) => {
      const hostDto = new LookupHostsResponseDtoHost();
      hostDto.sessionUuid = host.sessionId;
      hostDto.sessionVisibility = host.visibility;
      hostDto.playerCount = host.otherUsers.length + 1;
    
      return hostDto;
    });

    return responseDto;
  }

  @Post("open-host")
  @ApiOperation({ summary: "Open a new game host/session, with the caller being the game host" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The game host/session has been successfully opened.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "The user or project was not found."
  })
  // FIXME: See comment below
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "The user is already hosting a game session for this project."
  })
  async openHost(requestCtx: RequestWithUser, request: OpenHostRequestDto): Promise<OpenHostResponseDto>
  {
    let gameSession: GameSession;

    try {
      gameSession = await this.multiplayerService.openHost(requestCtx.user.id, request.projectId, request.visibility);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerHostOpenedError) {
        // FIXME: Should the user be able to open multiple hosts for the same project?
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Error while opening host for user ID ${requestCtx.user.id} and project ID ${request.projectId}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new OpenHostResponseDto();
    responseDto.sessionUuid = gameSession.sessionId;
    responseDto.webrtcConfig = this.webrtcService.buildOffer();

    return responseDto;
  }

  @Delete("close-host")
  @ApiOperation({ summary: "Close an existing game host/session, with the caller being the game host" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The game host/session has been successfully closed."
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "The user, project, or game session was not found."
  })
  async closeHost(requestCtx: RequestWithUser, request: CloseHostRequestDto): Promise<void> {
    try {
      await this.multiplayerService.closeHost(requestCtx.user.id, request.projectId);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof ProjectNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerHostNotFoundError) {
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Error while closing host for user ID ${requestCtx.user.id} and project ID ${request.projectId}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }
  }

  @Patch("join-host")
  @ApiOperation({ summary: "Join an existing game host/session as a player" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully joined the game session."
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Game session or user not found."
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "User is already in the session or is the host."
  })
  async joinHost(requestCtx: RequestWithUser, request: JoinHostRequestDto): Promise<JoinHostResponseDto> {
    try {
      await this.multiplayerService.joinHost(requestCtx.user.id, request.sessionUuid);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerUserAlreadyJoinedError) {
        throw new BadRequestException(error.message);
      }

      this.logger.error(`Error while joining host for user ID ${requestCtx.user.id} and session UUID ${request.sessionUuid}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new JoinHostResponseDto();
    responseDto.webrtcConfig = this.webrtcService.buildOffer();

    return responseDto;
  }

  @Patch("leave-host")
  @ApiOperation({ summary: "Leave a game host/session as a player" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully left the game session."
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Game session or user not found."
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "User is not part of the session or is the host."
  })
  async leaveHost(requestCtx: RequestWithUser, request: LeaveHostRequestDto): Promise<void> {
    try {
      await this.multiplayerService.leaveHost(requestCtx.user.id, request.sessionUuid);
    } catch (error) {
      if (error instanceof MultiplayerUserNotInSessionError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      }

      this.logger.error(`Error while leaving host for user ID ${requestCtx.user.id} and session UUID ${request.sessionUuid}`);
      this.logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }
  }
}
