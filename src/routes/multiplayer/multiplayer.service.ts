import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { JwtService } from "@nestjs/jwt";
import {
  GameSession,
  GameSessionVisibility,
  Prisma,
  Project,
  User
} from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";
import { WebRTCService } from "@webrtc/webrtc.service";
import {
  SyncedGameTableRole,
  SyncedGameTableTicket,
  SyncedGameTableWebRTCServer
} from "@webrtc/server/webrtc.server.synced-game-table";

import { ProjectNotFoundError } from "@project/project.error";
import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerInvalidStateError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotInSessionError
} from "./multiplayer.error";

import { CreateGameSessionDto } from "./dto/create-game-session.dto";
import { UpdateGameSessionDto } from "./dto/update-game-session.dto";
import { GameSessionConnectionResponseDto } from "./dto/game-session-connection.dto";

import { randomBytes } from "crypto";

// Game session with the relations the listing/host operations need.
export type GameSessionEx = GameSession & {
  otherUsers: User[];
  host: User;
  project: Project;
};

const SESSION_RELATIONS = {
  otherUsers: true,
  host: true,
  project: true
} as const;

// Payload embedded in a connection ticket. `kind` disambiguates it from regular
// auth tokens that share the same signing secret.
interface GameTableTicketPayload {
  kind: "game-table";
  sessionId: string;
  userId: number;
  role: SyncedGameTableRole;
  maxPlayers: number;
}

@Injectable()
export class MultiplayerService {
  private static readonly JOIN_CODE_LENGTH = 8;
  private static readonly JOIN_CODE_ALPHABET =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  private static readonly TICKET_TTL = "60s";
  private static readonly MAX_DB_RETRIES = 5;
  // Backstop for sessions orphaned by an ungraceful server shutdown (the
  // heartbeat + host-disconnect hook handle the normal cases live).
  private static readonly MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;

  private readonly _logger = new Logger(MultiplayerService.name);
  private readonly _syncServer: SyncedGameTableWebRTCServer;

  constructor(
    private readonly _webrtcService: WebRTCService,
    private readonly _projectService: ProjectService,
    private readonly _prismaService: PrismaService,
    private readonly _jwtService: JwtService
  ) {
    this._syncServer = new SyncedGameTableWebRTCServer(
      _webrtcService,
      "Multiplayer",
      (raw) => this._verifyTicket(raw),
      // The host leaving (reload/disconnect/ping timeout) ends the session: it is
      // the sole authority, and there is no promotion.
      (sessionId) => void this.endSession(sessionId)
    );
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  async create(
    userId: number,
    dto: CreateGameSessionDto
  ): Promise<GameSessionConnectionResponseDto> {
    const project = await this._projectService.findOne(dto.projectId);
    if (!project) {
      throw new ProjectNotFoundError(
        `Project with ID ${dto.projectId} not found`
      );
    }

    // Re-hosting replaces the host's previous session for this project (e.g.
    // after an editor reload): end it and evict anyone still connected so the
    // developer can iterate without waiting for the old one to expire.
    const existing = await this._prismaService.gameSession.findFirst({
      where: { hostId: userId, projectId: dto.projectId, endedAt: null }
    });
    if (existing) {
      await this.endSession(existing.sessionId);
      this._syncServer.closeRoom(existing.sessionId);
    }

    const baseData = {
      hostId: userId,
      projectId: dto.projectId,
      title: dto.title,
      maxPlayers: dto.maxPlayers,
      visibility: dto.visibility
    };

    const created =
      dto.visibility === GameSessionVisibility.INVITE_CODE
        ? await this._withFreshJoinCode((joinCode) =>
          this._prismaService.gameSession.create({
            data: { ...baseData, joinCode }
          })
        )
        : await this._prismaService.gameSession.create({
          data: { ...baseData, joinCode: null }
        });

    return this._buildConnection(created, userId, "host");
  }

  async list(projectId: number, userId: number): Promise<GameSessionEx[]> {
    const sessions = await this._prismaService.gameSession.findMany({
      include: SESSION_RELATIONS,
      where: { projectId, endedAt: null }
    });

    const visible: GameSessionEx[] = [];

    sessions.forEach((session) => {
      switch (session.visibility) {
      case GameSessionVisibility.PUBLIC:
        visible.push(session);
        break;

      case GameSessionVisibility.FRIENDS_ONLY:
        // FIXME: friends system not implemented yet; hide friends-only sessions
        // from listings until areFriends() exists.
        // visible.push(session) when isFriend(userId, session.hostId)
        void userId;
        break;

      case GameSessionVisibility.INVITE_CODE:
        // Not discoverable through listing — joinable by code only.
        break;
      }
    });

    return visible;
  }

  async get(sessionId: string, userId: number): Promise<GameSessionEx> {
    const session = await this._findSessionOrThrow(sessionId);

    const isMember =
      session.hostId === userId ||
      session.otherUsers.some((user) => user.id === userId);

    // Non-public sessions are not discoverable by non-members. We 404 rather
    // than 403 so a known UUID doesn't confirm a session exists or leak its
    // title/host/player count. (FRIENDS_ONLY stays members-only until
    // areFriends() exists; INVITE_CODE is reachable through join-by-code only.)
    if (!isMember && session.visibility !== GameSessionVisibility.PUBLIC) {
      throw new MultiplayerGameSessionNotFoundError(
        `No game session found for UUID ${sessionId}`
      );
    }

    return session;
  }

  async update(
    sessionId: string,
    userId: number,
    dto: UpdateGameSessionDto
  ): Promise<GameSession> {
    const session = await this._findSessionOrThrow(sessionId);

    this._assertHost(session, userId);

    const data: Prisma.GameSessionUpdateInput = {};
    let needsFreshJoinCode = false;

    if (dto.title !== undefined) {
      data.title = dto.title;
    }
    if (dto.maxPlayers !== undefined) {
      data.maxPlayers = dto.maxPlayers;
    }
    if (dto.visibility !== undefined) {
      data.visibility = dto.visibility;

      if (dto.visibility === GameSessionVisibility.INVITE_CODE) {
        needsFreshJoinCode = !session.joinCode;
      } else {
        data.joinCode = null;
      }
    }

    if (needsFreshJoinCode) {
      return this._withFreshJoinCode((joinCode) =>
        this._prismaService.gameSession.update({
          where: { sessionId },
          data: { ...data, joinCode }
        })
      );
    }

    return this._prismaService.gameSession.update({
      where: { sessionId },
      data
    });
  }

  async delete(sessionId: string, userId: number): Promise<void> {
    const session = await this._findSessionOrThrow(sessionId);

    this._assertHost(session, userId);

    // Soft-end keeps history instead of hard-deleting the row.
    await this._softEnd(sessionId);
    this._syncServer.closeRoom(sessionId);
  }

  // Idempotent, so the host-disconnect hook and REST delete can both call it.
  async endSession(sessionId: string): Promise<void> {
    try {
      await this._softEnd(sessionId);
    } catch (err) {
      this._logger.error(`Failed to end session ${sessionId}: ${err}`);
    }
  }

  // Backstop sweep: ends sessions left active past the max lifetime, which can
  // only happen if the process died before its disconnect hooks ran.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reapStaleSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - MultiplayerService.MAX_SESSION_AGE_MS);

    const { count } = await this._prismaService.gameSession.updateMany({
      where: { endedAt: null, startedAt: { lt: cutoff } },
      data: { endedAt: new Date() }
    });

    if (count > 0) {
      this._logger.log(`Reaped ${count} stale game session(s)`);
    }
  }

  private async _softEnd(sessionId: string): Promise<void> {
    await this._prismaService.gameSession.updateMany({
      where: { sessionId, endedAt: null },
      data: { endedAt: new Date() }
    });
  }

  // --------------------------------------------------------------------------
  // Membership
  // --------------------------------------------------------------------------

  async join(
    sessionId: string,
    userId: number,
    joinCode?: string,
    editorTest = false
  ): Promise<GameSessionConnectionResponseDto> {
    const session = await this._findSessionOrThrow(sessionId);

    const isMember =
      session.hostId === userId ||
      session.otherUsers.some((user) => user.id === userId);

    if (isMember) {
      // The game editor opts in (editorTest) so a developer can open a second
      // client as a distinct synthetic player and test multiplayer alone; the
      // published game viewer never sends the flag, so normal "already a member"
      // blocking applies. This is self-scoped and safe in any environment: it only
      // ever adds a player to a session you already belong to, the synthetic id is
      // never persisted (no such User row), and the WS layer still caps it against
      // maxPlayers.
      if (editorTest) {
        return this._buildConnection(session, this._syntheticSlaveId(), "slave");
      }

      throw new MultiplayerUserAlreadyJoinedError(
        session.hostId === userId
          ? "User is the host of this game session"
          : "User has already joined this game session"
      );
    }

    switch (session.visibility) {
    case GameSessionVisibility.INVITE_CODE:
      if (!joinCode || joinCode !== session.joinCode) {
        throw new MultiplayerInvalidJoinCodeError("Invalid join code");
      }
      break;

    case GameSessionVisibility.FRIENDS_ONLY:
      // FIXME: friends system not implemented yet; deny until areFriends() exists.
      throw new MultiplayerForbiddenError(
        "Friends-only game sessions cannot be joined yet"
      );

    case GameSessionVisibility.PUBLIC:
      break;
    }

    // Re-check capacity and connect atomically: a plain read-then-write would
    // let concurrent joiners both pass the check and overflow maxPlayers.
    await this._retryOnSerializationFailure(() =>
      this._prismaService.$transaction(
        async (tx) => {
          const fresh = await tx.gameSession.findUnique({
            where: { sessionId },
            include: { otherUsers: true }
          });

          if (!fresh) {
            throw new MultiplayerGameSessionNotFoundError(
              `No game session found for UUID ${sessionId}`
            );
          }
          if (fresh.otherUsers.some((user) => user.id === userId)) {
            return;
          }
          // Host counts toward maxPlayers.
          if (fresh.otherUsers.length + 1 >= fresh.maxPlayers) {
            throw new MultiplayerSessionFullError("Game session is full");
          }

          await tx.gameSession.update({
            where: { sessionId },
            data: { otherUsers: { connect: { id: userId } } }
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );

    return this._buildConnection(session, userId, "slave");
  }

  // Resolve an invite-code session by its code, then join it. Lets a player join
  // without first knowing the (non-discoverable) session UUID.
  async joinByCode(
    joinCode: string,
    userId: number,
    editorTest = false
  ): Promise<GameSessionConnectionResponseDto> {
    const session = await this._prismaService.gameSession.findFirst({
      where: { joinCode, endedAt: null }
    });

    if (!session) {
      throw new MultiplayerInvalidJoinCodeError("Invalid join code");
    }

    return this.join(session.sessionId, userId, joinCode, editorTest);
  }

  // Mint a fresh connection ticket for a member of the session (host or slave),
  // so a client can reconnect after the short-lived ticket expires.
  async refreshTicket(
    sessionId: string,
    userId: number
  ): Promise<GameSessionConnectionResponseDto> {
    const session = await this._findSessionOrThrow(sessionId);

    return this._buildConnection(session, userId, this._roleOf(session, userId));
  }

  async leave(sessionId: string, userId: number): Promise<void> {
    const session = await this._findSessionOrThrow(sessionId);

    if (session.hostId === userId) {
      throw new MultiplayerUserNotInSessionError(
        "The host cannot leave; delete the session instead"
      );
    }
    if (!session.otherUsers.some((user) => user.id === userId)) {
      throw new MultiplayerUserNotInSessionError(
        "User is not part of this game session"
      );
    }

    await this._prismaService.gameSession.update({
      where: { sessionId },
      data: { otherUsers: { disconnect: { id: userId } } }
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async _findSessionOrThrow(sessionId: string): Promise<GameSessionEx> {
    // Ended sessions are treated as gone for every membership/host operation.
    const session = await this._prismaService.gameSession.findFirst({
      where: { sessionId, endedAt: null },
      include: SESSION_RELATIONS
    });

    if (!session) {
      throw new MultiplayerGameSessionNotFoundError(
        `No game session found for UUID ${sessionId}`
      );
    }

    return session;
  }

  // Negative ids never collide with real (positive, auto-increment) user ids, so
  // an editor self-join behaves as a separate player without polluting the User
  // table or the room's userId keying.
  private _syntheticSlaveId(): number {
    return -(1 + (randomBytes(4).readUInt32BE(0) % 2_000_000_000));
  }

  private _assertHost(session: GameSession, userId: number): void {
    if (session.hostId !== userId) {
      throw new MultiplayerForbiddenError(
        "Only the host can perform this action"
      );
    }
  }

  private _roleOf(
    session: GameSessionEx,
    userId: number
  ): SyncedGameTableRole {
    if (session.hostId === userId) {
      return "host";
    }
    if (session.otherUsers.some((user) => user.id === userId)) {
      return "slave";
    }

    throw new MultiplayerUserNotInSessionError(
      "User is not part of this game session"
    );
  }

  private _buildConnection(
    session: GameSession,
    userId: number,
    role: SyncedGameTableRole
  ): GameSessionConnectionResponseDto {
    const response = new GameSessionConnectionResponseDto();

    response.sessionUuid = session.sessionId;
    response.playerId = userId;
    response.webrtcConfig = this._webrtcService.buildOffer(this._syncServer);
    response.connectionTicket = this._mintTicket(
      session.sessionId,
      userId,
      role,
      session.maxPlayers
    );

    if (
      role === "host" &&
      session.visibility === GameSessionVisibility.INVITE_CODE &&
      session.joinCode
    ) {
      response.joinCode = session.joinCode;
    }

    return response;
  }

  private _mintTicket(
    sessionId: string,
    userId: number,
    role: SyncedGameTableRole,
    maxPlayers: number
  ): string {
    const payload: GameTableTicketPayload = {
      kind: "game-table",
      sessionId,
      userId,
      role,
      maxPlayers
    };

    return this._jwtService.sign(payload, {
      expiresIn: MultiplayerService.TICKET_TTL
    });
  }

  private _verifyTicket(raw: string): SyncedGameTableTicket {
    const payload =
      this._jwtService.verify<Partial<GameTableTicketPayload>>(raw);

    if (
      payload.kind !== "game-table" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.userId !== "number" ||
      typeof payload.maxPlayers !== "number" ||
      (payload.role !== "host" && payload.role !== "slave")
    ) {
      throw new MultiplayerInvalidStateError("Malformed game-table ticket");
    }

    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
      role: payload.role,
      maxPlayers: payload.maxPlayers
    };
  }

  // Regenerates the code on a unique-constraint violation so concurrent invite
  // creations that happen to pick the same code don't fail.
  private async _withFreshJoinCode<T>(
    op: (joinCode: string) => Promise<T>
  ): Promise<T> {
    for (
      let attempt = 0;
      attempt < MultiplayerService.MAX_DB_RETRIES;
      attempt++
    ) {
      try {
        return await op(this._randomJoinCode());
      } catch (err) {
        if (
          this._isJoinCodeConflict(err) &&
          attempt < MultiplayerService.MAX_DB_RETRIES - 1
        ) {
          continue;
        }
        throw err;
      }
    }

    throw new MultiplayerInvalidStateError(
      "Failed to generate a unique join code"
    );
  }

  // Retries `op` on a serialization conflict (P2034), which is the expected,
  // recoverable outcome of two Serializable transactions racing to join.
  private async _retryOnSerializationFailure<T>(
    op: () => Promise<T>
  ): Promise<T> {
    for (
      let attempt = 0;
      attempt < MultiplayerService.MAX_DB_RETRIES;
      attempt++
    ) {
      try {
        return await op();
      } catch (err) {
        const conflict =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2034";

        if (conflict && attempt < MultiplayerService.MAX_DB_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    throw new MultiplayerInvalidStateError("Exhausted transaction retries");
  }

  private _isJoinCodeConflict(err: unknown): boolean {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== "P2002"
    ) {
      return false;
    }

    return JSON.stringify(err.meta?.["target"] ?? "").includes("joinCode");
  }

  private _randomJoinCode(): string {
    const { JOIN_CODE_LENGTH, JOIN_CODE_ALPHABET } = MultiplayerService;
    const bytes = randomBytes(JOIN_CODE_LENGTH);

    let code = "";
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
      code += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
    }

    return code;
  }
}
