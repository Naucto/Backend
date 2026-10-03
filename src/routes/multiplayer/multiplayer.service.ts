import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { JwtService, JwtVerifyOptions } from "@nestjs/jwt";
import {
  GameSession,
  GameSessionVisibility,
  Prisma,
  SessionJoinPolicy
} from "@prisma/client";
import { NotificationsService } from "src/notifications/notifications.service";
import { FriendsService } from "@friends/friends.service";
import { PrismaService, isUniqueViolation } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";
import { WebRTCService } from "@webrtc/webrtc.service";
import {
  SyncedGameTableRole,
  SyncedGameTableTicket,
  SyncedGameTableWebRTCServer
} from "@webrtc/server/webrtc.server.synced-game-table";

import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerInvalidStateError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotFoundError,
  MultiplayerUserNotInSessionError
} from "./multiplayer.error";

import { CreateGameSessionDto } from "./dto/create-game-session.dto";
import { UpdateGameSessionDto } from "./dto/update-game-session.dto";
import { GameSessionConnectionResponseDto } from "./dto/game-session-connection.dto";
import { SessionRosterResponseDto } from "./dto/session-roster.dto";

import { randomBytes } from "crypto";

const PLAYER_SELECT = { id: true, username: true, nickname: true } as const;

const SESSION_RELATIONS = {
  otherUsers: { select: PLAYER_SELECT },
  host: { select: PLAYER_SELECT },
  project: { select: { name: true, publishedName: true } }
} as const;

export type GameSessionEx = Prisma.GameSessionGetPayload<{
  include: typeof SESSION_RELATIONS;
}>;

// Payload embedded in a connection ticket. `kind` disambiguates it from regular
// auth tokens that share the same signing secret.
type GameTableTicketPayload = SyncedGameTableTicket & { kind: "game-table" };

@Injectable()
export class MultiplayerService {
  private static readonly JOIN_CODE_LENGTH = 8;
  private static readonly JOIN_CODE_ALPHABET =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  private static readonly TICKET_TTL = "60s";
  private static readonly VISIBILITY_RANK: Record<GameSessionVisibility, number> = {
    [GameSessionVisibility.PUBLIC]: 0,
    [GameSessionVisibility.FRIENDS_ONLY]: 1,
    [GameSessionVisibility.INVITE_CODE]: 2
  };
  private static readonly POLICY_FLOOR: Record<SessionJoinPolicy, GameSessionVisibility> = {
    [SessionJoinPolicy.ANYONE]: GameSessionVisibility.PUBLIC,
    [SessionJoinPolicy.FRIENDS]: GameSessionVisibility.FRIENDS_ONLY,
    [SessionJoinPolicy.CODE_ONLY]: GameSessionVisibility.INVITE_CODE
  };
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
    private readonly _jwtService: JwtService,
    private readonly _friendsService: FriendsService,
    private readonly _notifications: NotificationsService
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

  async create(
    userId: number,
    dto: CreateGameSessionDto
  ): Promise<GameSessionConnectionResponseDto> {
    const project = await this._projectService.findOne(dto.projectId);

    if (
      !project.publishedAt &&
      project.creator.id !== userId &&
      !project.collaborators.some((collaborator) => collaborator.id === userId)
    ) {
      throw new MultiplayerForbiddenError(
        "Only its collaborators can host an unpublished project"
      );
    }

    // A host has one open session per project: hosting again, as an editor reload does, replaces the previous one.
    const existing = await this._prismaService.gameSession.findFirst({
      where: { hostId: userId, projectId: dto.projectId, endedAt: null }
    });
    if (existing) {
      await this.endSession(existing.sessionId);
      this._syncServer.closeRoom(existing.sessionId);
    }

    const visibility = await this._applyHostPolicy(userId, dto.visibility);

    const baseData = {
      hostId: userId,
      projectId: dto.projectId,
      title: dto.title,
      maxPlayers: dto.maxPlayers,
      visibility
    };

    const created =
      visibility === GameSessionVisibility.INVITE_CODE
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

  /** Open sessions the caller may see: one game's when a project is named, every game's otherwise, narrowed to those whose title or game name contains `search`. */
  async list(
    projectId: number | undefined,
    userId: number,
    search?: string
  ): Promise<GameSessionEx[]> {
    const term = search?.trim();
    const contains = { contains: term ?? "", mode: "insensitive" } as const;

    const sessions = await this._prismaService.gameSession.findMany({
      include: SESSION_RELATIONS,
      where: {
        endedAt: null,
        ...(projectId === undefined ? {} : { projectId }),
        ...(term
          ? {
            OR: [
              { title: contains },
              { project: { publishedName: contains } },
              { project: { name: contains } }
            ]
          }
          : {})
      }
    });

    const friendIds = new Set(await this._friendsService.friendIdsOf(userId));
    const visible: GameSessionEx[] = [];

    for (const session of sessions) {
      switch (session.visibility) {
      case GameSessionVisibility.PUBLIC:
        visible.push(session);
        break;

      case GameSessionVisibility.FRIENDS_ONLY:
        if (this._isMember(session, userId) || friendIds.has(session.hostId)) {
          visible.push(session);
        }
        break;

      case GameSessionVisibility.INVITE_CODE:
        // Not discoverable through listing — joinable by code only.
        break;
      }
    }

    return visible;
  }

  // Live connected-player count (host + slaves) from the WebRTC room, so the
  // figure includes editor self-joins that aren't persisted as members.
  connectedPlayerCount(sessionId: string): number {
    return this._syncServer.connectedCount(sessionId);
  }

  async get(sessionId: string, userId: number): Promise<GameSessionEx> {
    const session = await this._findSessionOrThrow(sessionId);

    const isMember = this._isMember(session, userId);

    // Not-found rather than forbidden, so a known UUID does not confirm that a hidden session exists.
    if (!isMember && !(await this._canDiscover(session, userId))) {
      throw new MultiplayerGameSessionNotFoundError(
        `No game session found for UUID ${sessionId}`
      );
    }

    return session;
  }

  /**
   * Who is in the session, host first. Reuses `get`, so the same visibility rule applies: a
   * non-member of a non-discoverable session gets a 404, not a roster.
   */
  async roster(
    sessionId: string,
    userId: number
  ): Promise<SessionRosterResponseDto> {
    const session = await this.get(sessionId, userId);

    return {
      players: [
        {
          userId: session.host.id,
          username: session.host.username,
          nickname: session.host.nickname,
          host: true
        },
        ...session.otherUsers.map((u) => ({
          userId: u.id,
          username: u.username,
          nickname: u.nickname,
          host: false
        }))
      ],
      maxPlayers: session.maxPlayers
    };
  }

  /** Notifies the invitee that the host invited them to the session. */
  async invite(
    sessionId: string,
    hostId: number,
    inviteeId: number
  ): Promise<void> {
    const session = await this._findSessionOrThrow(sessionId);

    this._assertHost(session, hostId);

    if (inviteeId === hostId) return;

    const invitee = await this._prismaService.user.findUnique({
      where: { id: inviteeId },
      select: { deletedAt: true }
    });

    if (!invitee || invitee.deletedAt) {
      throw new MultiplayerUserNotFoundError(
        `No user found for ID ${inviteeId}`
      );
    }

    // An invitation carries text the host wrote, so it only reaches someone the host has a tie with.
    const tied =
      (await this._friendsService.areFriends(hostId, inviteeId)) ||
      (await this._prismaService.project.count({
        where: {
          id: session.projectId,
          OR: [
            { userId: inviteeId },
            { collaborators: { some: { id: inviteeId } } }
          ]
        }
      })) > 0;

    if (!tied) {
      throw new MultiplayerForbiddenError(
        "Only a friend or someone who works on the game can be invited"
      );
    }

    await this._notifications.createNotification({
      userId: inviteeId,
      title: session.title,
      message: `${session.host.nickname ?? session.host.username} invited you to play ${session.project.publishedName || session.project.name}`,
      type: "INFO",
      kind: "GENERIC",
      // The code is what turns the notification into a way in; without it the invitee can see
      // there is a session and still not reach it.
      data: {
        sessionId: session.sessionId,
        joinCode: session.joinCode ?? undefined,
        projectId: session.projectId
      }
    });
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
      const visibility = await this._applyHostPolicy(userId, dto.visibility);
      data.visibility = visibility;

      // A join code lives as long as its session, so the one the host already shared keeps working while the session is listed.
      needsFreshJoinCode =
        visibility === GameSessionVisibility.INVITE_CODE && !session.joinCode;
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

  // Idempotent, and never throws: a failure is logged, because the disconnect callback that runs it is not awaited.
  async endSession(sessionId: string): Promise<void> {
    try {
      await this._softEnd(sessionId);
    } catch (err) {
      this._logger.error(`Failed to end session ${sessionId}: ${err}`);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reapStaleSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - MultiplayerService.MAX_SESSION_AGE_MS);

    const candidates = await this._prismaService.gameSession.findMany({
      where: { endedAt: null, startedAt: { lt: cutoff } },
      select: { sessionId: true }
    });

    // Age alone also matches a long-running session whose room is still live; ending its row would desync it from that room.
    const orphaned = candidates.filter(
      (session) => this.connectedPlayerCount(session.sessionId) === 0
    );

    if (orphaned.length === 0) {
      return;
    }

    await this._prismaService.gameSession.updateMany({
      where: { sessionId: { in: orphaned.map((session) => session.sessionId) } },
      data: { endedAt: new Date() }
    });

    orphaned.forEach((session) =>
      this._syncServer.closeRoom(session.sessionId)
    );

    this._logger.log(`Reaped ${orphaned.length} stale game session(s)`);
  }

  async join(
    sessionId: string,
    userId: number,
    joinCode?: string,
    editorTest = false
  ): Promise<GameSessionConnectionResponseDto> {
    const session = await this._findSessionOrThrow(sessionId);

    if (this._isMember(session, userId)) {
      // Membership outlives a connection, so a member who comes back is handed a new one for the seat they already hold.
      if (session.hostId !== userId) {
        return this._buildConnection(session, userId, "slave");
      }

      // Host only: any other member could mint synthetic players without limit and fill the session against real ones.
      if (editorTest) {
        return this._buildConnection(session, this._syntheticSlaveId(), "slave");
      }

      throw new MultiplayerUserAlreadyJoinedError(
        "User is the host of this game session"
      );
    }

    switch (session.visibility) {
    case GameSessionVisibility.INVITE_CODE:
      if (!joinCode || joinCode !== session.joinCode) {
        throw new MultiplayerInvalidJoinCodeError("Invalid join code");
      }
      break;

    case GameSessionVisibility.FRIENDS_ONLY:
      if (!(await this._friendsService.areFriends(userId, session.hostId))) {
        throw new MultiplayerForbiddenError(
          "Only the host's friends can join this game session"
        );
      }
      break;

    case GameSessionVisibility.PUBLIC:
      break;
    }

    // Re-check capacity and connect atomically: a plain read-then-write would
    // let concurrent joiners both pass the check and overflow maxPlayers.
    await this._retry(
      () => this._prismaService.$transaction(
        async (tx) => {
          const fresh = await tx.gameSession.findUnique({
            where: { sessionId },
            include: { otherUsers: { select: { id: true } } }
          });

          if (!fresh || fresh.endedAt) {
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
      ),
      // A serialization conflict (P2034) is the expected, recoverable outcome of
      // two Serializable transactions racing to join.
      (err) =>
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034",
      "Exhausted transaction retries"
    );

    return this._buildConnection(session, userId, "slave");
  }

  // Lets a player in without knowing the session UUID, which a hidden session never reveals.
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

  // The host's editor self-join plays under a synthetic id that no account lookup can recover, so that seat alone is
  // carried over from the ticket being replaced; every other seat is minted from the caller's account, whichever ticket
  // is presented.
  async refreshTicket(
    sessionId: string,
    userId: number,
    ticket?: string
  ): Promise<GameSessionConnectionResponseDto> {
    const session = await this._findSessionOrThrow(sessionId);
    const accountRole = this._roleOf(session, userId);
    const previous =
      ticket === undefined
        ? null
        : this._replacedTicket(ticket, session.sessionId);

    if (
      previous &&
      accountRole === "host" &&
      previous.role === "slave" &&
      !this._isMember(session, previous.userId)
    ) {
      return this._buildConnection(session, previous.userId, previous.role);
    }

    return this._buildConnection(session, userId, accountRole);
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

  private async _softEnd(sessionId: string): Promise<void> {
    await this._prismaService.gameSession.updateMany({
      where: { sessionId, endedAt: null },
      data: { endedAt: new Date() }
    });
  }

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

  // A random positive 31-bit id for an editor self-join. The wide range makes a
  // clash with a real (small, auto-increment) user id — or another self-join —
  // negligible. It is never persisted (no User row): it only keys the WebRTC room
  // and surfaces as net.id().
  private _syntheticSlaveId(): number {
    return (randomBytes(4).readUInt32BE(0) & 0x7fffffff) || 1;
  }

  private async _canDiscover(
    session: GameSessionEx,
    userId: number
  ): Promise<boolean> {
    switch (session.visibility) {
    case GameSessionVisibility.PUBLIC:
      return true;
    case GameSessionVisibility.FRIENDS_ONLY:
      return this._friendsService.areFriends(userId, session.hostId);
    case GameSessionVisibility.INVITE_CODE:
      return false;
    }
  }

  // The host's account-level join policy is a floor on session visibility; a stricter per-session choice is kept.
  private async _applyHostPolicy(
    hostId: number,
    requested: GameSessionVisibility
  ): Promise<GameSessionVisibility> {
    const host = await this._prismaService.user.findUnique({
      where: { id: hostId },
      select: { sessionJoinPolicy: true }
    });

    const floor = MultiplayerService.POLICY_FLOOR[
      host?.sessionJoinPolicy ?? SessionJoinPolicy.ANYONE
    ];

    return MultiplayerService.VISIBILITY_RANK[requested] >=
      MultiplayerService.VISIBILITY_RANK[floor]
      ? requested
      : floor;
  }

  private _isMember(session: GameSessionEx, userId: number): boolean {
    return (
      session.hostId === userId ||
      session.otherUsers.some((user) => user.id === userId)
    );
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
    if (this._isMember(session, userId)) {
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

  // Expiry is what a refresh is for, so only the signature and the session are
  // asked to match; anything else falls back to the caller's account.
  private _replacedTicket(
    raw: string,
    sessionId: string
  ): SyncedGameTableTicket | null {
    try {
      const ticket = this._verifyTicket(raw, { ignoreExpiration: true });

      return ticket.sessionId === sessionId ? ticket : null;
    } catch {
      return null;
    }
  }

  private _verifyTicket(
    raw: string,
    options?: JwtVerifyOptions
  ): SyncedGameTableTicket {
    const payload = this._jwtService.verify<Partial<GameTableTicketPayload>>(
      raw,
      options
    );

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

  // Draws another code when the one drawn is taken; `op` must write no other unique value, because any
  // unique-constraint violation is read as a taken code.
  private async _withFreshJoinCode<T>(
    op: (joinCode: string) => Promise<T>
  ): Promise<T> {
    return this._retry(
      () => op(this._randomJoinCode()),
      isUniqueViolation,
      "Failed to generate a unique join code"
    );
  }

  private async _retry<T>(
    op: () => Promise<T>,
    isRetryable: (err: unknown) => boolean,
    exhaustedMessage: string
  ): Promise<T> {
    for (
      let attempt = 0;
      attempt < MultiplayerService.MAX_DB_RETRIES;
      attempt++
    ) {
      try {
        return await op();
      } catch (err) {
        if (!isRetryable(err)) {
          throw err;
        }
      }
    }

    throw new MultiplayerInvalidStateError(exhaustedMessage);
  }

  private _randomJoinCode(): string {
    const { JOIN_CODE_LENGTH, JOIN_CODE_ALPHABET } = MultiplayerService;
    const alphabetLength = JOIN_CODE_ALPHABET.length;
    const maxUnbiasedByte = Math.floor(256 / alphabetLength) * alphabetLength;

    let code = "";
    while (code.length < JOIN_CODE_LENGTH) {
      const bytes = randomBytes(JOIN_CODE_LENGTH - code.length);
      for (const byte of bytes) {
        if (byte >= maxUnbiasedByte) {
          continue;
        }

        code += JOIN_CODE_ALPHABET[byte % alphabetLength];
        if (code.length === JOIN_CODE_LENGTH) {
          break;
        }
      }
    }

    return code;
  }
}
