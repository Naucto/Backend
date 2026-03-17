// FIXME: https://github.com/websockets/ws?tab=readme-ov-file#multiple-servers-sharing-a-single-https-server

import { WebRTCServerDecoratorError, WebRTCServerRuntimeError } from "@webrtc/server/webrtc.server.error";

import { availableParallelism } from "os";
import { IncomingMessage } from "http";

import { WebSocket, WebSocketServer } from "ws";
import { Logger } from "@nestjs/common";

interface WebRTCSocketLikeObject {
  on(event: string, listener: (...args: unknown[]) => void): void;
};

type WebRTCEventHandler = (...args: unknown[]) => void;
type WebRTCEventHandlerMap = Map<string, WebRTCEventHandler>;

type WebRTCEventKind = "server" | "client";

function WebRTCBaseEvent(eventLevel: WebRTCEventKind, eventName: string): MethodDecorator
{
  const decoratorWrapper: MethodDecorator = (
    target: unknown,
    _: string | symbol,
    descriptor: PropertyDescriptor
  ) => {
    if (!(target instanceof WebRTCServer)) {
      throw new WebRTCServerDecoratorError(
        `The @WebRTC${eventLevel[0]!.toUpperCase() + eventLevel.slice(1)}Event decorator can only be applied to methods of the WebRTCServer class.`
      ); 
    }

    const targetAsFields = target as Record<keyof WebRTCServer, unknown>;
    const eventMapKey = `_${eventLevel}EventHandlers` as keyof WebRTCServer;
    const eventMap: WebRTCEventHandlerMap =
      targetAsFields[eventMapKey] as WebRTCEventHandlerMap;

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

export class WebRTCServerOptions {
  compressedThreshold: number = 256;
};

// Bare-bones implementation of a generic WebRTC server.
// You'll be interested in the derived classes more than this one for examples.
export class WebRTCServer<OptsT extends WebRTCServerOptions = WebRTCServerOptions> {
  private _logger: Logger;

  private _wss: WebSocketServer;
  private _extraOpts: OptsT;

  private _serverEventHandlers: WebRTCEventHandlerMap = new Map();
  private _clientEventHandlers: WebRTCEventHandlerMap = new Map();

  constructor(
    whatFor: string,
    port: number,
    extraOpts: OptsT = new WebRTCServerOptions() as OptsT
  ) {
    this._logger = new Logger(`${this.constructor.name} (${whatFor})`);

    this._wss = new WebSocketServer({
      port,
      perMessageDeflate: {
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
        threshold: extraOpts.compressedThreshold
      }
    });

    this._extraOpts = extraOpts;

    this.applyEventHandlers(this._wss);
  }

  public get logger(): Logger {
    return this._logger;
  }

  protected get wss(): WebSocketServer {
    return this._wss;
  }

  protected get extraOpts(): OptsT {
    return this._extraOpts;
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
          handler.apply(this, args);
        } catch (error) {
          let message;

          if (error instanceof Error) {
            message = error.message;
          } else {
            message = String(error);
          }

          this._logger.error(
            `Failed to hook "${eventName}": ${message}`
          );
          throw new WebRTCServerRuntimeError("Failed to hook `${eventName}` event handler.");
        }
      });
    });
  }

  @WebRTCServerEvent("upgrade")
  private onUpgrade(request: IncomingMessage, socket: WebSocket): void
  {
    
  }
};
