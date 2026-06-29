import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { GameSessionEx, MultiplayerService } from "./multiplayer.service";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { ProjectNotFoundError } from "@project/project.error";
import { getExcerrMessage } from "src/util/errors";

import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerHostOpenedError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotInSessionError
} from "./multiplayer.error";

import { CreateGameSessionDto } from "./dto/create-game-session.dto";
import { UpdateGameSessionDto } from "./dto/update-game-session.dto";
import { JoinGameSessionDto } from "./dto/join-game-session.dto";
import { JoinByCodeDto } from "./dto/join-by-code.dto";
import { GameSessionConnectionResponseDto } from "./dto/game-session-connection.dto";
import {
  GameSessionListResponseDto,
  GameSessionResponseDto
} from "./dto/game-session.dto";

@ApiTags("game-sessions")
@ApiBearerAuth("JWT-auth")
@Controller("game-sessions")
@UseGuards(JwtAuthGuard)
export class MultiplayerController {
  private readonly _logger = new Logger(MultiplayerController.name);

  constructor(private readonly _multiplayerService: MultiplayerService) {}

  @Post()
  @ApiOperation({
    summary: "Create a new game session, with the caller as host"
  })
  @ApiBody({ type: CreateGameSessionDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: GameSessionConnectionResponseDto
  })
  async create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateGameSessionDto
  ): Promise<GameSessionConnectionResponseDto> {
    try {
      return await this._multiplayerService.create(req.user.id, dto);
    } catch (error) {
      this._rethrow(error, `create session for user ${req.user.id}`);
    }
  }

  // Declared before the ":sessionId" routes so "join-by-code" is never matched as
  // a session id.
  @Post("join-by-code")
  @ApiOperation({ summary: "Join an invite-code game session by its code" })
  @ApiBody({ type: JoinByCodeDto })
  @ApiResponse({
    status: HttpStatus.OK,
    type: GameSessionConnectionResponseDto
  })
  async joinByCode(
    @Req() req: RequestWithUser,
    @Body() dto: JoinByCodeDto
  ): Promise<GameSessionConnectionResponseDto> {
    try {
      return await this._multiplayerService.joinByCode(
        dto.joinCode,
        req.user.id,
        dto.editorTest
      );
    } catch (error) {
      this._rethrow(error, "join session by code");
    }
  }

  @Get()
  @ApiOperation({
    summary: "List game sessions for a project, from the caller's perspective"
  })
  @ApiResponse({ status: HttpStatus.OK, type: GameSessionListResponseDto })
  async list(
    @Req() req: RequestWithUser,
    @Query("projectId", ParseIntPipe) projectId: number
  ): Promise<GameSessionListResponseDto> {
    let sessions: GameSessionEx[];

    try {
      sessions = await this._multiplayerService.list(projectId, req.user.id);
    } catch (error) {
      this._rethrow(error, `list sessions for project ${projectId}`);
    }

    const response = new GameSessionListResponseDto();
    response.sessions = sessions.map((session) => this._toResponse(session));

    return response;
  }

  @Get(":sessionId")
  @ApiOperation({ summary: "Fetch a single game session" })
  @ApiResponse({ status: HttpStatus.OK, type: GameSessionResponseDto })
  async get(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string
  ): Promise<GameSessionResponseDto> {
    try {
      const session = await this._multiplayerService.get(
        sessionId,
        req.user.id
      );
      return this._toResponse(session);
    } catch (error) {
      this._rethrow(error, `get session ${sessionId}`);
    }
  }

  @Patch(":sessionId")
  @ApiOperation({ summary: "Update game session settings (host only)" })
  @ApiBody({ type: UpdateGameSessionDto })
  @ApiResponse({ status: HttpStatus.OK })
  async update(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: UpdateGameSessionDto
  ): Promise<void> {
    try {
      await this._multiplayerService.update(sessionId, req.user.id, dto);
    } catch (error) {
      this._rethrow(error, `update session ${sessionId}`);
    }
  }

  @Delete(":sessionId")
  @ApiOperation({ summary: "Close/delete a game session (host only)" })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string
  ): Promise<void> {
    try {
      await this._multiplayerService.delete(sessionId, req.user.id);
    } catch (error) {
      this._rethrow(error, `delete session ${sessionId}`);
    }
  }

  @Post(":sessionId/join")
  @ApiOperation({ summary: "Join a game session as a player" })
  @ApiBody({ type: JoinGameSessionDto })
  @ApiResponse({
    status: HttpStatus.OK,
    type: GameSessionConnectionResponseDto
  })
  async join(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: JoinGameSessionDto
  ): Promise<GameSessionConnectionResponseDto> {
    try {
      return await this._multiplayerService.join(
        sessionId,
        req.user.id,
        dto.joinCode,
        dto.editorTest
      );
    } catch (error) {
      this._rethrow(error, `join session ${sessionId}`);
    }
  }

  @Post(":sessionId/leave")
  @ApiOperation({ summary: "Leave a game session as a player" })
  @ApiResponse({ status: HttpStatus.OK })
  async leave(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string
  ): Promise<void> {
    try {
      await this._multiplayerService.leave(sessionId, req.user.id);
    } catch (error) {
      this._rethrow(error, `leave session ${sessionId}`);
    }
  }

  @Post(":sessionId/ticket")
  @ApiOperation({
    summary: "Mint a fresh connection ticket for the caller's session"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: GameSessionConnectionResponseDto
  })
  async refreshTicket(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string
  ): Promise<GameSessionConnectionResponseDto> {
    try {
      return await this._multiplayerService.refreshTicket(
        sessionId,
        req.user.id
      );
    } catch (error) {
      this._rethrow(error, `refresh ticket for session ${sessionId}`);
    }
  }

  // --------------------------------------------------------------------------

  private _toResponse(session: GameSessionEx): GameSessionResponseDto {
    const dto = new GameSessionResponseDto();

    dto.sessionUuid = session.sessionId;
    dto.title = session.title;
    dto.visibility = session.visibility;
    dto.hostId = session.hostId;
    dto.hostUsername = session.host.username;
    if (session.host.nickname) {
      dto.hostNickname = session.host.nickname;
    }
    dto.projectName = session.project.name;
    dto.maxPlayers = session.maxPlayers;
    // Prefer the live connected count (includes editor self-joins); fall back to
    // persisted membership when no WebRTC room is up.
    dto.playerCount =
      this._multiplayerService.connectedPlayerCount(session.sessionId) ||
      session.otherUsers.length + 1;

    return dto;
  }

  // Maps domain errors to HTTP exceptions; unknown errors become a 500.
  private _rethrow(error: unknown, context: string): never {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof MultiplayerGameSessionNotFoundError
    ) {
      throw new NotFoundException(error.message);
    }

    if (error instanceof MultiplayerForbiddenError) {
      throw new ForbiddenException(error.message);
    }

    if (
      error instanceof MultiplayerHostOpenedError ||
      error instanceof MultiplayerUserAlreadyJoinedError ||
      error instanceof MultiplayerSessionFullError
    ) {
      throw new ConflictException(error.message);
    }

    if (
      error instanceof MultiplayerInvalidJoinCodeError ||
      error instanceof MultiplayerUserNotInSessionError
    ) {
      throw new BadRequestException(error.message);
    }

    this._logger.error(`Error while trying to ${context}`);
    this._logger.error(error);

    throw new InternalServerErrorException(getExcerrMessage(error));
  }
}
