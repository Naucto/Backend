import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { availableParallelism } from 'os';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

import { WebRTCService } from '../webrtc.service';
import {
  WebRTCClientEvent,
  WebRTCServer,
  WebRTCServerAuthEvent,
  WebRTCServerOptions,
} from './webrtc.server';

jest.mock('os', () => ({
  ...jest.requireActual<object>('os'),
  availableParallelism: jest.fn(),
}));

class GatedServer extends WebRTCServer {
  public authenticate: () => boolean = () => true;

  @WebRTCServerAuthEvent()
  protected _authenticate(): boolean {
    return this.authenticate();
  }

  @WebRTCClientEvent('message')
  protected _onMessage(): void {
    throw new Error('handler blew up');
  }
}

type FakeClient = EventEmitter & { terminate: jest.Mock };

describe('WebRTCServer', () => {
  const webrtcService = {
    registerServer: jest.fn(),
  } as unknown as WebRTCService;

  let server: GatedServer;

  function build(): GatedServer {
    const options = new WebRTCServerOptions();
    options.port = 14096;
    return new GatedServer(webrtcService, 'test', options);
  }

  function wssOf(instance: GatedServer): WebSocketServer {
    return (instance as unknown as { wss(): WebSocketServer }).wss();
  }

  // Stands in for the HTTP upgrade: the handshake itself belongs to ws, what follows it is ours.
  function upgrade(instance: GatedServer): { client: FakeClient; connected: jest.Mock } {
    const client: FakeClient = Object.assign(new EventEmitter(), { terminate: jest.fn() });
    const connected = jest.fn();
    const wss = wssOf(instance);

    wss.on('connection', connected);
    jest.spyOn(wss, 'handleUpgrade').mockImplementation((request, _socket, _head, done) => {
      done(client as unknown as WebSocket, request);
    });

    (
      instance as unknown as {
        _internal_base_onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
      }
    )._internal_base_onUpgrade(
      { socket: { remoteAddress: 'test' } } as IncomingMessage,
      { destroy: jest.fn() } as unknown as Duplex,
      Buffer.alloc(0),
    );

    return { client, connected };
  }

  beforeEach(() => {
    jest.mocked(availableParallelism).mockReturnValue(8);
  });

  afterEach(() => {
    server?.shutdown();
  });

  it('drops the connection whose handler threw instead of letting the throw escape', () => {
    server = build();
    const { client, connected } = upgrade(server);

    expect(connected).toHaveBeenCalledTimes(1);
    expect(() => client.emit('message', 'frame')).not.toThrow();
    expect(client.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates a client its auth handler denies, before any connection is announced', () => {
    server = build();
    server.authenticate = (): boolean => false;

    const { client, connected } = upgrade(server);

    expect(client.terminate).toHaveBeenCalledTimes(1);
    expect(connected).not.toHaveBeenCalled();
  });

  it('terminates a client whose auth handler throws, before any connection is announced', () => {
    server = build();
    server.authenticate = (): boolean => {
      throw new Error('bad ticket');
    };

    const { client, connected } = upgrade(server);

    expect(client.terminate).toHaveBeenCalledTimes(1);
    expect(connected).not.toHaveBeenCalled();
  });

  it('answers a request that is not an upgrade, as nothing else would', () => {
    server = build();
    const response = { writeHead: jest.fn(), end: jest.fn() };

    (server as unknown as { _httpServer: EventEmitter })._httpServer.emit('request', {}, response);

    expect(response.writeHead).toHaveBeenCalledWith(426, expect.anything());
    expect(response.end).toHaveBeenCalled();
  });

  it.each([[1], [2]])('still bounds compression on a host with %i core(s)', (cores) => {
    jest.mocked(availableParallelism).mockReturnValue(cores);
    server = build();

    const { perMessageDeflate } = wssOf(server).options;

    expect(perMessageDeflate).toMatchObject({ concurrencyLimit: 1 });
  });
});
