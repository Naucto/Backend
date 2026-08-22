import {
  WebRTCClientEvent,
  WebRTCClientSocket,
  WebRTCServerEvent,
  WebRTCServerSocket
} from "@webrtc/server/webrtc.server";
import {
  EventBasedMessage,
  EventBasedWebRTCServer,
  EventBasedWebRTCServerOptions
} from "@webrtc/server/webrtc.server.event-based";
import { WebRTCService } from "@webrtc/webrtc.service";

import { IsArray, IsEnum, IsString } from "class-validator";

// ----------------------------------------------------------------------------

type YjsWebRTCTopicID = string;

type YjsWebRTCClientSocket = WebRTCClientSocket<{
  pinged: boolean;
  pingChecker: NodeJS.Timeout;
  subscribedTopics: Set<YjsWebRTCTopicID>;
}>;

type YjsWebRTCServerSocket = WebRTCServerSocket<{
  topics: Map<YjsWebRTCTopicID, Set<YjsWebRTCClientSocket>>;
}>;

// ----------------------------------------------------------------------------

enum YjsMessageType {
  SUBSCRIBE = "subscribe",
  UNSUBSCRIBE = "unsubscribe",
  PUBLISH = "publish",
  PING = "ping",
  PONG = "pong"
}

class YjsMessage {
  @IsEnum(YjsMessageType)
  type!: YjsMessageType;
}

class YjsMessageSubscribe extends YjsMessage {
  @IsArray()
  @IsString({ each: true })
  topics!: YjsWebRTCTopicID[];
}

class YjsMessageUnsubscribe extends YjsMessage {
  @IsArray()
  @IsString({ each: true })
  topics!: YjsWebRTCTopicID[];
}

class YjsMessagePublish extends YjsMessage {
  @IsString()
  topic!: YjsWebRTCTopicID;

  data?: unknown;
}

class YjsMessagePing extends YjsMessage {}

// ----------------------------------------------------------------------------

export class YjsWebRTCServerOptions extends EventBasedWebRTCServerOptions {
  pingTimeout: number = 30000;
}

// y-webrtc compatible signaling/relay server. The message handling
// (subscribe/unsubscribe/publish/ping) is expressed as @EventBasedMessage
// handlers; the per-socket ping lifecycle and topic bookkeeping remain
// Yjs-specific.
export class YjsWebRTCServer extends EventBasedWebRTCServer<YjsWebRTCServerOptions> {
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

    clientSocket.pinged = true;
    clientSocket.pingChecker = setInterval(() => {
      if (!clientSocket.pinged) {
        this.logger.verbose(
          `Client ${clientSocket.remoteAddress} ping timed out`
        );
        clearInterval(clientSocket.pingChecker);
        clientSocket.close();
        return;
      }

      clientSocket.pinged = false;

      try {
        clientSocket.ping();
      } catch (err) {
        this.logger.verbose(
          `Failed to ping client ${clientSocket.remoteAddress}: ${err}`
        );
        clientSocket.close();
      }
    }, this.extraOpts.pingTimeout);
  }

  @WebRTCClientEvent("close")
  protected _internal_yjs_onClosed(socket: YjsWebRTCClientSocket): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    clearInterval(socket.pingChecker);

    socket.subscribedTopics.forEach((topicId) => {
      const topic = serverSocket.topics.get(topicId);

      if (topic === undefined) return;

      topic.delete(socket);

      if (topic.size === 0) {
        serverSocket.topics.delete(topicId);
      }
    });
  }

  @WebRTCClientEvent("pong")
  protected _internal_yjs_onPonged(socket: YjsWebRTCClientSocket): void {
    socket.pinged = true;
  }

  @EventBasedMessage(YjsMessageType.SUBSCRIBE, YjsMessageSubscribe)
  protected _internal_yjs_onSubscribe(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessageSubscribe
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    messageBody.topics.forEach((topicId) => {
      if (!serverSocket.topics.has(topicId)) {
        serverSocket.topics.set(topicId, new Set<YjsWebRTCClientSocket>());
      }

      const topic = serverSocket.topics.get(topicId)!;

      if (!topic.has(socket)) {
        topic.add(socket);
        socket.subscribedTopics.add(topicId);
      }
    });
  }

  @EventBasedMessage(YjsMessageType.UNSUBSCRIBE, YjsMessageUnsubscribe)
  protected _internal_yjs_onUnsubscribe(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessageUnsubscribe
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    messageBody.topics.forEach((topicId) => {
      if (!serverSocket.topics.has(topicId)) {
        return;
      }

      const topic = serverSocket.topics.get(topicId)!;

      topic.delete(socket);
      socket.subscribedTopics.delete(topicId);
    });
  }

  @EventBasedMessage(YjsMessageType.PUBLISH, YjsMessagePublish)
  protected _internal_yjs_onPublish(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessagePublish
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();
    const topic = serverSocket.topics.get(messageBody.topic);

    if (!topic) return;

    this.broadcast(topic, { ...messageBody }, { except: socket });
  }

  @EventBasedMessage(YjsMessageType.PING, YjsMessagePing)
  protected _internal_yjs_onPing(socket: YjsWebRTCClientSocket): void {
    this.send(socket, { type: YjsMessageType.PONG });
  }
}
