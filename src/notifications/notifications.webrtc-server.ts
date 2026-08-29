import { JwtService } from "@nestjs/jwt";
import { JwtPayload } from "@auth/auth.types";
import {
  WebRTCClientEvent,
  WebRTCClientReadyState,
  WebRTCClientSocket,
  WebRTCServer,
  WebRTCServerEvent,
  WebRTCServerOptions,
  WebRTCServerSocket
} from "@webrtc/server/webrtc.server";
import { WebRTCService } from "@webrtc/webrtc.service";
import { RawData } from "ws";
import { plainToInstance } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, validateSync } from "class-validator";
import {
  PRESENCE_KINDS,
  PresenceKind,
  PresenceServerMessage,
  PresenceSocketHandler
} from "src/presence/presence.types";
import { NotificationPayload } from "./notifications.types";
import type { NotificationsService } from "./notifications.service";

// ----------------------------------------------------------------------------

type NotificationClientSocket = WebRTCClientSocket<{
  userId: number | null;
  pinged: boolean;
  pingChecker: NodeJS.Timeout;
}>;

type NotificationServerSocket = WebRTCServerSocket<{
  publicClients: Set<NotificationClientSocket>;
  privateClients: Map<number, Set<NotificationClientSocket>>;
}>;

// ----------------------------------------------------------------------------

enum NotificationClientMessageType {
  AUTH = "auth",
  PING = "ping",
  PRESENCE_SET = "presence:set"
}

class NotificationClientMessage {
  @IsEnum(NotificationClientMessageType)
    type!: NotificationClientMessageType;
}

class NotificationClientAuthMessage extends NotificationClientMessage {
  @IsString()
    token!: string;
}

class NotificationClientPresenceSetMessage extends NotificationClientMessage {
  @IsEnum(PRESENCE_KINDS)
    kind!: PresenceKind;

  @IsOptional()
  @IsInt()
    releaseId?: number | null;

  @IsOptional()
  @IsInt()
    projectId?: number | null;

  @IsOptional()
  @IsString()
    sessionId?: string | null;
}

type NotificationServerMessage =
  | { type: "notification"; payload: NotificationPayload }
  | { type: "notifications:init"; payload: NotificationPayload[] }
  | { type: "pong" }
  | PresenceServerMessage;

export class NotificationWebRTCServerOptions extends WebRTCServerOptions {
  pingTimeout: number = 30000;
}

export class NotificationWebRTCServer extends WebRTCServer<NotificationWebRTCServerOptions> {
  private presenceHandler: PresenceSocketHandler | null = null;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
    extraOpts: NotificationWebRTCServerOptions = new NotificationWebRTCServerOptions()
  ) {
    super(webrtcService, whatFor, extraOpts);

    const serverSocket = this.wss<NotificationServerSocket>();

    serverSocket.publicClients = new Set<NotificationClientSocket>();
    serverSocket.privateClients = new Map<number, Set<NotificationClientSocket>>();
  }

  @WebRTCServerEvent("connection")
  protected _internal_notifications_onConnection(
    _serverSocket: NotificationServerSocket,
    clientSocket: NotificationClientSocket
  ): void {
    clientSocket.userId = null;
    clientSocket.pinged = true;
    clientSocket.pingChecker = setInterval(() => {
      if (!clientSocket.pinged) {
        clearInterval(clientSocket.pingChecker);
        clientSocket.close();
        return;
      }

      clientSocket.pinged = false;

      try {
        clientSocket.ping();
      } catch {
        clientSocket.close();
      }
    }, this.extraOpts.pingTimeout);
  }

  @WebRTCClientEvent("close")
  protected _internal_notifications_onClosed(socket: NotificationClientSocket): void {
    clearInterval(socket.pingChecker);
    this.removeClient(socket);
  }

  @WebRTCClientEvent("pong")
  protected _internal_notifications_onPonged(socket: NotificationClientSocket): void {
    socket.pinged = true;
  }

  @WebRTCClientEvent("message")
  protected _internal_notifications_onMessage(
    socket: NotificationClientSocket,
    rawData: RawData | Buffer | string
  ): void {
    const rawBody = this.parseRawData(socket, rawData);
    if (!rawBody) {
      return;
    }

    const baseMessage = plainToInstance(NotificationClientMessage, rawBody);
    if (!this.validateMessage(socket, baseMessage)) {
      return;
    }

    switch (baseMessage.type) {
    case NotificationClientMessageType.AUTH:
      this.handleAuthMessage(socket, rawBody);
      break;

    case NotificationClientMessageType.PING:
      this.send(socket, { type: "pong" });
      break;

    case NotificationClientMessageType.PRESENCE_SET:
      this.handlePresenceSet(socket, rawBody);
      break;
    }
  }

  public setPresenceHandler(handler: PresenceSocketHandler): void {
    this.presenceHandler = handler;
  }

  public sendToUser(userId: number | string, payload: NotificationPayload): void {
    this.sendMessageToUser(userId, { type: "notification", payload });
  }

  public sendMessageToUser(
    userId: number | string,
    message: NotificationServerMessage
  ): void {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId)) {
      return;
    }

    const clients = this.wss<NotificationServerSocket>().privateClients.get(numericUserId);
    if (!clients) {
      return;
    }

    this.sendToClients(clients, message);
  }

  private handlePresenceSet(socket: NotificationClientSocket, rawBody: unknown): void {
    if (socket.userId === null || !this.presenceHandler) {
      return;
    }

    const message = plainToInstance(NotificationClientPresenceSetMessage, rawBody);
    if (!this.validateMessage(socket, message)) {
      return;
    }

    this.presenceHandler
      .onSet(socket.userId, {
        kind: message.kind,
        releaseId: message.releaseId ?? null,
        projectId: message.projectId ?? null,
        sessionId: message.sessionId ?? null
      })
      .catch((error) => this.logger.warn(`presence:set failed: ${error}`));
  }

  public sendToPublic(payload: NotificationPayload): void {
    this.sendToClients(
      this.wss<NotificationServerSocket>().publicClients,
      { type: "notification", payload }
    );
  }

  private parseRawData(socket: NotificationClientSocket, rawData: RawData | Buffer | string): unknown | null {
    try {
      if (Buffer.isBuffer(rawData)) {
        return JSON.parse(rawData.toString("utf-8"));
      }
      if (rawData instanceof ArrayBuffer) {
        return JSON.parse(Buffer.from(rawData).toString("utf-8"));
      }
      if (Array.isArray(rawData)) {
        return JSON.parse(Buffer.concat(rawData as Buffer[]).toString("utf-8"));
      }

      return JSON.parse(rawData);
    } catch {
      socket.close();
      return null;
    }
  }

  private validateMessage<T extends object>(
    socket: NotificationClientSocket,
    message: T
  ): boolean {
    const errors = validateSync(message);
    if (errors.length === 0) {
      return true;
    }

    socket.close();
    return false;
  }

  private handleAuthMessage(
    socket: NotificationClientSocket,
    rawBody: unknown
  ): void {
    const authMessage = plainToInstance(NotificationClientAuthMessage, rawBody);
    if (!this.validateMessage(socket, authMessage)) {
      return;
    }

    let userId: number | undefined;

    try {
      const payload = this.jwtService.verify<JwtPayload>(authMessage.token);
      userId = payload.sub;
    } catch {
      socket.close();
      return;
    }

    if (!Number.isInteger(userId)) {
      socket.close();
      return;
    }

    this.registerClient(socket, userId);
    void this.sendInitialNotifications(socket, userId);
    void this.sendPresenceSnapshot(socket, userId);
  }

  private async sendPresenceSnapshot(
    socket: NotificationClientSocket,
    userId: number
  ): Promise<void> {
    if (!this.presenceHandler) {
      return;
    }

    try {
      const snapshot = await this.presenceHandler.onSocketOpen(userId);
      this.send(socket, { type: "presence:snapshot", payload: snapshot });
    } catch (error) {
      this.logger.warn(`presence snapshot failed for user ${userId}: ${error}`);
    }
  }

  private registerClient(socket: NotificationClientSocket, userId: number): void {
    const serverSocket = this.wss<NotificationServerSocket>();

    this.removeClient(socket);

    socket.userId = userId;
    serverSocket.publicClients.add(socket);

    const privateClients =
      serverSocket.privateClients.get(userId) ?? new Set<NotificationClientSocket>();

    privateClients.add(socket);
    serverSocket.privateClients.set(userId, privateClients);
  }

  private removeClient(socket: NotificationClientSocket): void {
    const serverSocket = this.wss<NotificationServerSocket>();

    serverSocket.publicClients.delete(socket);

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
    userId: number
  ): Promise<void> {
    try {
      const notifications = await this.notificationsService.getUserNotifications(userId);
      this.send(socket, { type: "notifications:init", payload: notifications });
    } catch {
      this.send(socket, { type: "notifications:init", payload: [] });
    }
  }

  private sendToClients(
    clients: Iterable<NotificationClientSocket>,
    message: NotificationServerMessage
  ): void {
    for (const client of clients) {
      this.send(client, message);
    }
  }

  private send(
    socket: NotificationClientSocket,
    message: NotificationServerMessage
  ): void {
    if (socket.readyState !== WebRTCClientReadyState.OPEN) {
      return;
    }

    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close();
    }
  }
}
