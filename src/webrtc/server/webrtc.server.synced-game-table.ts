import {
  WebRTCClientEvent,
  WebRTCClientReadyState,
  WebRTCClientSocket,
  WebRTCServerAuthEvent,
  WebRTCServerEvent,
  WebRTCServerSocket,
  WebRTCServerName,
  WEBRTC_SERVER_NAMES
} from "@webrtc/server/webrtc.server";
import {
  EventBasedMessage,
  EventBasedWebRTCServer,
  EventBasedWebRTCServerOptions
} from "@webrtc/server/webrtc.server.event-based";
import {
  GameTableRequestMessage,
  GameTableResponseMessage,
  GameTableSignalMessage,
  GameTableStateMessage
} from "@webrtc/server/webrtc.server.synced-game-table.dto";
import { WebRTCService } from "@webrtc/webrtc.service";

import { IncomingMessage } from "http";
import { Duplex } from "stream";

export type SyncedGameTableRole = "host" | "slave";

export interface SyncedGameTableTicket {
  sessionId: string;
  userId: number;
  role: SyncedGameTableRole;
  maxPlayers: number;
}

export type SyncedGameTableTicketVerifier = (
  raw: string
) => SyncedGameTableTicket;

export type SyncedGameTableHostDisconnectHandler = (sessionId: string) => void;

const TICKET_KEY = Symbol("syncedGameTable:ticket");
type TicketedRequest = IncomingMessage & {
  [TICKET_KEY]?: SyncedGameTableTicket;
};

export enum SyncedGameTableMessageType {
  STATE = "state",
  REQUEST = "request",
  RESPONSE = "response",
  SIGNAL = "signal"
}

enum SyncedGameTableControlType {
  PEER_JOINED = "peer-joined",
  PEER_LEFT = "peer-left",
  SESSION_ENDED = "session-ended"
}

type SyncedGameTableClientSocket = WebRTCClientSocket<{
  sessionId: string;
  userId: number;
  role: SyncedGameTableRole;
  pinged: boolean;
  pingChecker: NodeJS.Timeout;
}>;

interface SyncedGameTableRoom {
  host: SyncedGameTableClientSocket | null;
  slaves: Map<number, SyncedGameTableClientSocket>;
  maxPlayers: number;
  hostGraceTimer: NodeJS.Timeout | null;
}

type SyncedGameTableServerSocket = WebRTCServerSocket<{
  rooms: Map<string, SyncedGameTableRoom>;
}>;

export class SyncedGameTableWebRTCServerOptions extends EventBasedWebRTCServerOptions {
  override name: WebRTCServerName = WEBRTC_SERVER_NAMES.game;
}

// Host-authoritative relay for multiplayer game-table sync.
export class SyncedGameTableWebRTCServer extends EventBasedWebRTCServer<SyncedGameTableWebRTCServerOptions> {
  // Heartbeat interval to detect half-open sockets.
  private static readonly PING_INTERVAL_MS = 30000;

  // Delay before ending a hostless room so brief host reconnects can recover.
  private static readonly HOST_DISCONNECT_GRACE_MS = 15000;

  private readonly _verifyTicket: SyncedGameTableTicketVerifier;
  private readonly _onHostDisconnected:
    | SyncedGameTableHostDisconnectHandler
    | undefined;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    verifyTicket: SyncedGameTableTicketVerifier,
    onHostDisconnected?: SyncedGameTableHostDisconnectHandler,
    extraOpts: SyncedGameTableWebRTCServerOptions = new SyncedGameTableWebRTCServerOptions()
  ) {
    super(webrtcService, whatFor, extraOpts);

    this._verifyTicket = verifyTicket;
    this._onHostDisconnected = onHostDisconnected;

    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    serverSocket.rooms = new Map<string, SyncedGameTableRoom>();
  }

  @WebRTCServerAuthEvent()
  protected _internal_sgt_authenticate(
    httpRequest: IncomingMessage,
    _httpClientSocket: Duplex,
    _head: Buffer
  ): boolean {
    try {
      const url = new URL(httpRequest.url ?? "", "http://localhost");
      const rawTicket = url.searchParams.get("ticket");

      if (!rawTicket) {
        return false;
      }

      const ticket = this._verifyTicket(rawTicket);

      (httpRequest as TicketedRequest)[TICKET_KEY] = ticket;

      return true;
    } catch (err) {
      this.logger.verbose(`Ticket verification failed: ${err}`);
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Connection lifecycle
  // --------------------------------------------------------------------------

  @WebRTCServerEvent("connection")
  protected _internal_sgt_onConnection(
    serverSocket: SyncedGameTableServerSocket,
    rawClientSocket: SyncedGameTableClientSocket,
    httpRequest: IncomingMessage
  ): void {
    const ticket = (httpRequest as TicketedRequest)[TICKET_KEY];

    if (!ticket) {
      rawClientSocket.close();
      return;
    }

    const existingRoom = serverSocket.rooms.get(ticket.sessionId);

    const existingSlave =
      ticket.role === "slave"
        ? existingRoom?.slaves.get(ticket.userId)
        : undefined;

    if (ticket.role === "host") {
      if (
        existingRoom?.host &&
        existingRoom.host.readyState === WebRTCClientReadyState.OPEN
      ) {
        this.logger.verbose(
          `Rejecting duplicate host for session ${ticket.sessionId}`
        );
        rawClientSocket.close();
        return;
      }
    } else if (!existingSlave) {
      const currentSlaves = existingRoom ? existingRoom.slaves.size : 0;

      if (currentSlaves >= ticket.maxPlayers - 1) {
        this.logger.verbose(
          `Rejecting slave for full session ${ticket.sessionId} ` +
            `(${currentSlaves}/${ticket.maxPlayers - 1} slots)`
        );
        rawClientSocket.close();
        return;
      }
    }

    const socket = rawClientSocket;
    socket.sessionId = ticket.sessionId;
    socket.userId = ticket.userId;
    socket.role = ticket.role;

    this._startHeartbeat(socket);

    let room = existingRoom;
    if (!room) {
      room = {
        host: null,
        slaves: new Map(),
        maxPlayers: ticket.maxPlayers,
        hostGraceTimer: null
      };
      serverSocket.rooms.set(ticket.sessionId, room);
    }

    if (ticket.role === "host") {
      this._clearHostGrace(room);
      room.host = socket;
      room.maxPlayers = ticket.maxPlayers;

      room.slaves.forEach((slave) => {
        this.send(socket, {
          type: SyncedGameTableControlType.PEER_JOINED,
          userId: slave.userId
        });
      });
    } else {
      room.slaves.set(socket.userId, socket);

      if (existingSlave && existingSlave !== socket) {
        existingSlave.close();
      } else if (room.host) {
        this.send(room.host, {
          type: SyncedGameTableControlType.PEER_JOINED,
          userId: socket.userId
        });
      }
    }
  }

  @WebRTCClientEvent("close")
  protected _internal_sgt_onClose(socket: SyncedGameTableClientSocket): void {
    clearInterval(socket.pingChecker);

    // Skip runtime teardown logic while the process is shutting down.
    if (this.isShuttingDown) {
      return;
    }

    if (!socket.sessionId) {
      return;
    }

    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    const room = serverSocket.rooms.get(socket.sessionId);

    if (!room) {
      return;
    }

    if (socket.role === "host" && room.host === socket) {
      room.host = null;
      this._scheduleHostGrace(room, socket.sessionId);
    } else if (socket.role === "slave") {
      if (room.slaves.get(socket.userId) !== socket) {
        return;
      }

      room.slaves.delete(socket.userId);

      if (room.host) {
        this.send(room.host, {
          type: SyncedGameTableControlType.PEER_LEFT,
          userId: socket.userId
        });
      }

      if (!room.host && room.slaves.size === 0 && !room.hostGraceTimer) {
        serverSocket.rooms.delete(socket.sessionId);
      }
    }
  }

  @WebRTCClientEvent("pong")
  protected _internal_sgt_onPong(socket: SyncedGameTableClientSocket): void {
    socket.pinged = true;
  }

  private _startHeartbeat(socket: SyncedGameTableClientSocket): void {
    socket.pinged = true;
    socket.pingChecker = setInterval(() => {
      if (!socket.pinged) {
        this.logger.verbose(
          `Game-table client ${socket.remoteAddress} ping timed out`
        );
        clearInterval(socket.pingChecker);
        socket.close();
        return;
      }

      socket.pinged = false;

      try {
        socket.ping();
      } catch (err) {
        this.logger.verbose(
          `Failed to ping ${socket.remoteAddress}: ${err}`
        );
        socket.close();
      }
    }, SyncedGameTableWebRTCServer.PING_INTERVAL_MS);
  }

  // End the room if the host does not reconnect before the grace timeout.
  private _scheduleHostGrace(
    room: SyncedGameTableRoom,
    sessionId: string
  ): void {
    this._clearHostGrace(room);

    room.hostGraceTimer = setTimeout(() => {
      room.hostGraceTimer = null;

      const serverSocket = this.wss<SyncedGameTableServerSocket>();

      if (serverSocket.rooms.get(sessionId) !== room || room.host) {
        return;
      }

      room.slaves.forEach((slave) => {
        this.send(slave, { type: SyncedGameTableControlType.SESSION_ENDED });
        slave.close();
      });

      serverSocket.rooms.delete(sessionId);
      this._onHostDisconnected?.(sessionId);
    }, SyncedGameTableWebRTCServer.HOST_DISCONNECT_GRACE_MS);
  }

  private _clearHostGrace(room: SyncedGameTableRoom): void {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
  }

  @EventBasedMessage(SyncedGameTableMessageType.STATE, GameTableStateMessage)
  protected _internal_sgt_onState(
    socket: SyncedGameTableClientSocket,
    body: GameTableStateMessage
  ): void {
    if (socket.role !== "host") {
      this._rejectUnauthorized(socket, "state");
      return;
    }

    const room = this._roomOf(socket);
    if (!room) return;

    this.broadcast(room.slaves.values(), {
      type: SyncedGameTableMessageType.STATE,
      data: body.data
    });
  }

  @EventBasedMessage(
    SyncedGameTableMessageType.REQUEST,
    GameTableRequestMessage
  )
  protected _internal_sgt_onRequest(
    socket: SyncedGameTableClientSocket,
    body: GameTableRequestMessage
  ): void {
    if (socket.role !== "slave") {
      this._rejectUnauthorized(socket, "request");
      return;
    }

    const room = this._roomOf(socket);
    if (!room || !room.host) return;

    this.send(room.host, {
      type: SyncedGameTableMessageType.REQUEST,
      from: socket.userId,
      data: body.data
    });
  }

  @EventBasedMessage(
    SyncedGameTableMessageType.RESPONSE,
    GameTableResponseMessage
  )
  protected _internal_sgt_onResponse(
    socket: SyncedGameTableClientSocket,
    body: GameTableResponseMessage
  ): void {
    if (socket.role !== "host") {
      this._rejectUnauthorized(socket, "response");
      return;
    }

    const room = this._roomOf(socket);
    if (!room) return;

    const target = room.slaves.get(body.to);
    if (!target) return;

    this.send(target, {
      type: SyncedGameTableMessageType.RESPONSE,
      data: body.data
    });
  }

  @EventBasedMessage(SyncedGameTableMessageType.SIGNAL, GameTableSignalMessage)
  protected _internal_sgt_onSignal(
    socket: SyncedGameTableClientSocket,
    body: GameTableSignalMessage
  ): void {
    const room = this._roomOf(socket);
    if (!room)
      return;

    if (socket.role === "slave") {
      if (!room.host)
        return;

      this.send(room.host, {
        type: SyncedGameTableMessageType.SIGNAL,
        from: socket.userId,
        data: body.data
      });
      return;
    }

    if (body.to === undefined)
      return;

    const target = room.slaves.get(body.to);
    if (!target)
      return;

    this.send(target, {
      type: SyncedGameTableMessageType.SIGNAL,
      data: body.data
    });
  }

  public connectedCount(sessionId: string): number {
    const room = this.wss<SyncedGameTableServerSocket>().rooms.get(sessionId);

    if (!room)
      return 0;

    return room.slaves.size + (room.host ? 1 : 0);
  }

  // Clear host-grace timers to avoid delayed teardown callbacks after shutdown.
  public override shutdown(): void {
    const serverSocket = this.wss<SyncedGameTableServerSocket>();

    serverSocket.rooms.forEach((room) => this._clearHostGrace(room));

    super.shutdown();
  }

  public closeRoom(sessionId: string): void {
    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    const room = serverSocket.rooms.get(sessionId);

    if (!room) {
      return;
    }

    this._clearHostGrace(room);

    if (room.host) {
      this.send(room.host, { type: SyncedGameTableControlType.SESSION_ENDED });
      room.host.close();
    }

    room.slaves.forEach((slave) => {
      this.send(slave, { type: SyncedGameTableControlType.SESSION_ENDED });
      slave.close();
    });

    serverSocket.rooms.delete(sessionId);
  }

  private _roomOf(
    socket: SyncedGameTableClientSocket
  ): SyncedGameTableRoom | undefined {
    return this.wss<SyncedGameTableServerSocket>().rooms.get(socket.sessionId);
  }

  private _rejectUnauthorized(
    socket: SyncedGameTableClientSocket,
    messageType: string
  ): void {
    this.logger.verbose(
      `Closing ${socket.role} ${socket.remoteAddress}: unauthorized "${messageType}"`
    );
    socket.close();
  }
}
