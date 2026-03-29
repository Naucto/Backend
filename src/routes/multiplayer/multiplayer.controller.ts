import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GameSessionEx, MultiplayerService } from "./multiplayer.service";
import { WebRTCService } from "@webrtc/webrtc.service";
import { WebRTCServer } from "@webrtc/server/webrtc.server";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { GameSession } from "@prisma/client";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { ProjectNotFoundError } from "@project/project.error";

import { OpenHostRequestDto, OpenHostResponseDto } from "./dto/open-host.dto";
import { LookupHostsResponseDto, LookupHostsResponseDtoHost } from "./dto/lookup-hosts.dto";
import {
  MultiplayerHostNotFoundError,
  MultiplayerHostOpenedError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserDoesNotExistError,
  MultiplayerUserNotInSessionError
} from "./multiplayer.error";
import { CloseHostRequestDto } from "./dto/close-host.dto";
import { getExcerrMessage as getExcerrMessage } from "src/util/errors";
import { JoinHostRequestDto, JoinHostResponseDto } from "./dto/join-host.dto";
import { LeaveHostRequestDto } from "./dto/leave-host.dto";

@ApiTags("multiplayer")
@Controller("multiplayer")
@UseGuards(JwtAuthGuard)
export class MultiplayerController {
  private readonly _logger = new Logger(MultiplayerController.name);

  // FIXME: use a more concrete, derived type
  private readonly _multiplayerServer = new WebRTCServer("Multiplayer");

  constructor(
    private readonly _multiplayerService: MultiplayerService,
    private readonly _webrtcService: WebRTCService
  ) {}

  @Get("list-hosts")
  @ApiOperation({ summary: "List available game hosts/sessions from the user's perspective" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "A list of available game hosts is returned.",
    type: LookupHostsResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Bad request (wrong project ID)."
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Unhandled server error."
  })
  async lookupHosts(
    @Req() requestCtx: RequestWithUser,
    @Body() request: { projectId: number }
  ): Promise<LookupHostsResponseDto>
  {
    let hosts: GameSessionEx[];

    try {
      hosts = await this._multiplayerService.lookupHosts(request.projectId, requestCtx.user.id);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new BadRequestException(error.message);
      }

      this._logger.error(`Error while looking up hosts for project ID ${request.projectId}`);
      this._logger.error(error);

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
  @ApiBody({ type: OpenHostRequestDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "The game host/session has been successfully opened.",
    type: OpenHostResponseDto
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
  async openHost(
    @Req() requestCtx: RequestWithUser,
    @Body() request: OpenHostRequestDto
  ): Promise<OpenHostResponseDto>
  {
    let gameSession: GameSession;

    try {
      gameSession = await this._multiplayerService.openHost(requestCtx.user.id, request.projectId, request.visibility);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerHostOpenedError) {
        // FIXME: Should the user be able to open multiple hosts for the same project?
        throw new BadRequestException(error.message);
      }

      this._logger.error(`Error while opening host for user ID ${requestCtx.user.id} and project ID ${request.projectId}`);
      this._logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new OpenHostResponseDto();
    responseDto.sessionUuid = gameSession.sessionId;
    responseDto.webrtcConfig = this._webrtcService.buildOffer(this._multiplayerServer);

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
  async closeHost(
    @Req() requestCtx: RequestWithUser,
    @Body() request: CloseHostRequestDto
  ): Promise<void> {
    try {
      await this._multiplayerService.closeHost(requestCtx.user.id, request.projectId);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof ProjectNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerHostNotFoundError) {
        throw new BadRequestException(error.message);
      }

      this._logger.error(`Error while closing host for user ID ${requestCtx.user.id} and project ID ${request.projectId}`);
      this._logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }
  }

  @Patch("join-host")
  @ApiOperation({ summary: "Join an existing game host/session as a player" })
  @ApiBody({ type: JoinHostRequestDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Successfully joined the game session.",
    type: JoinHostResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Game session or user not found."
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "User is already in the session or is the host."
  })
  async joinHost(
    @Req() requestCtx: RequestWithUser,
    @Body() request: JoinHostRequestDto
  ): Promise<JoinHostResponseDto> {
    try {
      await this._multiplayerService.joinHost(requestCtx.user.id, request.sessionUuid);
    } catch (error) {
      if (error instanceof MultiplayerUserDoesNotExistError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      } else if (error instanceof MultiplayerUserAlreadyJoinedError) {
        throw new BadRequestException(error.message);
      }

      this._logger.error(`Error while joining host for user ID ${requestCtx.user.id} and session UUID ${request.sessionUuid}`);
      this._logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }

    const responseDto = new JoinHostResponseDto();
    responseDto.webrtcConfig = this._webrtcService.buildOffer(this._multiplayerServer);

    return responseDto;
  }

  @Patch("leave-host")
  @ApiOperation({ summary: "Leave a game host/session as a player" })
  @ApiBody({ type: LeaveHostRequestDto })
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
  async leaveHost(
    @Req() requestCtx: RequestWithUser,
    @Body() request: LeaveHostRequestDto
  ): Promise<void> {
    try {
      await this._multiplayerService.leaveHost(requestCtx.user.id, request.sessionUuid);
    } catch (error) {
      if (error instanceof MultiplayerUserNotInSessionError ||
          error instanceof MultiplayerHostNotFoundError) {
        throw new NotFoundException(error.message);
      }

      this._logger.error(`Error while leaving host for user ID ${requestCtx.user.id} and session UUID ${request.sessionUuid}`);
      this._logger.error(error);

      throw new InternalServerErrorException(getExcerrMessage(error));
    }
  }
}
