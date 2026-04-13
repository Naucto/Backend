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
import { IsArray, IsEnum, IsString, ValidateNested, validateSync } from "class-validator";

// ----------------------------------------------------------------------------

type YjsWebRTCTopicID = string;

type YjsWebRTCClientSocket = WebRTCClientSocket<{
  pinged: boolean,
  pingChecker: NodeJS.Timeout,
  subscribedTopics: Set<YjsWebRTCTopicID>
}>;

type YjsWebRTCServerSocket = WebRTCServerSocket<{
  topics: Map<YjsWebRTCTopicID, Set<YjsWebRTCClientSocket>>
}>;

// ----------------------------------------------------------------------------

enum YjsMessageType {
  SUBSCRIBE   = "subscribe",
  UNSUBSCRIBE = "unsubscribe",
  PUBLISH     = "publish",
  PING        = "ping",
  PONG        = "pong"
};

class YjsMessage {
  @IsEnum(YjsMessageType)
    type!: YjsMessageType;
};

class YjsMessageSubscribe extends YjsMessage {
  @IsArray()
  @ValidateNested()
    topics!: YjsWebRTCTopicID[];
};

class YjsMessageUnsubscribe extends YjsMessage {
  @IsArray()
  @ValidateNested()
    topics!: YjsWebRTCTopicID[];
};

class YjsMessagePublish extends YjsMessage {
  @IsString()
    topic!: YjsWebRTCTopicID;
};

class YjsMessagePing extends YjsMessage {};

type YjsMessageConstructor  = new (...args: unknown[]) => object;
type YjsMessageTypeRegistry = Record<YjsMessageType, YjsMessageConstructor>;

// ----------------------------------------------------------------------------

export class YjsWebRTCServerOptions extends WebRTCServerOptions {
  pingTimeout: number = 30000;
};

export class YjsWebRTCServer extends WebRTCServer<YjsWebRTCServerOptions> {
  private static readonly TYPE_CONVERTERS: YjsMessageTypeRegistry = {
    [YjsMessageType.SUBSCRIBE]:   YjsMessageSubscribe,
    [YjsMessageType.UNSUBSCRIBE]: YjsMessageUnsubscribe,
    [YjsMessageType.PUBLISH]:     YjsMessagePublish,
    [YjsMessageType.PING]:        YjsMessagePing,
    [YjsMessageType.PONG]:        YjsMessage
  } as const;

  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    extraOpts: YjsWebRTCServerOptions = new YjsWebRTCServerOptions()
  ) {
    super(webrtcService, whatFor, extraOpts);

    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    serverSocket.topics = new Map<string, Set<YjsWebRTCClientSocket>>();
  }

  @WebRTCServerEvent("connection")
  protected _internal_yjs_onConnection(
    _serverSocket: YjsWebRTCServerSocket,
    clientSocket: YjsWebRTCClientSocket
  ): void {
    clientSocket.subscribedTopics = new Set<string>();

    clientSocket.pinged           = false;
    clientSocket.pingChecker      = setInterval(() => {
      if (!clientSocket.pinged) {
        this.logger.verbose(`Client ${clientSocket.remoteAddress} ping time out`);
        clearInterval(clientSocket.pingChecker);

        return;
      }

      clientSocket.pinged = false;

      try {
        clientSocket.ping();
      } catch (err) {
        this.logger.verbose(`Failed to ping client ${clientSocket.remoteAddress}: ${err}`);
        clientSocket.close();
      }
    }, this.extraOpts.pingTimeout);
  }

  @WebRTCClientEvent("close")
  protected _internal_yjs_onClosed(socket: YjsWebRTCClientSocket): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    socket.subscribedTopics.forEach(
      (topicId) => {
        const topic = serverSocket.topics.get(topicId);

        if (topic === undefined)
          return;
        
        topic.delete(socket);

        if (topic.size === 0) {
          serverSocket.topics.delete(topicId);
        }
      }
    );
  }

  @WebRTCClientEvent("pong")
  protected _internal_yjs_onPonged(socket: YjsWebRTCClientSocket): void {
    socket.pinged = true;
  }

  @WebRTCClientEvent("message")
  protected _internal_yjs_onMessage(
    socket: YjsWebRTCClientSocket,
    rawData: RawData | Buffer | string
  ): void {
    const validateInternal = <T extends object>(object: T): void => {
      const errors = validateSync(object);

      if (errors.length === 0)
        return;

      this.logger.verbose(`Data validation failed for ${socket.remoteAddress}`);

      errors.forEach(error => {
        const path = error.children?.length 
          ? `${error.property}.${error.children[0]!.property}` 
          : error.property;
        
        this.logger.verbose(`${path}: ${Object.values(error.constraints || {}).join(", ")}`);
      });

      // Client badly behaved, kick them >:3
      socket.close();
    };

    let rawBody;

    try {
      if (Buffer.isBuffer(rawData)) {
        rawBody = JSON.parse(rawData.toString("utf-8"));
      } else if (rawData instanceof ArrayBuffer) {
        const bytes = new Uint8Array(rawData);
        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(bytes);

        rawBody = JSON.parse(text);
      } else if (Array.isArray(rawData)) {
        const combined = Buffer.concat(rawData as Buffer[]);

        rawBody = JSON.parse(combined.toString("utf-8"));
      } else {
        rawBody = JSON.parse(rawData);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        this.logger.verbose(`Failed to parse received JSON body from ${socket.remoteAddress}`);
      }

      this.logger.error(`Unexpected error: ${err}`);
      throw err;
    }

    const baseNotificationBody = plainToInstance(YjsMessage, rawBody);
    validateInternal(baseNotificationBody);

    const targetNotificationClass =
      YjsWebRTCServer.TYPE_CONVERTERS[baseNotificationBody.type];

    const messageBody = plainToInstance(
      targetNotificationClass,
      baseNotificationBody
    );

    validateInternal(messageBody);

    switch (baseNotificationBody.type) {
    case YjsMessageType.SUBSCRIBE:
      this._internal_yjs_onMessage_subscribe(socket, messageBody as YjsMessageSubscribe);
      break;

    case YjsMessageType.UNSUBSCRIBE:
      this._internal_yjs_onMessage_unsubscribe(socket, messageBody as YjsMessageUnsubscribe);
      break;

    case YjsMessageType.PUBLISH:
      this._internal_yjs_onMessage_publish(socket, messageBody as YjsMessagePublish);
      break;

    case YjsMessageType.PING:
      this._internal_yjs_onMessage_ping(socket);
      break;
    }
  }

  private _internal_yjs_send(
    socket: YjsWebRTCClientSocket,
    response: YjsMessage
  ): void {
    if (socket.readyState !== WebRTCClientReadyState.CONNECTING &&
        socket.readyState !== WebRTCClientReadyState.OPEN) {
      const stateName = WebRTCClientReadyState[socket.readyState];

      this.logger.verbose(
        `Attempt to send a message to ${socket.remoteAddress} with state ${stateName}`
      );

      socket.close();

      return;
    }

    try {
      socket.send(
        JSON.stringify(response)
      );
    } catch (err) {
      this.logger.verbose(
        `Failed to send a message to ${socket.remoteAddress}: ${err}`
      );

      socket.close();
    }
  }

  private _internal_yjs_onMessage_subscribe(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessageSubscribe
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    messageBody.topics.forEach(topicId => {
      if (!serverSocket.topics.has(topicId)) {
        serverSocket.topics.set(topicId, new Set<YjsWebRTCClientSocket>());
      }

      const topic = serverSocket.topics.get(topicId)!;

      topic.add(socket);
      socket.subscribedTopics.add(topicId);
    });
  }

  private _internal_yjs_onMessage_unsubscribe(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessageUnsubscribe
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    messageBody.topics.forEach(topicId => {
      if (!serverSocket.topics.has(topicId)) {
        return;
      }

      const topic = serverSocket.topics.get(topicId)!;

      topic.delete(socket);
      socket.subscribedTopics.delete(topicId);
    });
  }

  private _internal_yjs_onMessage_publish(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessagePublish
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();
    const topicId = messageBody.topic;

    if (!serverSocket.topics.has(topicId)) {
      return;
    }

    socket.subscribedTopics.delete(topicId);

    const topic = serverSocket.topics.get(topicId)!;
    topic.delete(socket);

    if (topic.size === 0) {
      serverSocket.topics.delete(topicId);
    }
  }

  private _internal_yjs_onMessage_ping(socket: YjsWebRTCClientSocket): void {
    const responseBody: YjsMessage = { type: YjsMessageType.PONG };

    this._internal_yjs_send(socket, responseBody);
  }
};
