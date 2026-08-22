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
import { IsEnum, IsString, validateSync } from "class-validator";
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
  PING = "ping"
}

class NotificationClientMessage {
  @IsEnum(NotificationClientMessageType)
    type!: NotificationClientMessageType;
}

class NotificationClientAuthMessage extends NotificationClientMessage {
  @IsString()
    token!: string;
}

type NotificationServerMessage =
  | { type: "notification"; payload: NotificationPayload }
  | { type: "notifications:init"; payload: NotificationPayload[] }
  | { type: "pong" };

export class NotificationWebRTCServerOptions extends WebRTCServerOptions {
  pingTimeout: number = 30000;
}

export class NotificationWebRTCServer extends WebRTCServer<NotificationWebRTCServerOptions> {
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
    }
  }

  public sendToUser(userId: number | string, payload: NotificationPayload): void {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId)) {
      return;
    }

    const clients = this.wss<NotificationServerSocket>().privateClients.get(numericUserId);
    if (!clients) {
      return;
    }

    this.sendToClients(clients, { type: "notification", payload });
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

    socket.userId = null;
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
