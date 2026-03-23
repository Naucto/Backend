// FIXME: https://github.com/websockets/ws?tab=readme-ov-file#multiple-servers-sharing-a-single-https-server

import { WebRTCServerDecoratorError, WebRTCServerRuntimeError } from "@webrtc/server/webrtc.server.error";

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
type WebRTCEventHandlerMap     = Map<string, WebRTCEventHandler>;

type WebRTCAuthEventHandler    = (
  httpRequest: IncomingMessage, httpClientSocket: TCPSocket, head: Buffer
) => boolean;
type WebRTCAuthEventHandlerSet = Array<WebRTCAuthEventHandler>;

type WebRTCEventKind = "server" | "client";

function WebRTCBaseEvent(
  eventLevel: WebRTCEventKind,
  eventName: string): MethodDecorator
{
  const decoratorWrapper: MethodDecorator = (
    target: unknown,
    _key: string | symbol,
    descriptor: PropertyDescriptor
  ) => {
    if (!(target instanceof WebRTCServer)) {
      throw new WebRTCServerDecoratorError(
        `The @WebRTC${eventLevel[0]!.toUpperCase() + eventLevel.slice(1)}Event ` +
        "decorator can only be applied to methods of the WebRTCServer and " +
        "derived classes"
      ); 
    }

    const targetAsFields = target as Record<keyof WebRTCServer, unknown>;
    const eventMapKey    = `_${eventLevel}EventHandlers` as keyof WebRTCServer;
    const eventMap       = targetAsFields[eventMapKey] as WebRTCEventHandlerMap;

    if (!eventMap) {
      // This shouldn't happen
      throw new WebRTCServerDecoratorError(
        `No event handler map found for event level "${eventLevel}".`
      );
    } else if (eventMap.has(eventName)) {
      throw new WebRTCServerDecoratorError(
        `Duplicate event handler for event "${eventName}" at level "${eventLevel}".`
      );
    }

    eventMap.set(eventName, descriptor.value);
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
    if (!(target instanceof WebRTCServer)) {
      throw new WebRTCServerDecoratorError(
        "The @WebRTCServerAuthEvent decorator can only be applied to methods " +
        "of the WebRTCServer and derived class"
      ); 
    }

    const targetAsFields = target as Record<keyof WebRTCServer, unknown>;
    const eventMapKey    = "_authEventHandlers" as keyof WebRTCServer;
    const eventMap       = targetAsFields[eventMapKey] as WebRTCAuthEventHandlerSet;

    if (!eventMap) {
      // This shouldn't happen
      throw new WebRTCServerDecoratorError("No auth event handler map found");
    } else if (eventMap.has(descriptor.value)) {
      throw new WebRTCServerDecoratorError("Duplicate auth event handler");
    }
  };

  return decoratorWrapper;
}

export class WebRTCServerOptions {
  compressed: boolean = true;
  compressionThreshold: number = 256;
};

// Bare-bones implementation of a generic WebRTC server.
// You'll be interested in the derived classes more than this one for examples.
export class WebRTCServer<OptsT extends WebRTCServerOptions = WebRTCServerOptions> {
  private readonly _logger: Logger;

  private readonly _httpServer: HTTPServer;
  private readonly _wsServer: WebSocketServer;
  private readonly _extraOpts: OptsT;

  private readonly _authEventHandlers:   WebRTCAuthEventHandlerSet = [];
  private readonly _serverEventHandlers: WebRTCEventHandlerMap     = new Map();
  private readonly _clientEventHandlers: WebRTCEventHandlerMap     = new Map();

  constructor(
    whatFor: string,
    port: number,
    extraOpts: OptsT = new WebRTCServerOptions() as OptsT
  ) {
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

    this.applyEventHandlers(this._wsServer);

    this._httpServer.listen(port);
  }

  // --------------------------------------------------------------------------

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

  private applyEventHandlers(specializedSocket: WebRTCSocketLikeObject): void {
    const socket = specializedSocket as WebRTCSocketLikeObject;

    const eventHandlers =
      specializedSocket instanceof WebSocketServer
        ? this._serverEventHandlers
        : this._clientEventHandlers;

    eventHandlers.forEach((handler, eventName) => {
      socket.on(eventName, (...args) => {
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
              this.logger.verbose(
                `Handler ${authHandlerI} returned false, denying access`
              );

              httpClientSocket.destroy();
              return;
            }
          });
        } catch (err) {
          this.logger.verbose(
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
};
