import { WebRTCServerDecoratorError } from "@webrtc/server/webrtc.server.error";
import { WebRTCService } from "@webrtc/webrtc.service";

import { availableParallelism } from "os";

import { Socket as TCPSocket } from "net";
import {
  Server as HTTPServer,
  createServer as createHttpServer,
  IncomingMessage
} from "http";
import { WebSocket, WebSocketServer } from "ws";
import { Logger } from "@nestjs/common";
import { Duplex } from "stream";

interface WebRTCSocketLikeObject {
  on(event: string, listener: (...args: unknown[]) => void): void;
}

// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
export enum WebRTCClientReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}

type WebRTCClientSocketData = {
  readyState: WebRTCClientReadyState;
  remoteAddress: string | undefined;
};

export type WebRTCClientSocket<TExtraData = object> = Omit<
  WebSocket,
  keyof WebRTCClientSocketData
> &
  TExtraData &
  WebRTCClientSocketData;
export type WebRTCServerSocket<TExtraData = object> = WebSocketServer &
  TExtraData;

type WebRTCEventHandler = (...args: unknown[]) => void;
type WebRTCEventHandlerMap = Map<string, Array<WebRTCEventHandler>>;

type WebRTCAuthEventHandler = (
  httpRequest: IncomingMessage,
  httpClientSocket: Duplex,
  head: Buffer
) => boolean;

type WebRTCEventKind = "server" | "client";

type WebRTCDecoratorTarget = Record<string | symbol, unknown>;

const WEBRTC_SERVER_EVENTS_META_KEY = Symbol("webrtc:serverEvents");
const WEBRTC_CLIENT_EVENTS_META_KEY = Symbol("webrtc:clientEvents");
const WEBRTC_AUTH_EVENTS_META_KEY = Symbol("webrtc:authEvents");

function isWebRTCPrototypeTarget(
  target: unknown
): target is WebRTCDecoratorTarget {
  if (typeof target !== "object" || target === null) {
    return false;
  }

  return (
    target === WebRTCServer.prototype ||
    Object.prototype.isPrototypeOf.call(WebRTCServer.prototype, target)
  );
}

function WebRTCBaseEvent(
  eventLevel: WebRTCEventKind,
  eventName: string
): MethodDecorator {
  const decoratorWrapper: MethodDecorator = (
    target: unknown,
    _key: string | symbol,
    descriptor: PropertyDescriptor
  ) => {
    if (!isWebRTCPrototypeTarget(target)) {
      throw new WebRTCServerDecoratorError(
        `The @WebRTC${eventLevel[0]!.toUpperCase() + eventLevel.slice(1)}Event ` +
          "decorator can only be applied to methods of the WebRTCServer and " +
          "derived classes"
      );
    }

    const eventMapKey =
      eventLevel === "server"
        ? WEBRTC_SERVER_EVENTS_META_KEY
        : WEBRTC_CLIENT_EVENTS_META_KEY;

    let eventMap: WebRTCEventHandlerMap | undefined;

    if (Object.prototype.hasOwnProperty.call(target, eventMapKey)) {
      eventMap = target[eventMapKey] as WebRTCEventHandlerMap;
    }

    if (!eventMap) {
      eventMap = new Map();
      target[eventMapKey] = eventMap;
    }

    const knownEventHandlers = eventMap.get(eventName) ?? [];

    if (knownEventHandlers.includes(descriptor.value as WebRTCEventHandler)) {
      throw new WebRTCServerDecoratorError(
        `Duplicate event handler for event "${eventName}" at level "${eventLevel}".`
      );
    }

    knownEventHandlers.push(descriptor.value as WebRTCEventHandler);
    eventMap.set(eventName, knownEventHandlers);
  };

  return decoratorWrapper;
}

export function WebRTCServerEvent(eventName: string): MethodDecorator {
  return WebRTCBaseEvent("server", eventName);
}

export function WebRTCClientEvent(eventName: string): MethodDecorator {
  return WebRTCBaseEvent("client", eventName);
}

export function WebRTCServerAuthEvent(): MethodDecorator {
  const decoratorWrapper: MethodDecorator = (
    target: unknown,
    _key: string | symbol,
    descriptor: PropertyDescriptor
  ) => {
    if (!isWebRTCPrototypeTarget(target)) {
      throw new WebRTCServerDecoratorError(
        "The @WebRTCServerAuthEvent decorator can only be applied to methods " +
          "of the WebRTCServer and derived class"
      );
    }

    let handlers: WebRTCAuthEventHandler[] | undefined;

    if (
      Object.prototype.hasOwnProperty.call(target, WEBRTC_AUTH_EVENTS_META_KEY)
    ) {
      handlers = target[WEBRTC_AUTH_EVENTS_META_KEY] as WebRTCAuthEventHandler[];
    }

    if (!handlers) {
      handlers = [];
      target[WEBRTC_AUTH_EVENTS_META_KEY] = handlers;
    }

    if (handlers.includes(descriptor.value as WebRTCAuthEventHandler)) {
      throw new WebRTCServerDecoratorError("Duplicate auth event handler");
    }

    handlers.push(descriptor.value as WebRTCAuthEventHandler);
  };

  return decoratorWrapper;
}

/**
 * Public names of the WebSocket servers; a deployment maps one subdomain and one port to each.
 * A server's port offset is its position here, so entries are appended, never reordered.
 */
export const WEBRTC_SERVER_NAMES = {
  collab: "collab",
  game: "game",
  user: "user"
} as const;
export type WebRTCServerName =
  (typeof WEBRTC_SERVER_NAMES)[keyof typeof WEBRTC_SERVER_NAMES];

export class WebRTCServerOptions {
  port?: number;
  /** Public name substituted for `{name}` in the signaling URL template. */
  name?: WebRTCServerName;
  compressed: boolean = true;
  compressionThreshold: number = 256;
  /**
   * Largest frame a client may send, in bytes; bounded for every server, as a frame is parsed in
   * one go on the event loop the HTTP API shares.
   */
  maxPayload: number = 1024 * 1024;
}

export class WebRTCServer<
  OptsT extends WebRTCServerOptions = WebRTCServerOptions
> {
  private readonly _logger: Logger;

  private readonly _port: number;
  private readonly _name: WebRTCServerName | undefined;
  private readonly _httpServer: HTTPServer;
  private readonly _wsServer: WebSocketServer;
  private readonly _extraOpts: OptsT;

  private readonly _authEventHandlers: WebRTCAuthEventHandler[] = [];
  private readonly _serverEventHandlers: WebRTCEventHandlerMap = new Map();
  private readonly _clientEventHandlers: WebRTCEventHandlerMap = new Map();

  private _isShuttingDown = false;
  private _listening = false;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    extraOpts: OptsT = new WebRTCServerOptions() as OptsT
  ) {
    if (extraOpts.port !== undefined) {
      this._port = extraOpts.port;
    } else {
      this._port = webrtcService.allocatePort(extraOpts.name);
    }

    extraOpts.port = this._port;

    this._name = extraOpts.name;

    this._logger = new Logger(`${this.constructor.name} (${whatFor})`);

    // Nothing else answers a request that is not an upgrade, and unanswered it holds its socket.
    this._httpServer = createHttpServer((_request, response) => {
      response.writeHead(426, { "Content-Type": "text/plain" });
      response.end("Upgrade Required");
    });
    this._wsServer = new WebSocketServer({
      noServer: true,
      maxPayload: extraOpts.maxPayload,
      perMessageDeflate: extraOpts.compressed
        ? {
          zlibDeflateOptions: {
            // Use page-sized chunks for compression
            chunkSize: 4096,
            // https://docs.verygoodsecurity.com/vault/developer-tools/larky/library-api/zlib#zlib.compressobj-level-6-method-8-wbits-15-memlevel-0-strategy-0-zdict-none
            memLevel: 7,
            level: 5
          },
          zlibInflateOptions: {
            // Ditto
            // https://docs.verygoodsecurity.com/vault/developer-tools/larky/library-api/zlib#zlib.compressobj-level-6-method-8-wbits-15-memlevel-0-strategy-0-zdict-none
            chunkSize: 4096
          },
          // Use all cores minus 2 so that the server can still respond to requests
          concurrencyLimit: Math.max(1, availableParallelism() - 2),
          // Don't compress if smaller than the given amount of bytes
          threshold: extraOpts.compressionThreshold
        }
        : {}
    });

    this._extraOpts = extraOpts;

    this.registerDecoratedEventHandlers();
    this.applyEventHandlers(this._wsServer);

    this._httpServer.on("upgrade", (request, socket, head) => {
      this._internal_base_onUpgrade(request, socket, head);
    });

    webrtcService.registerServer(this);
  }

  /**
   * Binds the port. Kept out of the constructor so that resolving the DI graph never opens a
   * listener: a second process building the graph (a test run, the swagger generator) would
   * collide on the port.
   */
  public listen(): void {
    if (this._listening) return;
    this._listening = true;
    this._httpServer.listen(this._port);
  }

  public get port(): number {
    return this._port;
  }

  /** Public name used by the signaling URL template; unset for ad-hoc servers. */
  public get name(): WebRTCServerName | undefined {
    return this._name;
  }

  public get logger(): Logger {
    return this._logger;
  }

  // True once shutdown() has begun. Close handlers use this to tell process
  // teardown (we terminate every socket ourselves) apart from a runtime client
  // disconnect, so they can skip reconnection/grace logic that would otherwise
  // keep the event loop alive or tear down state that should survive a restart.
  public get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  protected get extraOpts(): OptsT {
    return this._extraOpts;
  }

  protected wss<T extends WebSocketServer>(): T {
    return this._wsServer as T;
  }

  private registerDecoratedEventHandlers(): void {
    const prototypeChain: Array<WebRTCDecoratorTarget> = [];

    let currentProto = Object.getPrototypeOf(this) as object | null;

    while (currentProto && currentProto !== Object.prototype) {
      prototypeChain.push(currentProto as WebRTCDecoratorTarget);
      currentProto = Object.getPrototypeOf(currentProto);
    }

    prototypeChain.reverse().forEach((prototype) => {
      const serverEventMap = Object.prototype.hasOwnProperty.call(
        prototype,
        WEBRTC_SERVER_EVENTS_META_KEY
      )
        ? (prototype[WEBRTC_SERVER_EVENTS_META_KEY] as WebRTCEventHandlerMap)
        : undefined;
      const clientEventMap = Object.prototype.hasOwnProperty.call(
        prototype,
        WEBRTC_CLIENT_EVENTS_META_KEY
      )
        ? (prototype[WEBRTC_CLIENT_EVENTS_META_KEY] as WebRTCEventHandlerMap)
        : undefined;
      const authHandlers = Object.prototype.hasOwnProperty.call(
        prototype,
        WEBRTC_AUTH_EVENTS_META_KEY
      )
        ? (prototype[WEBRTC_AUTH_EVENTS_META_KEY] as WebRTCAuthEventHandler[])
        : undefined;

      serverEventMap?.forEach((handlers, eventName) => {
        const knownHandlers = this._serverEventHandlers.get(eventName) ?? [];

        handlers.forEach((handler) => {
          if (knownHandlers.includes(handler)) {
            throw new WebRTCServerDecoratorError(
              `Duplicate event handler for event "${eventName}" at level "server".`
            );
          }

          knownHandlers.push(handler);
        });

        this._serverEventHandlers.set(eventName, knownHandlers);
      });

      clientEventMap?.forEach((handlers, eventName) => {
        const knownHandlers = this._clientEventHandlers.get(eventName) ?? [];

        handlers.forEach((handler) => {
          if (knownHandlers.includes(handler)) {
            throw new WebRTCServerDecoratorError(
              `Duplicate event handler for event "${eventName}" at level "client".`
            );
          }

          knownHandlers.push(handler);
        });

        this._clientEventHandlers.set(eventName, knownHandlers);
      });

      authHandlers?.forEach((handler) => {
        if (this._authEventHandlers.includes(handler)) {
          throw new WebRTCServerDecoratorError("Duplicate auth event handler");
        }

        this._authEventHandlers.push(handler);
      });
    });
  }

  private applyEventHandlers(specializedSocket: WebRTCSocketLikeObject): void {
    const eventHandlers =
      specializedSocket instanceof WebSocketServer
        ? this._serverEventHandlers
        : this._clientEventHandlers;

    eventHandlers.forEach((handlers, eventName) => {
      specializedSocket.on(eventName, (...args) => {
        handlers.forEach((handler) => {
          try {
            handler.apply(this, [specializedSocket, ...args]);
          } catch (error) {
            let message;
            let stack;

            if (error instanceof Error) {
              message = error.message;
              stack = error.stack;
            } else {
              message = String(error);
            }

            this._logger.error(`Failed to hook "${eventName}": ${message}`, stack);

            // A throw that escapes an emitter's listener is an uncaught exception and ends the
            // process, so the connection that caused it is dropped instead.
            if (!(specializedSocket instanceof WebSocketServer)) {
              (specializedSocket as WebSocket).terminate();
            }
          }
        });
      });
    });
  }

  @WebRTCServerEvent("connection")
  protected _internal_base_onConnection(
    _serverSocket: WebSocketServer,
    rawClientSocket: WebSocket,
    httpRequest: IncomingMessage
  ): void {
    const clientSocket = rawClientSocket as WebRTCClientSocket;

    clientSocket.remoteAddress = httpRequest.socket.remoteAddress;

    this._logger.verbose(`Client ${clientSocket.remoteAddress} connected`);
  }

  @WebRTCClientEvent("close")
  protected _internal_base_onClose(
    clientSocket: WebRTCClientSocket,
    code: number,
    reason: Buffer
  ): void {
    this._logger.verbose(
      `Client ${clientSocket.remoteAddress} disconnected — code: ${code}` +
        (reason.length ? `, reason: ${reason.toString()}` : "")
    );
  }

  @WebRTCClientEvent("error")
  protected _internal_base_onError(
    clientSocket: WebRTCClientSocket,
    err: Error
  ): void {
    this._logger.error(
      `Client ${clientSocket.remoteAddress} error: ${err.message}`
    );
  }

  protected _internal_base_onUpgrade(
    request: IncomingMessage,
    httpClientSocket: Duplex,
    head: Buffer
  ): void {
    const tcpSocket = httpClientSocket as TCPSocket;

    this._wsServer.handleUpgrade(
      request,
      httpClientSocket,
      head,
      (clientSocket: WebSocket) => {
        // A denied or throwing auth handler aborts the connection before any event handler is
        // wired to it.
        for (let authHandlerI = 0; authHandlerI < this._authEventHandlers.length; authHandlerI++) {
          const handler = this._authEventHandlers[authHandlerI]!;

          let allowed: boolean;

          try {
            allowed = handler.apply(this, [request, httpClientSocket, head]);
          } catch (err) {
            this._logger.verbose(
              `Auth handler #${authHandlerI} threw for ${tcpSocket.remoteAddress}: ${err}`
            );
            clientSocket.terminate();
            httpClientSocket.destroy();
            return;
          }

          if (!allowed) {
            this._logger.verbose(
              `Auth handler ${authHandlerI} denied access to ${tcpSocket.remoteAddress}`
            );
            clientSocket.terminate();
            httpClientSocket.destroy();
            return;
          }
        }

        this.applyEventHandlers(clientSocket);
        this._wsServer.emit("connection", clientSocket, request);
      }
    );
  }

  public shutdown(): void {
    if (this._isShuttingDown) {
      return;
    }

    this._isShuttingDown = true;

    this._logger.log(
      `Closing this server with ${this._wsServer.clients.size} clients alive`
    );

    // Clients go first: in noServer mode the WebSocket server's close only completes once no
    // client is left, and nothing else would close them.
    this._wsServer.clients.forEach((client) => client.terminate());

    this._wsServer.close();
    this._httpServer.close();

    this._logger.log("Done closing this server");
  }
}
