import http from "http";
import { JwtPayload as JwtLibPayload, verify } from "jsonwebtoken";
import { WebSocket, WebSocketServer } from "ws";
import { NotificationPayload } from "./notifications.types";
import type { NotificationsService } from "./notifications.service";

const NOTIFICATION_SOCKET_PATH = "/socket/notifications";
const WS_READY_STATE_OPEN = 1;
const PING_TIMEOUT = 30000;

type NotificationSocketOptions = {
  notificationsService: NotificationsService;
  jwtSecret: string;
};

type NotificationJwtPayload = JwtLibPayload & {
  sub?: number;
  email?: string;
};

type NotificationWsMessage =
  | { type: "notification"; payload: NotificationPayload }
  | { type: "notifications:init"; payload: NotificationPayload[] };

type ClientAuthMessage = { type: "auth"; token: string };

let notificationWss: WebSocketServer | undefined;
const userSockets = new Map<number, Set<WebSocket>>();

const roomSet = (userId: number): Set<WebSocket> => {
  const existing = userSockets.get(userId);
  if (existing) {
    return existing;
  }

  const created = new Set<WebSocket>();
  userSockets.set(userId, created);
  return created;
};

const onConnection = async (socket: WebSocket, _request: http.IncomingMessage, options: NotificationSocketOptions) : Promise<void> => {
  let userId: number | null = null;
  let pongReceived = true;
  let pingInterval: NodeJS.Timeout | null = null;

  const cleanup = (): void => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (userId !== null) {
      const sockets = userSockets.get(userId);
      sockets?.delete(socket);
      if (sockets && sockets.size === 0) {
        userSockets.delete(userId);
      }
    }
  };

  const startSession = async (authenticatedUserId: number): Promise<void> => {
    userId = authenticatedUserId;
    roomSet(userId).add(socket);

    try {
      const notifications = await options.notificationsService.getUserNotifications(userId);
      send(socket, { type: "notifications:init", payload: notifications });
    } catch {
      send(socket, { type: "notifications:init", payload: [] });
    }

    pingInterval = setInterval(() => {
      if (!pongReceived) {
        socket.close();
        cleanup();
        return;
      }

      pongReceived = false;
      try {
        socket.ping();
      } catch {
        socket.close();
        cleanup();
      }
    }, PING_TIMEOUT);
  };

  const handleAuthMessage = async (raw: import("ws").RawData): Promise<void> => {
    try {
      const parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as ClientAuthMessage;
      if (parsed?.type !== "auth" || typeof parsed.token !== "string") {
        socket.close();
        return;
      }

      const authenticatedUserId = authenticateToken(parsed.token, options.jwtSecret);
      if (!authenticatedUserId) {
        socket.close();
        return;
      }

      socket.off("message", handleAuthMessage as any);
      await startSession(authenticatedUserId);
    } catch {
      socket.close();
    }
  };

  socket.on("message", handleAuthMessage as any);

  socket.on("pong", () => {
    pongReceived = true;
  });

  socket.on("close", () => {
    cleanup();
  });
};

const send = (socket: WebSocket, message: NotificationWsMessage): void => {
  if (socket.readyState !== WS_READY_STATE_OPEN) {
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.close();
  }
};

const authenticateToken = (token: string, jwtSecret: string): number | null => {
  try {
    const payload = verify(token, jwtSecret) as NotificationJwtPayload;
    if (typeof payload?.sub !== "number") {
      return null;
    }

    return payload.sub;
  } catch {
    return null;
  }
};

export const setupNotificationSocket = (
  server: http.Server,
  options: NotificationSocketOptions,
): WebSocketServer => {
  if (notificationWss) {
    return notificationWss;
  }

  notificationWss = new WebSocketServer({ noServer: true });

  notificationWss.on("connection", (socket, request) => onConnection(socket, request, options));

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith(NOTIFICATION_SOCKET_PATH)) {
      return;
    }

    notificationWss?.handleUpgrade(request, socket, head, (websocket) => {
      notificationWss?.emit("connection", websocket, request);
    });
  });

  return notificationWss;
};

export const emitNotificationToUser = (
  userId: string | number,
  payload: NotificationPayload,
): void => {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) {
    return;
  }

  const sockets = userSockets.get(numericUserId);
  if (!sockets || sockets.size === 0) {
    return;
  }

  const message: NotificationWsMessage = {
    type: "notification",
    payload,
  };

  sockets.forEach((socket) => {
    send(socket, message);
  });
};

export { NOTIFICATION_SOCKET_PATH };
