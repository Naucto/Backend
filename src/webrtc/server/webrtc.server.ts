import { Logger } from '@nestjs/common';
import { createServer as createHttpServer, IncomingMessage, Server as HTTPServer } from 'http';
import { Socket as TCPSocket } from 'net';
import { availableParallelism } from 'os';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

import { WebRTCService } from '../webrtc.service';
import { WebRTCServerDecoratorError } from './webrtc.server.error';

interface WebRTCSocketLikeObject {
  on(event: string, listener: (...args: unknown[]) => void): void;
}

// https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
export enum WebRTCClientReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
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
export type WebRTCServerSocket<TExtraData = object> = WebSocketServer & TExtraData;

type WebRTCEventHandler = (...args: unknown[]) => void;
type WebRTCEventHandlerMap = Map<string, Array<WebRTCEventHandler>>;

type WebRTCAuthEventHandler = (
  httpRequest: IncomingMessage,
  httpClientSocket: Duplex,
  head: Buffer,
) => boolean;

type WebRTCEventKind = 'server' | 'client';

export type WebRTCDecoratorTarget = Record<string | symbol, unknown>;

const WEBRTC_SERVER_EVENTS_META_KEY = Symbol('webrtc:serverEvents');
const WEBRTC_CLIENT_EVENTS_META_KEY = Symbol('webrtc:clientEvents');
const WEBRTC_AUTH_EVENTS_META_KEY = Symbol('webrtc:authEvents');

const WEBRTC_EVENTS_META_KEYS: Record<WebRTCEventKind, symbol> = {
  server: WEBRTC_SERVER_EVENTS_META_KEY,
  client: WEBRTC_CLIENT_EVENTS_META_KEY,
};

/**
 * What a decorator recorded on this very class under `key`, created by `create` on first use. A
 * subclass never writes into its parent's record: each class keeps its own, merged at construction.
 */
export function ownMetadata<T>(target: WebRTCDecoratorTarget, key: symbol, create: () => T): T {
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = create();
  }

  return target[key] as T;
}

/** What a decorator recorded on this very class under `key`, ignoring what it inherits. */
export function readOwnMetadata<T>(target: WebRTCDecoratorTarget, key: symbol): T | undefined {
  return Object.prototype.hasOwnProperty.call(target, key) ? (target[key] as T) : undefined;
}

/**
 * The prototypes `instance` inherits from, its furthest base class first, so a handler declared
 * again lower down is the one reported as the duplicate.
 */
export function prototypeChainOf(instance: object): WebRTCDecoratorTarget[] {
  const chain: WebRTCDecoratorTarget[] = [];

  let prototype = Object.getPrototypeOf(instance) as object | null;

  while (prototype && prototype !== Object.prototype) {
    chain.unshift(prototype as WebRTCDecoratorTarget);
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }

  return chain;
}

function isWebRTCPrototypeTarget(target: unknown): target is WebRTCDecoratorTarget {
  if (typeof target !== 'object' || target === null) {
    return false;
  }

  return (
    target === WebRTCServer.prototype ||
    Object.prototype.isPrototypeOf.call(WebRTCServer.prototype, target)
  );
}

function WebRTCBaseEvent(eventLevel: WebRTCEventKind, eventName: string): MethodDecorator {
  const decoratorWrapper: MethodDecorator = (
    target: unknown,
    _key: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    if (!isWebRTCPrototypeTarget(target)) {
      throw new WebRTCServerDecoratorError(
        `The @WebRTC${eventLevel[0]!.toUpperCase() + eventLevel.slice(1)}Event ` +
          'decorator can only be applied to methods of the WebRTCServer and ' +
          'derived classes',
      );
    }

    const eventMap = ownMetadata<WebRTCEventHandlerMap>(
      target,
      WEBRTC_EVENTS_META_KEYS[eventLevel],
      () => new Map(),
    );
    const knownEventHandlers = eventMap.get(eventName) ?? [];

    if (knownEventHandlers.includes(descriptor.value as WebRTCEventHandler)) {
      throw new WebRTCServerDecoratorError(
        `Duplicate event handler for event "${eventName}" at level "${eventLevel}".`,
      );
    }

    knownEventHandlers.push(descriptor.value as WebRTCEventHandler);
    eventMap.set(eventName, knownEventHandlers);
  };

  return decoratorWrapper;
}

export function WebRTCServerEvent(eventName: string): MethodDecorator {
  return WebRTCBaseEvent('server', eventName);
}

export function WebRTCClientEvent(eventName: string): MethodDecorator {
  return WebRTCBaseEvent('client', eventName);
}

export function WebRTCServerAuthEvent(): MethodDecorator {
  const decoratorWrapper: MethodDecorator = (
    target: unknown,
    _key: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    if (!isWebRTCPrototypeTarget(target)) {
      throw new WebRTCServerDecoratorError(
        'The @WebRTCServerAuthEvent decorator can only be applied to methods ' +
          'of the WebRTCServer and derived class',
      );
    }

    const handlers = ownMetadata<WebRTCAuthEventHandler[]>(
      target,
      WEBRTC_AUTH_EVENTS_META_KEY,
      () => [],
    );

    if (handlers.includes(descriptor.value as WebRTCAuthEventHandler)) {
      throw new WebRTCServerDecoratorError('Duplicate auth event handler');
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
  collab: 'collab',
  game: 'game',
  user: 'user',
} as const;
export type WebRTCServerName = (typeof WEBRTC_SERVER_NAMES)[keyof typeof WEBRTC_SERVER_NAMES];

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
  /**
   * How often each client is pinged. A client that has not answered the previous ping by the next
   * one is dropped, so a half-open connection lasts at most two intervals.
   */
  heartbeatIntervalMs: number = 30000;
}

type WebRTCHeartbeat = { answered: boolean; timer: NodeJS.Timeout };

export class WebRTCServer<OptsT extends WebRTCServerOptions = WebRTCServerOptions> {
  private readonly _logger: Logger;

  private readonly _port: number;
  private readonly _name: WebRTCServerName | undefined;
  private readonly _httpServer: HTTPServer;
  private readonly _wsServer: WebSocketServer;
  private readonly _extraOpts: OptsT;

  private readonly _authEventHandlers: WebRTCAuthEventHandler[] = [];
  private readonly _serverEventHandlers: WebRTCEventHandlerMap = new Map();
  private readonly _clientEventHandlers: WebRTCEventHandlerMap = new Map();
  private readonly _heartbeats = new Map<WebRTCClientSocket, WebRTCHeartbeat>();

  private _isShuttingDown = false;
  private _listening = false;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    extraOpts: OptsT = new WebRTCServerOptions() as OptsT,
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
      response.writeHead(426, { 'Content-Type': 'text/plain' });
      response.end('Upgrade Required');
    });
    this._wsServer = new WebSocketServer({
      noServer: true,
      maxPayload: extraOpts.maxPayload,
      perMessageDeflate: extraOpts.compressed
        ? {
            zlibDeflateOptions: {
              chunkSize: 4096,
              memLevel: 7,
              level: 5,
            },
            zlibInflateOptions: {
              chunkSize: 4096,
            },
            // Use all cores minus 2 so that the server can still respond to requests
            concurrencyLimit: Math.max(1, availableParallelism() - 2),
            threshold: extraOpts.compressionThreshold,
          }
        : {},
    });

    this._extraOpts = extraOpts;

    this.registerDecoratedEventHandlers();
    this.applyEventHandlers(this._wsServer);

    this._httpServer.on('upgrade', (request, socket, head) => {
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
    if (this._listening) {
      return;
    }
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
    const registries: Record<WebRTCEventKind, WebRTCEventHandlerMap> = {
      server: this._serverEventHandlers,
      client: this._clientEventHandlers,
    };

    prototypeChainOf(this).forEach((prototype) => {
      (['server', 'client'] as const).forEach((eventLevel) => {
        const registry = registries[eventLevel];
        const eventMap = readOwnMetadata<WebRTCEventHandlerMap>(
          prototype,
          WEBRTC_EVENTS_META_KEYS[eventLevel],
        );

        eventMap?.forEach((handlers, eventName) => {
          const knownHandlers = registry.get(eventName) ?? [];

          handlers.forEach((handler) => {
            if (knownHandlers.includes(handler)) {
              throw new WebRTCServerDecoratorError(
                `Duplicate event handler for event "${eventName}" at level "${eventLevel}".`,
              );
            }

            knownHandlers.push(handler);
          });

          registry.set(eventName, knownHandlers);
        });
      });

      const authHandlers = readOwnMetadata<WebRTCAuthEventHandler[]>(
        prototype,
        WEBRTC_AUTH_EVENTS_META_KEY,
      );

      authHandlers?.forEach((handler) => {
        if (this._authEventHandlers.includes(handler)) {
          throw new WebRTCServerDecoratorError('Duplicate auth event handler');
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

  /**
   * Whether a client may stay connected regardless of its pings, asked at every heartbeat; one
   * refused is closed.
   */
  protected mayStayConnected(_clientSocket: WebRTCClientSocket): boolean {
    return true;
  }

  private startHeartbeat(clientSocket: WebRTCClientSocket): void {
    const heartbeat: WebRTCHeartbeat = {
      answered: true,
      timer: setInterval(() => {
        if (!this.mayStayConnected(clientSocket)) {
          this.stopHeartbeat(clientSocket);
          clientSocket.close();
          return;
        }

        if (!heartbeat.answered) {
          this._logger.verbose(`Client ${clientSocket.remoteAddress} ping timed out`);
          this.stopHeartbeat(clientSocket);
          // A peer that stopped answering will not answer a close frame either.
          clientSocket.terminate();
          return;
        }

        heartbeat.answered = false;

        try {
          clientSocket.ping();
        } catch (err) {
          this._logger.verbose(`Failed to ping client ${clientSocket.remoteAddress}: ${err}`);
          clientSocket.close();
        }
      }, this._extraOpts.heartbeatIntervalMs),
    };

    this._heartbeats.set(clientSocket, heartbeat);
  }

  private stopHeartbeat(clientSocket: WebRTCClientSocket): void {
    clearInterval(this._heartbeats.get(clientSocket)?.timer);
    this._heartbeats.delete(clientSocket);
  }

  @WebRTCServerEvent('connection')
  protected _internal_base_onConnection(
    _serverSocket: WebSocketServer,
    rawClientSocket: WebSocket,
    httpRequest: IncomingMessage,
  ): void {
    const clientSocket = rawClientSocket as WebRTCClientSocket;

    clientSocket.remoteAddress = httpRequest.socket.remoteAddress;

    this._logger.verbose(`Client ${clientSocket.remoteAddress} connected`);

    this.startHeartbeat(clientSocket);
  }

  @WebRTCClientEvent('pong')
  protected _internal_base_onPong(clientSocket: WebRTCClientSocket): void {
    const heartbeat = this._heartbeats.get(clientSocket);

    if (heartbeat) {
      heartbeat.answered = true;
    }
  }

  @WebRTCClientEvent('close')
  protected _internal_base_onClose(
    clientSocket: WebRTCClientSocket,
    code: number,
    reason: Buffer,
  ): void {
    this.stopHeartbeat(clientSocket);

    this._logger.verbose(
      `Client ${clientSocket.remoteAddress} disconnected — code: ${code}` +
        (reason.length ? `, reason: ${reason.toString()}` : ''),
    );
  }

  @WebRTCClientEvent('error')
  protected _internal_base_onError(clientSocket: WebRTCClientSocket, err: Error): void {
    this._logger.error(`Client ${clientSocket.remoteAddress} error: ${err.message}`);
  }

  protected _internal_base_onUpgrade(
    request: IncomingMessage,
    httpClientSocket: Duplex,
    head: Buffer,
  ): void {
    const tcpSocket = httpClientSocket as TCPSocket;

    this._wsServer.handleUpgrade(request, httpClientSocket, head, (clientSocket: WebSocket) => {
      // A denied or throwing auth handler aborts the connection before any event handler is
      // wired to it.
      for (let authHandlerI = 0; authHandlerI < this._authEventHandlers.length; authHandlerI++) {
        const handler = this._authEventHandlers[authHandlerI]!;

        let allowed: boolean;

        try {
          allowed = handler.apply(this, [request, httpClientSocket, head]);
        } catch (err) {
          this._logger.verbose(
            `Auth handler #${authHandlerI} threw for ${tcpSocket.remoteAddress}: ${err}`,
          );
          clientSocket.terminate();
          httpClientSocket.destroy();
          return;
        }

        if (!allowed) {
          this._logger.verbose(
            `Auth handler ${authHandlerI} denied access to ${tcpSocket.remoteAddress}`,
          );
          clientSocket.terminate();
          httpClientSocket.destroy();
          return;
        }
      }

      this.applyEventHandlers(clientSocket);
      this._wsServer.emit('connection', clientSocket, request);
    });
  }

  public shutdown(): void {
    if (this._isShuttingDown) {
      return;
    }

    this._isShuttingDown = true;

    this._heartbeats.forEach((heartbeat) => clearInterval(heartbeat.timer));
    this._heartbeats.clear();

    this._logger.log(`Closing this server with ${this._wsServer.clients.size} clients alive`);

    // Clients go first: in noServer mode the WebSocket server's close only completes once no
    // client is left, and nothing else would close them.
    this._wsServer.clients.forEach((client) => client.terminate());

    this._wsServer.close();
    this._httpServer.close();

    this._logger.log('Done closing this server');
  }
}
