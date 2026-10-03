import { plainToInstance } from 'class-transformer';
import { IsString, validateSync, ValidationError } from 'class-validator';
import { RawData } from 'ws';

import { getExcerrMessage } from '../../util/errors';
import { WebRTCService } from '../webrtc.service';
import {
  ownMetadata,
  prototypeChainOf,
  readOwnMetadata,
  WebRTCClientEvent,
  WebRTCClientReadyState,
  WebRTCClientSocket,
  WebRTCDecoratorTarget,
  WebRTCServer,
  WebRTCServerOptions,
} from './webrtc.server';
import { WebRTCServerDecoratorError } from './webrtc.server.error';

// Minimal envelope used to read the `type` discriminator before the concrete
// message class is known. Every incoming message must at least carry a `type`.
export class EventBasedEnvelope {
  @IsString()
  type!: string;
}

// Any outgoing message must carry a `type` so the peer can route it. The
// payload shape beyond that is left to the concrete server.
export interface EventBasedOutgoing {
  type: string;
  [key: string]: unknown;
}

type EventBasedMessageClass<TypeT extends string = string> = new (...args: never[]) => {
  type: TypeT;
};

/** The messages of one channel and direction, each class keyed by the literal `type` it carries. */
export type EventBasedMessageSet<SetT> = {
  [TypeT in keyof SetT & string]: EventBasedMessageClass<TypeT>;
};

/** Refuses to compile when a key differs from the `type` its class declares. */
export function eventBasedMessages<SetT extends EventBasedMessageSet<SetT>>(messages: SetT): SetT {
  return messages;
}

export type EventBasedMessageOf<SetT extends Record<string, EventBasedMessageClass>> = InstanceType<
  SetT[keyof SetT]
>;

type EventBasedMessageConstructor = new (...args: unknown[]) => object;
type EventBasedMessageHandler = (socket: WebRTCClientSocket, body: object) => void;

type EventBasedMessageEntry = {
  ctor: EventBasedMessageConstructor;
  handler: EventBasedMessageHandler;
};

type EventBasedMessageMap = Map<string, EventBasedMessageEntry>;

const WEBRTC_EB_MESSAGES_META_KEY = Symbol('webrtc:eventBasedMessages');

function isEventBasedPrototypeTarget(target: unknown): target is WebRTCDecoratorTarget {
  if (typeof target !== 'object' || target === null) {
    return false;
  }

  return (
    target === EventBasedWebRTCServer.prototype ||
    Object.prototype.isPrototypeOf.call(EventBasedWebRTCServer.prototype, target)
  );
}

// Binds an incoming message `type` to a validation DTO class and the decorated
// handler method, in a single declaration. The base pipeline parses, validates
// against `dtoClass`, then dispatches to the method. At most one handler may be
// registered per `type` (per prototype chain).
export function EventBasedMessage(
  type: string,
  dtoClass: EventBasedMessageConstructor,
): MethodDecorator {
  return (target: unknown, _key: string | symbol, descriptor: PropertyDescriptor) => {
    if (!isEventBasedPrototypeTarget(target)) {
      throw new WebRTCServerDecoratorError(
        'The @EventBasedMessage decorator can only be applied to methods of ' +
          'EventBasedWebRTCServer and derived classes',
      );
    }

    const messageMap = ownMetadata<EventBasedMessageMap>(
      target,
      WEBRTC_EB_MESSAGES_META_KEY,
      () => new Map(),
    );

    if (messageMap.has(type)) {
      throw new WebRTCServerDecoratorError(
        `Duplicate @EventBasedMessage handler for type "${type}".`,
      );
    }

    messageMap.set(type, {
      ctor: dtoClass,
      handler: descriptor.value as EventBasedMessageHandler,
    });
  };
}

export type EventBasedFailurePolicy = 'close' | 'ignore';

export class EventBasedWebRTCServerOptions extends WebRTCServerOptions {
  // What to do when a message is malformed (bad JSON) or fails DTO validation.
  // Defaults to closing the socket, mirroring "kick the badly-behaved client".
  onInvalidMessage: EventBasedFailurePolicy = 'close';

  // What to do when a message has a `type` with no registered handler.
  // Defaults to ignoring it for forward-compatibility with newer clients.
  onUnknownType: EventBasedFailurePolicy = 'ignore';
}

// A WebRTC server base that turns the raw "message" event into a typed,
// validated, event-based dispatch: subclasses declare handlers with
// @EventBasedMessage("<type>", DtoClass) and get transparent (de)serialization.
//
// This base owns ONLY the message pipeline. It deliberately does not hook
// connection/close/pong, so subclasses remain free to manage their own
// per-socket lifecycle via @WebRTCServerEvent/@WebRTCClientEvent.
export class EventBasedWebRTCServer<
  OptsT extends EventBasedWebRTCServerOptions = EventBasedWebRTCServerOptions,
  OutgoingT extends { type: string } = EventBasedOutgoing,
> extends WebRTCServer<OptsT> {
  private readonly _messageHandlers: EventBasedMessageMap = new Map();

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    extraOpts: OptsT = new EventBasedWebRTCServerOptions() as OptsT,
  ) {
    super(webrtcService, whatFor, extraOpts);

    this.registerMessageHandlers();
  }

  private registerMessageHandlers(): void {
    prototypeChainOf(this).forEach((prototype) => {
      const messageMap = readOwnMetadata<EventBasedMessageMap>(
        prototype,
        WEBRTC_EB_MESSAGES_META_KEY,
      );

      messageMap?.forEach((entry, type) => {
        if (this._messageHandlers.has(type)) {
          throw new WebRTCServerDecoratorError(
            `Duplicate @EventBasedMessage handler for type "${type}".`,
          );
        }

        this._messageHandlers.set(type, entry);
      });
    });
  }

  // Decode a ws RawData frame (Buffer/ArrayBuffer/Buffer[]/string) into a parsed
  // JSON object. Throws SyntaxError on malformed input.
  protected decodeRawData(rawData: RawData | Buffer | string): unknown {
    if (Buffer.isBuffer(rawData)) {
      return JSON.parse(rawData.toString('utf-8'));
    }

    if (rawData instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(rawData)));
    }

    if (Array.isArray(rawData)) {
      return JSON.parse(Buffer.concat(rawData as Buffer[]).toString('utf-8'));
    }

    return JSON.parse(rawData as string);
  }

  @WebRTCClientEvent('message')
  protected _internal_eb_onMessage(
    socket: WebRTCClientSocket,
    rawData: RawData | Buffer | string,
  ): void {
    let rawBody: unknown;

    try {
      rawBody = this.decodeRawData(rawData);
    } catch (err) {
      this.handleMalformed(socket, err);
      return;
    }

    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      this.handleMalformed(socket, new Error('frame is not a JSON object'));
      return;
    }

    const envelope = plainToInstance(EventBasedEnvelope, rawBody);
    const envelopeErrors = validateSync(envelope);

    if (envelopeErrors.length > 0) {
      this.handleInvalidMessage(socket, envelopeErrors);
      return;
    }

    const entry = this._messageHandlers.get(envelope.type);

    if (!entry) {
      this.handleUnknownType(socket, envelope.type);
      return;
    }

    const body = plainToInstance(entry.ctor, rawBody);
    const bodyErrors = validateSync(body as object);

    if (bodyErrors.length > 0) {
      this.handleInvalidMessage(socket, bodyErrors);
      return;
    }

    // Caught here so the log names the message type; left to the base, the connection is dropped
    // without it.
    try {
      entry.handler.call(this, socket, body as object);
    } catch (err) {
      this.handleHandlerError(socket, envelope.type, err);
    }
  }

  // The failure hooks are overridable, so a subclass can send an error frame before closing.
  protected handleHandlerError(socket: WebRTCClientSocket, type: string, err: unknown): void {
    this.logger.error(
      `Handler for "${type}" threw on a message from ${socket.remoteAddress}: ` +
        getExcerrMessage(err),
    );

    socket.close();
  }

  protected handleMalformed(socket: WebRTCClientSocket, err: unknown): void {
    this.logger.verbose(
      `Failed to parse message from ${socket.remoteAddress}: ${getExcerrMessage(err)}`,
    );

    if (this.extraOpts.onInvalidMessage === 'close') {
      socket.close();
    }
  }

  protected handleInvalidMessage(socket: WebRTCClientSocket, errors: ValidationError[]): void {
    errors.forEach((error) => {
      const path = error.children?.length
        ? `${error.property}.${error.children[0]!.property}`
        : error.property;

      this.logger.verbose(
        `Validation error for ${socket.remoteAddress} — ${path}: ` +
          Object.values(error.constraints || {}).join(', '),
      );
    });

    if (this.extraOpts.onInvalidMessage === 'close') {
      socket.close();
    }
  }

  protected handleUnknownType(socket: WebRTCClientSocket, type: string): void {
    this.logger.verbose(`Unknown message type "${type}" from ${socket.remoteAddress}`);

    if (this.extraOpts.onUnknownType === 'close') {
      socket.close();
    }
  }

  protected send(socket: WebRTCClientSocket, message: OutgoingT): void {
    if (
      socket.readyState !== WebRTCClientReadyState.CONNECTING &&
      socket.readyState !== WebRTCClientReadyState.OPEN
    ) {
      const stateName = WebRTCClientReadyState[socket.readyState];

      this.logger.verbose(
        `Attempt to send to ${socket.remoteAddress} in state ${stateName}, closing`,
      );

      socket.close();
      return;
    }

    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      this.logger.verbose(`Failed to send message to ${socket.remoteAddress}: ${err}`);
      socket.close();
    }
  }

  protected broadcast(
    sockets: Iterable<WebRTCClientSocket>,
    message: OutgoingT,
    opts?: { except?: WebRTCClientSocket },
  ): void {
    const serialized = JSON.stringify(message);

    for (const socket of sockets) {
      if (opts?.except === socket) {
        continue;
      }

      if (socket.readyState !== WebRTCClientReadyState.OPEN) {
        continue;
      }

      try {
        socket.send(serialized);
      } catch (err) {
        this.logger.verbose(`Failed to broadcast to ${socket.remoteAddress}: ${err}`);
        socket.close();
      }
    }
  }
}
