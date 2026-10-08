import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

import { WebRTCService } from '../webrtc.service';
import { WebRTCClientReadyState } from './webrtc.server';
import { YjsWebRTCServer, YjsWebRTCServerOptions } from './webrtc.server.yjs';

type FakeSocket = EventEmitter & {
  readyState: WebRTCClientReadyState;
  send: jest.Mock;
  close: jest.Mock;
  ping: jest.Mock;
  terminate: jest.Mock;
};

/** What a test reads of the server: its topics, and the upgrade ws hands over after a handshake. */
type Internals = {
  wss(): WebSocketServer & { topics: Map<string, Set<FakeSocket>> };
  _internal_base_onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
};

describe('YjsWebRTCServer', () => {
  const webrtcService = {
    registerServer: jest.fn(),
  } as unknown as WebRTCService;

  let server: YjsWebRTCServer;
  let internals: Internals;

  beforeEach(() => {
    jest.useFakeTimers();

    const options = new YjsWebRTCServerOptions();
    options.port = 14096;

    server = new YjsWebRTCServer(webrtcService, 'test', options);
    internals = server as unknown as Internals;
  });

  afterEach(() => {
    server.shutdown();
    jest.useRealTimers();
  });

  // Fakes the handshake only: everything after it runs the server's real handlers.
  function connect(): FakeSocket {
    const socket: FakeSocket = Object.assign(new EventEmitter(), {
      readyState: WebRTCClientReadyState.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
    });

    jest
      .spyOn(internals.wss(), 'handleUpgrade')
      .mockImplementationOnce((request, _duplex, _head, done) => {
        done(socket as unknown as WebSocket, request);
      });
    internals._internal_base_onUpgrade(
      { socket: { remoteAddress: 'test' } } as IncomingMessage,
      { destroy: jest.fn() } as unknown as Duplex,
      Buffer.alloc(0),
    );

    return socket;
  }

  function deliver(socket: FakeSocket, frame: Record<string, unknown>): void {
    socket.emit('message', JSON.stringify(frame));
  }

  it("relays a publish to the topic's other subscribers, never back to its sender", () => {
    const sender = connect();
    const peer = connect();
    const stranger = connect();
    deliver(sender, { type: 'subscribe', topics: ['room'] });
    deliver(peer, { type: 'subscribe', topics: ['room'] });
    deliver(stranger, { type: 'subscribe', topics: ['elsewhere'] });

    deliver(sender, { type: 'publish', topic: 'room', data: { sdp: 'offer' } });

    expect(peer.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(peer.send.mock.calls[0]![0] as string)).toEqual({
      type: 'publish',
      topic: 'room',
      data: { sdp: 'offer' },
    });
    expect(sender.send).not.toHaveBeenCalled();
    expect(stranger.send).not.toHaveBeenCalled();
  });

  it('stops delivering after an unsubscribe and forgets a topic left empty', () => {
    const sender = connect();
    const peer = connect();
    deliver(sender, { type: 'subscribe', topics: ['room'] });
    deliver(peer, { type: 'subscribe', topics: ['room'] });

    deliver(peer, { type: 'unsubscribe', topics: ['room'] });
    deliver(sender, { type: 'publish', topic: 'room', data: 1 });

    expect(peer.send).not.toHaveBeenCalled();
    expect(internals.wss().topics.has('room')).toBe(true);

    deliver(sender, { type: 'unsubscribe', topics: ['room'] });

    expect(internals.wss().topics.has('room')).toBe(false);
  });

  it('takes a closing socket out of every topic and forgets those left empty', () => {
    const leaving = connect();
    const staying = connect();
    deliver(leaving, { type: 'subscribe', topics: ['shared', 'alone'] });
    deliver(staying, { type: 'subscribe', topics: ['shared'] });

    leaving.emit('close', 1000, Buffer.alloc(0));

    const { topics } = internals.wss();
    expect(topics.has('alone')).toBe(false);
    expect([...topics.get('shared')!]).toEqual([staying]);
  });

  it('drops a socket that missed a heartbeat, without waiting on a close handshake', () => {
    const socket = connect();

    jest.advanceTimersToNextTimer();
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();

    jest.advanceTimersToNextTimer();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('pings again a socket that answered the last heartbeat', () => {
    const socket = connect();

    jest.advanceTimersToNextTimer();
    socket.emit('pong');
    jest.advanceTimersToNextTimer();

    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it("caps a frame well under the library's default, as it only relays signalling", () => {
    expect(internals.wss().options.maxPayload).toBe(64 * 1024);
  });
});
