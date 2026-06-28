import {
  WebRTCClientEvent,
  WebRTCClientReadyState,
  WebRTCClientSocket,
  WebRTCServerAuthEvent,
  WebRTCServerEvent,
  WebRTCServerSocket
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

// ----------------------------------------------------------------------------
// Ticket — minted by the REST layer, verified synchronously at WS upgrade.
// ----------------------------------------------------------------------------

export type SyncedGameTableRole = "host" | "slave";

export interface SyncedGameTableTicket {
  sessionId: string;
  userId: number;
  role: SyncedGameTableRole;
  // Total players allowed in the session (host included).
  maxPlayers: number;
}

// Pure synchronous verifier; throws if the raw ticket is invalid/expired.
export type SyncedGameTableTicketVerifier = (
  raw: string
) => SyncedGameTableTicket;

// Stashed on the upgrade request by the auth handler, read by the connection
// handler (both receive the same IncomingMessage instance).
const TICKET_KEY = Symbol("syncedGameTable:ticket");
type TicketedRequest = IncomingMessage & {
  [TICKET_KEY]?: SyncedGameTableTicket;
};

// ----------------------------------------------------------------------------
// Wire protocol — payloads are opaque; the backend never inspects `data`.
// ----------------------------------------------------------------------------

export enum SyncedGameTableMessageType {
  // host -> all slaves: authoritative table state/patch
  STATE = "state",
  // slave -> host: request to read/modify
  REQUEST = "request",
  // host -> one slave: reply to a request
  RESPONSE = "response",
  // slave <-> host: opaque WebRTC signaling, relayed to bring up a direct P2P
  // data channel; the relay path above keeps working when it can't.
  SIGNAL = "signal"
}

// Server -> client control frames (sent, never received as handlers).
enum SyncedGameTableControlType {
  PEER_JOINED = "peer-joined",
  PEER_LEFT = "peer-left",
  SESSION_ENDED = "session-ended"
}

// ----------------------------------------------------------------------------
// Sockets / rooms
// ----------------------------------------------------------------------------

type SyncedGameTableClientSocket = WebRTCClientSocket<{
  sessionId: string;
  userId: number;
  role: SyncedGameTableRole;
}>;

interface SyncedGameTableRoom {
  host: SyncedGameTableClientSocket | null;
  // keyed by userId for O(1) response routing
  slaves: Map<number, SyncedGameTableClientSocket>;
  maxPlayers: number;
}

type SyncedGameTableServerSocket = WebRTCServerSocket<{
  rooms: Map<string, SyncedGameTableRoom>;
}>;

// ----------------------------------------------------------------------------

export class SyncedGameTableWebRTCServerOptions extends EventBasedWebRTCServerOptions {}

// Star-topology relay with host authority for multiplayer game-table sync.
//
// One shared instance hosts many rooms keyed by GameSession.sessionId. Each
// room has exactly one authoritative HOST client and N SLAVE clients. The
// backend routes purely by message type and connection role; it never parses
// the synced payload and has no notion of field-level permissions (those live
// entirely on the frontend engine).
export class SyncedGameTableWebRTCServer extends EventBasedWebRTCServer<SyncedGameTableWebRTCServerOptions> {
  private readonly _verifyTicket: SyncedGameTableTicketVerifier;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    verifyTicket: SyncedGameTableTicketVerifier,
    extraOpts: SyncedGameTableWebRTCServerOptions = new SyncedGameTableWebRTCServerOptions()
  ) {
    super(webrtcService, whatFor, extraOpts);

    this._verifyTicket = verifyTicket;

    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    serverSocket.rooms = new Map<string, SyncedGameTableRoom>();
  }

  // --------------------------------------------------------------------------
  // Authentication (sync, at upgrade)
  // --------------------------------------------------------------------------

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
      // Should be unreachable: the auth gate rejects ticketless upgrades.
      rawClientSocket.close();
      return;
    }

    const existingRoom = serverSocket.rooms.get(ticket.sessionId);

    // A slave reconnecting under the same userId is a replacement, not a new
    // player — it neither counts against capacity nor re-announces a join.
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

      // host counts toward maxPlayers, so slaves are capped at maxPlayers - 1
      if (currentSlaves >= ticket.maxPlayers - 1) {
        this.logger.verbose(
          `Rejecting slave for full session ${ticket.sessionId} ` +
            `(${currentSlaves}/${ticket.maxPlayers - 1} slots)`
        );
        rawClientSocket.close();
        return;
      }
    }

    // Accepted — stamp identity and register into the room.
    const socket = rawClientSocket;
    socket.sessionId = ticket.sessionId;
    socket.userId = ticket.userId;
    socket.role = ticket.role;

    let room = existingRoom;
    if (!room) {
      room = { host: null, slaves: new Map(), maxPlayers: ticket.maxPlayers };
      serverSocket.rooms.set(ticket.sessionId, room);
    }

    if (ticket.role === "host") {
      room.host = socket;
      room.maxPlayers = ticket.maxPlayers;
    } else {
      room.slaves.set(socket.userId, socket);

      if (existingSlave && existingSlave !== socket) {
        // Drop the superseded connection. Its later "close" is a no-op thanks
        // to the identity guard in _internal_sgt_onClose.
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
    // A socket rejected before acceptance never received a sessionId.
    if (!socket.sessionId) {
      return;
    }

    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    const room = serverSocket.rooms.get(socket.sessionId);

    if (!room) {
      return;
    }

    if (socket.role === "host" && room.host === socket) {
      // The host is the sole authority/state holder — no promotion. End the
      // room and evict every slave.
      room.slaves.forEach((slave) => {
        this.send(slave, { type: SyncedGameTableControlType.SESSION_ENDED });
        slave.close();
      });

      serverSocket.rooms.delete(socket.sessionId);
    } else if (socket.role === "slave") {
      // If a newer connection for this user has already replaced us in the
      // room, this close belongs to the superseded socket — leave the live one
      // (and its membership) untouched.
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

      if (!room.host && room.slaves.size === 0) {
        serverSocket.rooms.delete(socket.sessionId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Message routing (role-enforced)
  // --------------------------------------------------------------------------

  @EventBasedMessage(SyncedGameTableMessageType.STATE, GameTableStateMessage)
  protected _internal_sgt_onState(
    socket: SyncedGameTableClientSocket,
    body: GameTableStateMessage
  ): void {
    // Host authority: only the host may broadcast authoritative state.
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

    // `from` is server-stamped from the authenticated identity, never trusted
    // from the client.
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

  // Role-agnostic by design: a slave's signal always goes to the host (its only
  // peer), the host addresses a slave by `to`. `from` is server-stamped from the
  // authenticated identity, never trusted from the client.
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

  // --------------------------------------------------------------------------
  // Public API for the REST layer
  // --------------------------------------------------------------------------

  // Tear down a room and disconnect every peer; called when a session is
  // closed/deleted.
  public closeRoom(sessionId: string): void {
    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    const room = serverSocket.rooms.get(sessionId);

    if (!room) {
      return;
    }

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

  // --------------------------------------------------------------------------

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
