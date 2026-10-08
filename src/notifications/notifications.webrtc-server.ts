import { JwtService } from '@nestjs/jwt';

import { JwtPayload } from '../auth/auth.types';
import { PresenceSocketHandler } from '../presence/presence.types';
import {
  WEBRTC_SERVER_NAMES,
  WebRTCClientEvent,
  WebRTCClientReadyState,
  WebRTCClientSocket,
  WebRTCServerEvent,
  WebRTCServerName,
  WebRTCServerSocket,
} from '../webrtc/server/webrtc.server';
import {
  EventBasedFailurePolicy,
  EventBasedMessage,
  EventBasedWebRTCServer,
  EventBasedWebRTCServerOptions,
} from '../webrtc/server/webrtc.server.event-based';
import { WebRTCService } from '../webrtc/webrtc.service';
import {
  NotificationAuthMessage,
  NotificationPingMessage,
  NotificationServerMessage,
  PresenceSetMessage,
} from './dto/notification-message.dto';
import type { NotificationsService } from './notifications.service';
import { NotificationPayload } from './notifications.types';

type NotificationClientSocket = WebRTCClientSocket<{
  userId: number | null;
}>;

type NotificationServerSocket = WebRTCServerSocket<{
  privateClients: Map<number, Set<NotificationClientSocket>>;
}>;

export class NotificationWebRTCServerOptions extends EventBasedWebRTCServerOptions {
  override name: WebRTCServerName = WEBRTC_SERVER_NAMES.user;
  // Frames are parsed before authentication, and the largest a client sends carries one token.
  override maxPayload: number = 16 * 1024;
  // The client speaks only the messages this socket declares; anything else is a client to drop.
  override onUnknownType: EventBasedFailurePolicy = 'close';
}

export class NotificationWebRTCServer extends EventBasedWebRTCServer<
  NotificationWebRTCServerOptions,
  NotificationServerMessage
> {
  private presenceHandler: PresenceSocketHandler | null = null;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
    extraOpts: NotificationWebRTCServerOptions = new NotificationWebRTCServerOptions(),
  ) {
    super(webrtcService, whatFor, extraOpts);

    const serverSocket = this.wss<NotificationServerSocket>();

    serverSocket.privateClients = new Map<number, Set<NotificationClientSocket>>();
  }

  @WebRTCServerEvent('connection')
  protected _internal_notifications_onConnection(
    _serverSocket: NotificationServerSocket,
    clientSocket: NotificationClientSocket,
  ): void {
    clientSocket.userId = null;
  }

  @WebRTCClientEvent('close')
  protected _internal_notifications_onClosed(socket: NotificationClientSocket): void {
    this.removeClient(socket);
  }

  /** A socket that has not authenticated by the first heartbeat is dropped. */
  protected override mayStayConnected(socket: NotificationClientSocket): boolean {
    return socket.userId !== null;
  }

  @EventBasedMessage('auth', NotificationAuthMessage)
  protected _internal_notifications_onAuth(
    socket: NotificationClientSocket,
    message: NotificationAuthMessage,
  ): void {
    void this.authenticate(socket, message.token);
  }

  @EventBasedMessage('ping', NotificationPingMessage)
  protected _internal_notifications_onPing(socket: NotificationClientSocket): void {
    this.send(socket, { type: 'pong' });
  }

  @EventBasedMessage('presence:set', PresenceSetMessage)
  protected _internal_notifications_onPresenceSet(
    socket: NotificationClientSocket,
    message: PresenceSetMessage,
  ): void {
    if (socket.userId === null || !this.presenceHandler) {
      return;
    }

    this.presenceHandler
      .onSet(socket.userId, {
        kind: message.kind,
        releaseId: message.releaseId ?? null,
        projectId: message.projectId ?? null,
      })
      .catch((error) => this.logger.warn(`presence:set failed: ${error}`));
  }

  public setPresenceHandler(handler: PresenceSocketHandler): void {
    this.presenceHandler = handler;
  }

  public sendToUser(userId: number, payload: NotificationPayload): void {
    this.sendMessageToUser(userId, { type: 'notification', payload });
  }

  public sendMessageToUser(userId: number, message: NotificationServerMessage): void {
    const clients = this.wss<NotificationServerSocket>().privateClients.get(userId);
    if (!clients) {
      return;
    }

    for (const client of clients) {
      this.send(client, message);
    }
  }

  private async authenticate(socket: NotificationClientSocket, token: string): Promise<void> {
    let userId: number | undefined;

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      userId = payload.sub;
    } catch {
      socket.close();
      return;
    }

    if (!Number.isInteger(userId)) {
      socket.close();
      return;
    }

    let active: boolean;

    try {
      active = await this.notificationsService.isActiveUser(userId);
    } catch (error) {
      this.logger.warn(`account lookup failed for user ${userId}: ${error}`);
      socket.close();
      return;
    }

    if (!active) {
      socket.close();
      return;
    }

    // A socket registered after it closed is never removed, and its user would stay online.
    if (socket.readyState !== WebRTCClientReadyState.OPEN) {
      return;
    }

    this.registerClient(socket, userId);

    // A client restates its presence on receiving its notifications, and presence drops that
    // for a user it has not opened.
    await this.sendPresenceSnapshot(socket, userId);
    await this.sendInitialNotifications(socket, userId);
  }

  private async sendPresenceSnapshot(
    socket: NotificationClientSocket,
    userId: number,
  ): Promise<void> {
    if (!this.presenceHandler) {
      return;
    }

    try {
      const snapshot = await this.presenceHandler.onSocketOpen(userId);
      this.send(socket, {
        type: 'presence:snapshot',
        payload: snapshot,
      });
    } catch (error) {
      this.logger.warn(`presence snapshot failed for user ${userId}: ${error}`);
    }
  }

  private registerClient(socket: NotificationClientSocket, userId: number): void {
    const serverSocket = this.wss<NotificationServerSocket>();

    this.removeClient(socket);

    socket.userId = userId;

    const privateClients =
      serverSocket.privateClients.get(userId) ?? new Set<NotificationClientSocket>();

    privateClients.add(socket);
    serverSocket.privateClients.set(userId, privateClients);
  }

  private removeClient(socket: NotificationClientSocket): void {
    const serverSocket = this.wss<NotificationServerSocket>();

    if (socket.userId === null) {
      return;
    }

    const privateClients = serverSocket.privateClients.get(socket.userId);
    privateClients?.delete(socket);

    if (privateClients?.size === 0) {
      serverSocket.privateClients.delete(socket.userId);
    }

    const userId = socket.userId;
    socket.userId = null;

    this.presenceHandler
      ?.onSocketClose(userId)
      .catch((error) => this.logger.warn(`presence close failed: ${error}`));
  }

  private async sendInitialNotifications(
    socket: NotificationClientSocket,
    userId: number,
  ): Promise<void> {
    try {
      const notifications = await this.notificationsService.getUserNotifications(userId);
      this.send(socket, {
        type: 'notifications:init',
        payload: notifications,
      });
    } catch (error) {
      this.logger.warn(`initial notifications failed for user ${userId}: ${error}`);
      this.send(socket, {
        type: 'notifications:init',
        payload: [],
      });
    }
  }
}
