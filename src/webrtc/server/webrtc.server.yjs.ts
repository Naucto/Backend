import { IsArray, IsEnum, IsString } from 'class-validator';

import { WebRTCService } from '../webrtc.service';
import {
  WEBRTC_SERVER_NAMES,
  WebRTCClientEvent,
  WebRTCClientSocket,
  WebRTCServerEvent,
  WebRTCServerName,
  WebRTCServerSocket,
} from './webrtc.server';
import {
  EventBasedMessage,
  EventBasedWebRTCServer,
  EventBasedWebRTCServerOptions,
} from './webrtc.server.event-based';

type YjsWebRTCTopicID = string;

type YjsWebRTCClientSocket = WebRTCClientSocket<{
  subscribedTopics: Set<YjsWebRTCTopicID>;
}>;

type YjsWebRTCServerSocket = WebRTCServerSocket<{
  topics: Map<YjsWebRTCTopicID, Set<YjsWebRTCClientSocket>>;
}>;

// The signalling protocol of y-webrtc, which the editor's collaboration provider speaks; the names
// are that library's, not ours to change.
enum YjsMessageType {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  PUBLISH = 'publish',
  PING = 'ping',
  PONG = 'pong',
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

export class YjsWebRTCServerOptions extends EventBasedWebRTCServerOptions {
  override name: WebRTCServerName = WEBRTC_SERVER_NAMES.collab;
  /** Signalling only: session descriptions and candidates, a few kilobytes each. */
  override maxPayload: number = 64 * 1024;
}

// Signalling server compatible with y-webrtc: topic subscriptions, and a publish relayed to the
// topic's other subscribers.
export class YjsWebRTCServer extends EventBasedWebRTCServer<YjsWebRTCServerOptions> {
  constructor(
    webrtcService: WebRTCService,
    whatFor: string,
    extraOpts: YjsWebRTCServerOptions = new YjsWebRTCServerOptions(),
  ) {
    super(webrtcService, whatFor, extraOpts);

    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    serverSocket.topics = new Map<string, Set<YjsWebRTCClientSocket>>();
  }

  @WebRTCServerEvent('connection')
  protected _internal_yjs_onConnection(
    _serverSocket: YjsWebRTCServerSocket,
    clientSocket: YjsWebRTCClientSocket,
  ): void {
    clientSocket.subscribedTopics = new Set<string>();
  }

  @WebRTCClientEvent('close')
  protected _internal_yjs_onClosed(socket: YjsWebRTCClientSocket): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    socket.subscribedTopics.forEach((topicId) => {
      const topic = serverSocket.topics.get(topicId);

      if (topic === undefined) {
        return;
      }

      topic.delete(socket);

      if (topic.size === 0) {
        serverSocket.topics.delete(topicId);
      }
    });
  }

  @EventBasedMessage(YjsMessageType.SUBSCRIBE, YjsMessageSubscribe)
  protected _internal_yjs_onSubscribe(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessageSubscribe,
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
    messageBody: YjsMessageUnsubscribe,
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();

    messageBody.topics.forEach((topicId) => {
      if (!serverSocket.topics.has(topicId)) {
        return;
      }

      const topic = serverSocket.topics.get(topicId)!;

      topic.delete(socket);
      socket.subscribedTopics.delete(topicId);

      if (topic.size === 0) {
        serverSocket.topics.delete(topicId);
      }
    });
  }

  @EventBasedMessage(YjsMessageType.PUBLISH, YjsMessagePublish)
  protected _internal_yjs_onPublish(
    socket: YjsWebRTCClientSocket,
    messageBody: YjsMessagePublish,
  ): void {
    const serverSocket = this.wss<YjsWebRTCServerSocket>();
    const topic = serverSocket.topics.get(messageBody.topic);

    if (!topic) {
      return;
    }

    this.broadcast(topic, { ...messageBody }, { except: socket });
  }

  @EventBasedMessage(YjsMessageType.PING, YjsMessagePing)
  protected _internal_yjs_onPing(socket: YjsWebRTCClientSocket): void {
    this.send(socket, { type: YjsMessageType.PONG });
  }
}
