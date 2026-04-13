// FIXME: https://github.com/websockets/ws?tab=readme-ov-file#multiple-servers-sharing-a-single-https-server

import {
  WebRTCServerDecoratorError,
  WebRTCServerRuntimeError
} from "@webrtc/server/webrtc.server.error";
import { WebRTCService } from "@webrtc/webrtc.service";

import { availableParallelism } from "os";

import { Socket as TCPSocket } from "net";
import { Server as HTTPServer, createServer as createHttpServer, IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { Logger } from "@nestjs/common";

interface WebRTCSocketLikeObject {
  on(event: string, listener: (...args: unknown[]) => void): void;
};

// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
export enum WebRTCClientReadyState {
  CONNECTING = 0,
  OPEN       = 1,
  CLOSING    = 2,
  CLOSED     = 3
};

type WebRTCClientSocketData = {
  readyState: WebRTCClientReadyState;
  remoteAddress: string | undefined;
};

export type WebRTCClientSocket<TExtraData = object> =
  Omit<WebSocket, keyof WebRTCClientSocketData> & TExtraData & WebRTCClientSocketData;
export type WebRTCServerSocket<TExtraData = object> =
  WebSocketServer & TExtraData;

type WebRTCEventHandler        = (...args: unknown[]) => void;
type WebRTCEventHandlerMap     = Map<string, Array<WebRTCEventHandler>>;

type WebRTCAuthEventHandler    = (
  httpRequest: IncomingMessage, httpClientSocket: TCPSocket, head: Buffer
) => boolean;
type WebRTCAuthEventHandlerSet = Array<WebRTCAuthEventHandler>;

type WebRTCEventKind = "server" | "client";

type WebRTCDecoratorTarget = Record<string | symbol, unknown>;

const WEBRTC_SERVER_EVENTS_META_KEY = Symbol("webrtc:serverEvents");
const WEBRTC_CLIENT_EVENTS_META_KEY = Symbol("webrtc:clientEvents");
const WEBRTC_AUTH_EVENTS_META_KEY   = Symbol("webrtc:authEvents");

function isWebRTCPrototypeTarget(target: unknown): target is WebRTCDecoratorTarget
{
  if (typeof target !== "object" || target === undefined) {
    return false;
  }

  return (
    target === WebRTCServer.prototype ||
    Object.prototype.isPrototypeOf.call(
      WebRTCServer.prototype,
      target!
    )
  );
}

function WebRTCBaseEvent(
  eventLevel: WebRTCEventKind,
  eventName: string): MethodDecorator
{
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

export function WebRTCServerEvent(eventName: string): MethodDecorator
{
  return WebRTCBaseEvent("server", eventName);
}

export function WebRTCClientEvent(eventName: string): MethodDecorator
{
  return WebRTCBaseEvent("client", eventName);
}

export function WebRTCServerAuthEvent(): MethodDecorator
{
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

    let eventMap: WebRTCAuthEventHandlerSet | undefined;

    if (Object.prototype.hasOwnProperty.call(target, WEBRTC_AUTH_EVENTS_META_KEY)) {
      eventMap = target[WEBRTC_AUTH_EVENTS_META_KEY] as WebRTCAuthEventHandlerSet;
    }

    if (!eventMap) {
      eventMap = [];
      target[WEBRTC_AUTH_EVENTS_META_KEY] = eventMap;
    }

    if (eventMap.includes(descriptor.value as WebRTCAuthEventHandler)) {
      throw new WebRTCServerDecoratorError("Duplicate auth event handler");
    }

    eventMap.push(descriptor.value as WebRTCAuthEventHandler);
  };

  return decoratorWrapper;
}

export class WebRTCServerOptions {
  port?: number;
  compressed: boolean = true;
  compressionThreshold: number = 256;
};

// Bare-bones implementation of a generic WebRTC server.
// You'll be interested in the derived classes more than this one for examples.
export class WebRTCServer<OptsT extends WebRTCServerOptions = WebRTCServerOptions> {
  private static readonly SEQUENTIAL_PORT_BASE = 4096;
  private static _nextAvailablePort = this.SEQUENTIAL_PORT_BASE;

  private readonly _logger: Logger;

  private readonly _port: number;
  private readonly _httpServer: HTTPServer;
  private readonly _wsServer: WebSocketServer;
  private readonly _extraOpts: OptsT;

  private readonly _authEventHandlers:   WebRTCAuthEventHandlerSet = [];
  private readonly _serverEventHandlers: WebRTCEventHandlerMap     = new Map();
  private readonly _clientEventHandlers: WebRTCEventHandlerMap     = new Map();

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    extraOpts: OptsT = new WebRTCServerOptions() as OptsT
  ) {
    if (extraOpts.port !== undefined) {
      this._port = extraOpts.port;
    } else {
      this._port = WebRTCServer._nextAvailablePort++;
    }

    extraOpts.port = this._port;

    this._logger = new Logger(`${this.constructor.name} (${whatFor})`);

    this._httpServer = createHttpServer();
    this._wsServer = new WebSocketServer({
      noServer: true,
      perMessageDeflate: extraOpts.compressed ? {
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
        concurrencyLimit: availableParallelism() - 2,
        // Don't compress if smaller than the given amount of bytes
        threshold: extraOpts.compressionThreshold
      } : {}
    });

    this._extraOpts = extraOpts;

    this.registerDecoratedEventHandlers();
    this.applyEventHandlers(this._wsServer);

    this._httpServer.on("upgrade", (request, socket, head) => {
      this._wsServer.emit("upgrade", request, socket, head);
    });
    this._httpServer.listen(this._port);

    webrtcService.registerServer(this);
  }

  // --------------------------------------------------------------------------

  public get port(): number {
    return this._port;
  }

  public get logger(): Logger {
    return this._logger;
  }

  protected get extraOpts(): OptsT {
    return this._extraOpts;
  }

  // --------------------------------------------------------------------------

  protected wss<T extends WebSocketServer>(): T {
    return this._wsServer as T;
  }

  // --------------------------------------------------------------------------

  private registerDecoratedEventHandlers(): void {
    const prototypeChain: Array<WebRTCDecoratorTarget> = [];

    let currentProto = Object.getPrototypeOf(this) as object | null;

    while (currentProto && currentProto !== Object.prototype) {
      prototypeChain.push(currentProto as WebRTCDecoratorTarget);
      currentProto = Object.getPrototypeOf(currentProto);
    }

    prototypeChain.reverse().forEach((prototype) => {
      const serverEventMap =
        Object.prototype.hasOwnProperty.call(prototype, WEBRTC_SERVER_EVENTS_META_KEY)
          ? prototype[WEBRTC_SERVER_EVENTS_META_KEY] as WebRTCEventHandlerMap
          : undefined;
      const clientEventMap =
        Object.prototype.hasOwnProperty.call(prototype, WEBRTC_CLIENT_EVENTS_META_KEY)
          ? prototype[WEBRTC_CLIENT_EVENTS_META_KEY] as WebRTCEventHandlerMap
          : undefined;
      const authEventSet   =
        Object.prototype.hasOwnProperty.call(prototype, WEBRTC_AUTH_EVENTS_META_KEY)
          ? prototype[WEBRTC_AUTH_EVENTS_META_KEY] as WebRTCAuthEventHandlerSet
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

      authEventSet?.forEach((handler) => {
        if (this._authEventHandlers.includes(handler)) {
          throw new WebRTCServerDecoratorError("Duplicate auth event handler");
        }

        this._authEventHandlers.push(handler);
      });
    });
  }

  // --------------------------------------------------------------------------

  private applyEventHandlers(specializedSocket: WebRTCSocketLikeObject): void {
    const socket = specializedSocket as WebRTCSocketLikeObject;

    const eventHandlers =
      specializedSocket instanceof WebSocketServer
        ? this._serverEventHandlers
        : this._clientEventHandlers;

    eventHandlers.forEach((handlers, eventName) => {
      socket.on(eventName, (...args) => {
        handlers.forEach((handler) => {
          try {
            handler.apply(this, [ specializedSocket, ...args ]);
          } catch (error) {
            let message;

            if (error instanceof Error) {
              message = error.message;
            } else {
              message = String(error);
            }

            this._logger.error(`Failed to hook "${eventName}": ${message}`);

            throw new WebRTCServerRuntimeError(
              `Failed to hook "${eventName}" event handler`
            );
          }
        });
      });
    });
  }

  @WebRTCServerEvent("upgrade")
  protected _internal_base_onUpgrade(
    _serverSocket: WebSocketServer,
    request: IncomingMessage,
    httpClientSocket: TCPSocket,
    head: Buffer 
  ): void {
    this._wsServer.handleUpgrade(request, httpClientSocket, head,
      (clientSocket: WebSocket, ...args: unknown[]) => {
        let authHandlerI: number = -1;

        try {
          this._authEventHandlers.forEach((handler, i) => {
            authHandlerI = i;

            if (!handler(request, httpClientSocket, head)) {
              this._logger.verbose(
                `Handler ${authHandlerI} returned false, denying access`
              );

              httpClientSocket.destroy();
              return;
            }
          });
        } catch (err) {
          this._logger.verbose(
            `Exception while executing auth handler #${authHandlerI}: ` +
            `${err}`
          );

          httpClientSocket.destroy();
          return;
        }

        this.applyEventHandlers(clientSocket);

        this._wsServer.emit("connection", clientSocket, request, ...args);
      }
    );
  }

  @WebRTCServerEvent("connection")
  protected _internal_base_onConnection(
    _serverSocket: WebSocketServer,
    rawClientSocket: WebSocket,
    httpRequest: IncomingMessage
  ): void
  {
    const clientSocket = rawClientSocket as WebRTCClientSocket;

    clientSocket.remoteAddress = httpRequest.socket.remoteAddress;
  }

  // --------------------------------------------------------------------------

  public shutdown(): void {
    this._wsServer.close(() => {
      this._logger.log(
        `Closing this server with ${this._wsServer.clients.size} clients alive`
      );

      this._wsServer.clients.forEach(client => client.terminate());

      this._wsServer.close();
      this._httpServer.close();

      this._logger.log("Done closing this server");
    });
  }
};
