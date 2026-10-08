import { IncomingMessage } from 'http';
import { Duplex } from 'stream';

import { WebRTCService } from '../webrtc.service';
import {
  WEBRTC_SERVER_NAMES,
  WebRTCClientEvent,
  WebRTCClientReadyState,
  WebRTCClientSocket,
  WebRTCServerAuthEvent,
  WebRTCServerEvent,
  WebRTCServerName,
  WebRTCServerSocket,
} from './webrtc.server';
import {
  EventBasedMessage,
  EventBasedWebRTCServer,
  EventBasedWebRTCServerOptions,
} from './webrtc.server.event-based';
import {
  GameTableRequestMessage,
  GameTableResponseMessage,
  GameTableServerMessage,
  GameTableSignalMessage,
  GameTableStateMessage,
} from './webrtc.server.synced-game-table.dto';
import {
  seatsForGuests,
  SyncedGameTableRole,
  SyncedGameTableTicket,
} from './webrtc.server.synced-game-table.ticket';

export type SyncedGameTableTicketVerifier = (raw: string) => SyncedGameTableTicket;

export type SyncedGameTableHostDisconnectHandler = (sessionId: string) => void;

/** Told which seats are connected to which room, for anything accounting for rooms over time. */
export interface SyncedGameTableObserver {
  seatConnected(sessionId: string, seatId: number): void;
  seatDisconnected(sessionId: string, seatId: number): void;
  roomClosed(sessionId: string): void;
}

const TICKET_KEY = Symbol('syncedGameTable:ticket');
type TicketedRequest = IncomingMessage & {
  [TICKET_KEY]?: SyncedGameTableTicket;
};

type SyncedGameTableClientSocket = WebRTCClientSocket<{
  sessionId: string;
  userId: number;
  role: SyncedGameTableRole;
}>;

interface SyncedGameTableRoom {
  host: SyncedGameTableClientSocket | null;
  slaves: Map<number, SyncedGameTableClientSocket>;
  /**
   * Set from the first ticket, then only by `resizeRoom`: a ticket minted before the session was
   * resized must not bring the old limit back.
   */
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
export class SyncedGameTableWebRTCServer extends EventBasedWebRTCServer<
  SyncedGameTableWebRTCServerOptions,
  GameTableServerMessage
> {
  // Delay before ending a hostless room so brief host reconnects can recover.
  private static readonly HOST_DISCONNECT_GRACE_MS = 15000;

  private readonly _verifyTicket: SyncedGameTableTicketVerifier;
  private readonly _onHostDisconnected: SyncedGameTableHostDisconnectHandler | undefined;
  private readonly _observer: SyncedGameTableObserver | undefined;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    verifyTicket: SyncedGameTableTicketVerifier,
    onHostDisconnected?: SyncedGameTableHostDisconnectHandler,
    observer?: SyncedGameTableObserver,
    extraOpts: SyncedGameTableWebRTCServerOptions = new SyncedGameTableWebRTCServerOptions(),
  ) {
    super(webrtcService, whatFor, extraOpts);

    this._verifyTicket = verifyTicket;
    this._onHostDisconnected = onHostDisconnected;
    this._observer = observer;

    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    serverSocket.rooms = new Map<string, SyncedGameTableRoom>();
  }

  @WebRTCServerAuthEvent()
  protected _internal_sgt_authenticate(
    httpRequest: IncomingMessage,
    _httpClientSocket: Duplex,
    _head: Buffer,
  ): boolean {
    try {
      const url = new URL(httpRequest.url ?? '', 'http://localhost');
      const rawTicket = url.searchParams.get('ticket');

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

  @WebRTCServerEvent('connection')
  protected _internal_sgt_onConnection(
    serverSocket: SyncedGameTableServerSocket,
    rawClientSocket: SyncedGameTableClientSocket,
    httpRequest: IncomingMessage,
  ): void {
    const ticket = (httpRequest as TicketedRequest)[TICKET_KEY];

    if (!ticket) {
      rawClientSocket.close();
      return;
    }

    const existingRoom = serverSocket.rooms.get(ticket.sessionId);

    const existingSlave =
      ticket.role === 'slave' ? existingRoom?.slaves.get(ticket.userId) : undefined;

    if (ticket.role === 'host') {
      if (existingRoom?.host && existingRoom.host.readyState === WebRTCClientReadyState.OPEN) {
        this.logger.verbose(`Rejecting duplicate host for session ${ticket.sessionId}`);
        rawClientSocket.close();
        return;
      }
    } else if (!existingSlave) {
      const currentSlaves = existingRoom ? existingRoom.slaves.size : 0;
      const seats = seatsForGuests(existingRoom?.maxPlayers ?? ticket.maxPlayers);

      if (currentSlaves >= seats) {
        this.logger.verbose(
          `Rejecting slave for full session ${ticket.sessionId} (${currentSlaves}/${seats} slots)`,
        );
        rawClientSocket.close();
        return;
      }
    }

    const socket = rawClientSocket;
    socket.sessionId = ticket.sessionId;
    socket.userId = ticket.userId;
    socket.role = ticket.role;

    let room = existingRoom;
    if (!room) {
      room = {
        host: null,
        slaves: new Map(),
        maxPlayers: ticket.maxPlayers,
        hostGraceTimer: null,
      };
      serverSocket.rooms.set(ticket.sessionId, room);
    }

    this._observer?.seatConnected(ticket.sessionId, ticket.userId);

    if (ticket.role === 'host') {
      this._clearHostGrace(room);
      room.host = socket;

      room.slaves.forEach((slave) => {
        this.send(socket, {
          type: 'peer-joined',
          userId: slave.userId,
        });
      });
    } else {
      room.slaves.set(socket.userId, socket);
      existingSlave?.close();

      // Sent for every accepted socket, a reconnection included: it is the host's only notice
      // that a player is present.
      if (room.host) {
        this.send(room.host, {
          type: 'peer-joined',
          userId: socket.userId,
        });
      } else if (!room.hostGraceTimer) {
        // A slave can arrive before its host, or after the session ended: the host gets the same
        // deadline as one that dropped, as nothing else would end a room it never joins.
        this._scheduleHostGrace(room, ticket.sessionId);
      }
    }
  }

  @WebRTCClientEvent('close')
  protected _internal_sgt_onClose(socket: SyncedGameTableClientSocket): void {
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

    if (socket.role === 'host' && room.host === socket) {
      room.host = null;
      this._observer?.seatDisconnected(socket.sessionId, socket.userId);
      this._scheduleHostGrace(room, socket.sessionId);
    } else if (socket.role === 'slave') {
      if (room.slaves.get(socket.userId) !== socket) {
        return;
      }

      room.slaves.delete(socket.userId);
      this._observer?.seatDisconnected(socket.sessionId, socket.userId);

      if (room.host) {
        this.send(room.host, {
          type: 'peer-left',
          userId: socket.userId,
        });
      }

      if (!room.host && room.slaves.size === 0 && !room.hostGraceTimer) {
        serverSocket.rooms.delete(socket.sessionId);
        this._observer?.roomClosed(socket.sessionId);
      }
    }
  }

  // End the room if the host does not reconnect before the grace timeout.
  private _scheduleHostGrace(room: SyncedGameTableRoom, sessionId: string): void {
    this._clearHostGrace(room);

    room.hostGraceTimer = setTimeout(() => {
      room.hostGraceTimer = null;

      const serverSocket = this.wss<SyncedGameTableServerSocket>();

      if (serverSocket.rooms.get(sessionId) !== room || room.host) {
        return;
      }

      room.slaves.forEach((slave) => {
        this.send(slave, { type: 'session-ended' });
        slave.close();
      });

      serverSocket.rooms.delete(sessionId);
      this._observer?.roomClosed(sessionId);
      this._onHostDisconnected?.(sessionId);
    }, SyncedGameTableWebRTCServer.HOST_DISCONNECT_GRACE_MS);
  }

  private _clearHostGrace(room: SyncedGameTableRoom): void {
    if (room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
  }

  @EventBasedMessage('state', GameTableStateMessage)
  protected _internal_sgt_onState(
    socket: SyncedGameTableClientSocket,
    body: GameTableStateMessage,
  ): void {
    if (socket.role !== 'host') {
      this._rejectUnauthorized(socket, 'state');
      return;
    }

    const room = this._roomOf(socket);
    if (!room) {
      return;
    }

    this.broadcast(room.slaves.values(), {
      type: 'state',
      data: body.data,
    });
  }

  @EventBasedMessage('request', GameTableRequestMessage)
  protected _internal_sgt_onRequest(
    socket: SyncedGameTableClientSocket,
    body: GameTableRequestMessage,
  ): void {
    if (socket.role !== 'slave') {
      this._rejectUnauthorized(socket, 'request');
      return;
    }

    const room = this._roomOf(socket);
    if (!room || !room.host) {
      return;
    }

    this.send(room.host, {
      type: 'request',
      from: socket.userId,
      data: body.data,
    });
  }

  @EventBasedMessage('response', GameTableResponseMessage)
  protected _internal_sgt_onResponse(
    socket: SyncedGameTableClientSocket,
    body: GameTableResponseMessage,
  ): void {
    if (socket.role !== 'host') {
      this._rejectUnauthorized(socket, 'response');
      return;
    }

    const room = this._roomOf(socket);
    if (!room) {
      return;
    }

    const target = room.slaves.get(body.to);
    if (!target) {
      return;
    }

    this.send(target, {
      type: 'response',
      data: body.data,
    });
  }

  @EventBasedMessage('signal', GameTableSignalMessage)
  protected _internal_sgt_onSignal(
    socket: SyncedGameTableClientSocket,
    body: GameTableSignalMessage,
  ): void {
    const room = this._roomOf(socket);
    if (!room) {
      return;
    }

    if (socket.role === 'slave') {
      if (!room.host) {
        return;
      }

      this.send(room.host, {
        type: 'signal',
        from: socket.userId,
        data: body.data,
      });
      return;
    }

    if (body.to === undefined) {
      return;
    }

    const target = room.slaves.get(body.to);
    if (!target) {
      return;
    }

    this.send(target, {
      type: 'signal',
      data: body.data,
    });
  }

  public connectedCount(sessionId: string): number {
    const room = this.wss<SyncedGameTableServerSocket>().rooms.get(sessionId);

    if (!room) {
      return 0;
    }

    return room.slaves.size + (room.host ? 1 : 0);
  }

  // Clear host-grace timers to avoid delayed teardown callbacks after shutdown.
  public override shutdown(): void {
    const serverSocket = this.wss<SyncedGameTableServerSocket>();

    serverSocket.rooms.forEach((room) => this._clearHostGrace(room));

    super.shutdown();
  }

  /** Applies a new seat count to a live room; the players already seated keep their seats. */
  public resizeRoom(sessionId: string, maxPlayers: number): void {
    const room = this.wss<SyncedGameTableServerSocket>().rooms.get(sessionId);

    if (room) {
      room.maxPlayers = maxPlayers;
    }
  }

  public closeRoom(sessionId: string): void {
    const serverSocket = this.wss<SyncedGameTableServerSocket>();
    const room = serverSocket.rooms.get(sessionId);

    if (!room) {
      return;
    }

    this._clearHostGrace(room);

    if (room.host) {
      this.send(room.host, { type: 'session-ended' });
      room.host.close();
    }

    room.slaves.forEach((slave) => {
      this.send(slave, { type: 'session-ended' });
      slave.close();
    });

    serverSocket.rooms.delete(sessionId);
    this._observer?.roomClosed(sessionId);
  }

  private _roomOf(socket: SyncedGameTableClientSocket): SyncedGameTableRoom | undefined {
    return this.wss<SyncedGameTableServerSocket>().rooms.get(socket.sessionId);
  }

  private _rejectUnauthorized(socket: SyncedGameTableClientSocket, messageType: string): void {
    this.logger.verbose(
      `Closing ${socket.role} ${socket.remoteAddress}: unauthorized "${messageType}"`,
    );
    socket.close();
  }
}
