import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { GameSessionListResponseDto, GameSessionResponseDto } from './dto/game-session.dto';
import { GameSessionConnectionResponseDto } from './dto/game-session-connection.dto';
import { InviteToSessionDto } from './dto/invite-to-session.dto';
import { JoinByCodeDto } from './dto/join-by-code.dto';
import { JoinGameSessionDto } from './dto/join-game-session.dto';
import { RefreshTicketDto } from './dto/refresh-ticket.dto';
import { SessionRosterResponseDto } from './dto/session-roster.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { GameSessionEx, MultiplayerService } from './multiplayer.service';
import { MultiplayerExceptionFilter } from './multiplayer-exception.filter';

@ApiTags('game-sessions')
@Controller('game-sessions')
@RequiresAuth()
@UseFilters(MultiplayerExceptionFilter)
export class MultiplayerController {
  constructor(private readonly _multiplayerService: MultiplayerService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new game session, with the caller as host',
  })
  @ApiBody({ type: CreateGameSessionDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: GameSessionConnectionResponseDto,
  })
  async create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateGameSessionDto,
  ): Promise<GameSessionConnectionResponseDto> {
    return this._multiplayerService.create(req.user.id, dto);
  }

  @Post('join-by-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join an invite-code game session by its code' })
  @ApiBody({ type: JoinByCodeDto })
  @ApiResponse({
    status: HttpStatus.OK,
    type: GameSessionConnectionResponseDto,
  })
  async joinByCode(
    @Req() req: RequestWithUser,
    @Body() dto: JoinByCodeDto,
  ): Promise<GameSessionConnectionResponseDto> {
    return this._multiplayerService.joinByCode(dto.joinCode, req.user.id, dto.editorTest);
  }

  @Get()
  @ApiOperation({
    summary: "List open game sessions from the caller's perspective, one game's or every game's",
  })
  @ApiQuery({ name: 'projectId', type: 'number', required: false })
  @ApiQuery({
    name: 'q',
    type: 'string',
    required: false,
    description: 'Narrow to sessions whose room or game name holds this',
  })
  @ApiResponse({ status: HttpStatus.OK, type: GameSessionListResponseDto })
  async list(
    @Req() req: RequestWithUser,
    @Query('projectId', new ParseIntPipe({ optional: true })) projectId?: number,
    @Query('q') query?: string,
  ): Promise<GameSessionListResponseDto> {
    const sessions = await this._multiplayerService.list(projectId, req.user.id, query);

    const response = new GameSessionListResponseDto();
    response.sessions = sessions.map((session) => this._toResponse(session));

    return response;
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Fetch a single game session' })
  @ApiResponse({ status: HttpStatus.OK, type: GameSessionResponseDto })
  async get(
    @Req() req: RequestWithUser,
    @Param('sessionId') sessionId: string,
  ): Promise<GameSessionResponseDto> {
    const session = await this._multiplayerService.get(sessionId, req.user.id);
    return this._toResponse(session);
  }

  @Get(':sessionId/players')
  @ApiOperation({ summary: 'Who is in a game session' })
  @ApiResponse({ status: HttpStatus.OK, type: SessionRosterResponseDto })
  async players(
    @Req() req: RequestWithUser,
    @Param('sessionId') sessionId: string,
  ): Promise<SessionRosterResponseDto> {
    return this._multiplayerService.roster(sessionId, req.user.id);
  }

  @Post(':sessionId/invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invite someone to a session (host only)' })
  @ApiBody({ type: InviteToSessionDto })
  @ApiResponse({ status: HttpStatus.OK })
  async invite(
    @Req() req: RequestWithUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: InviteToSessionDto,
  ): Promise<void> {
    await this._multiplayerService.invite(sessionId, req.user.id, dto.userId);
  }

  @Patch(':sessionId')
  @ApiOperation({ summary: 'Update game session settings (host only)' })
  @ApiBody({ type: UpdateGameSessionDto })
  @ApiResponse({ status: HttpStatus.OK })
  async update(
    @Req() req: RequestWithUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateGameSessionDto,
  ): Promise<void> {
    await this._multiplayerService.update(sessionId, req.user.id, dto);
  }

  @Delete(':sessionId')
  @ApiOperation({ summary: 'Close/delete a game session (host only)' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Req() req: RequestWithUser, @Param('sessionId') sessionId: string): Promise<void> {
    await this._multiplayerService.delete(sessionId, req.user.id);
  }

  @Post(':sessionId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join a game session as a player' })
  @ApiBody({ type: JoinGameSessionDto })
  @ApiResponse({
    status: HttpStatus.OK,
    type: GameSessionConnectionResponseDto,
  })
  async join(
    @Req() req: RequestWithUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: JoinGameSessionDto,
  ): Promise<GameSessionConnectionResponseDto> {
    return this._multiplayerService.join(sessionId, req.user.id, dto.joinCode, dto.editorTest);
  }

  @Post(':sessionId/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a game session as a player' })
  @ApiResponse({ status: HttpStatus.OK })
  async leave(@Req() req: RequestWithUser, @Param('sessionId') sessionId: string): Promise<void> {
    await this._multiplayerService.leave(sessionId, req.user.id);
  }

  @Post(':sessionId/ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Mint a fresh connection ticket for the caller's session",
  })
  @ApiBody({ type: RefreshTicketDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    type: GameSessionConnectionResponseDto,
  })
  async refreshTicket(
    @Req() req: RequestWithUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: RefreshTicketDto,
  ): Promise<GameSessionConnectionResponseDto> {
    return this._multiplayerService.refreshTicket(sessionId, req.user.id, dto.ticket);
  }

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
    dto.projectId = session.projectId;
    dto.projectName = session.project.publishedName || session.project.name;
    dto.maxPlayers = session.maxPlayers;
    // Prefer the live connected count (includes editor self-joins); fall back to
    // persisted membership when no WebRTC room is up.
    dto.playerCount =
      this._multiplayerService.connectedPlayerCount(session.sessionId) ||
      session.otherUsers.length + 1;

    return dto;
  }
}
