import { JwtService } from '@nestjs/jwt';
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

import { PresenceSocketHandler } from '../presence/presence.types';
import { WebRTCClientReadyState } from '../webrtc/server/webrtc.server';
import { WebRTCService } from '../webrtc/webrtc.service';
import { NotificationsService } from './notifications.service';
import { NotificationPayload } from './notifications.types';
import {
  NotificationWebRTCServer,
  NotificationWebRTCServerOptions,
} from './notifications.webrtc-server';

type FakeSocket = EventEmitter & {
  readyState: WebRTCClientReadyState;
  close: jest.Mock;
  send: jest.Mock;
  ping: jest.Mock;
  terminate: jest.Mock;
};

/** What a test reads of the server: its clients, and the upgrade ws hands over after a handshake. */
type ServerInternals = {
  wss(): WebSocketServer & { privateClients: Map<number, Set<FakeSocket>> };
  _internal_base_onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
};

const TOKENS: Record<string, unknown> = {
  'token-of-7': 7,
  'token-of-8': 8,
  'token-without-user': 'seven',
};

const notification: NotificationPayload = {
  id: '1',
  userId: 7,
  title: 'Build complete',
  message: 'Your build is ready.',
  type: 'INFO',
  kind: 'GENERIC',
  data: null,
  read: false,
  createdAt: '2026-06-07T09:00:00.000Z',
};

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('NotificationWebRTCServer', () => {
  const webrtcService = {
    registerServer: jest.fn(),
  } as unknown as WebRTCService;

  const jwtService = {
    verify: jest.fn((token: string) => {
      if (!(token in TOKENS)) {
        throw new Error('invalid token');
      }
      return { sub: TOKENS[token] };
    }),
  };

  let notificationsService: {
    getUserNotifications: jest.Mock;
    isActiveUser: jest.Mock;
  };
  let presence: jest.Mocked<PresenceSocketHandler>;
  let server: NotificationWebRTCServer;
  let internals: ServerInternals;
  let sockets: FakeSocket[];
  let nextPort = 18096;

  beforeEach(() => {
    notificationsService = {
      getUserNotifications: jest.fn().mockResolvedValue([]),
      isActiveUser: jest.fn().mockResolvedValue(true),
    };
    presence = {
      onSocketOpen: jest.fn().mockResolvedValue([]),
      onSocketClose: jest.fn().mockResolvedValue(undefined),
      onSet: jest.fn().mockResolvedValue(undefined),
    };

    const options = new NotificationWebRTCServerOptions();
    options.port = nextPort++;
    server = new NotificationWebRTCServer(
      webrtcService,
      'test',
      jwtService as unknown as JwtService,
      notificationsService as unknown as NotificationsService,
      options,
    );
    internals = server as unknown as ServerInternals;
    sockets = [];
  });

  afterEach(() => {
    sockets.forEach((socket) => disconnect(socket));
    server.shutdown();
    jest.useRealTimers();
  });

  // Fakes the handshake only: everything after it runs the server's real handlers.
  function connect(): FakeSocket {
    const socket: FakeSocket = Object.assign(new EventEmitter(), {
      readyState: WebRTCClientReadyState.OPEN,
      close: jest.fn(),
      send: jest.fn(),
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

    sockets.push(socket);
    return socket;
  }

  function receive(socket: FakeSocket, message: unknown): void {
    socket.emit('message', JSON.stringify(message));
  }

  function disconnect(socket: FakeSocket): void {
    if (socket.readyState === WebRTCClientReadyState.CLOSED) {
      return;
    }

    socket.readyState = WebRTCClientReadyState.CLOSED;
    socket.emit('close', 1000, Buffer.alloc(0));
  }

  async function authenticate(token: string): Promise<FakeSocket> {
    const socket = connect();
    receive(socket, { type: 'auth', token });
    await flush();
    return socket;
  }

  function sent(socket: FakeSocket): Array<{ type: string; payload?: unknown }> {
    return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string));
  }

  describe('authentication', () => {
    it('sends the stored notifications to an authenticated socket', async () => {
      notificationsService.getUserNotifications.mockResolvedValue([notification]);

      const socket = await authenticate('token-of-7');

      expect(notificationsService.getUserNotifications).toHaveBeenCalledWith(7);
      expect(sent(socket)).toEqual([{ type: 'notifications:init', payload: [notification] }]);
      expect(socket.close).not.toHaveBeenCalled();
    });

    it.each(['forged', 'token-without-user'])(
      'closes a socket whose token names no user (%s)',
      async (token) => {
        const socket = await authenticate(token);

        expect(socket.close).toHaveBeenCalled();
        expect(sent(socket)).toEqual([]);
        expect(internals.wss().privateClients.size).toBe(0);
      },
    );

    it('closes a socket whose account can no longer sign in', async () => {
      server.setPresenceHandler(presence);
      notificationsService.isActiveUser.mockResolvedValue(false);

      const socket = await authenticate('token-of-7');
      server.sendToUser(7, notification);

      expect(notificationsService.isActiveUser).toHaveBeenCalledWith(7);
      expect(socket.close).toHaveBeenCalled();
      expect(sent(socket)).toEqual([]);
      expect(presence.onSocketOpen).not.toHaveBeenCalled();
    });

    it('does not register a socket that closed while its account was looked up', async () => {
      server.setPresenceHandler(presence);
      let finishLookup: (active: boolean) => void = () => undefined;
      notificationsService.isActiveUser.mockReturnValue(
        new Promise<boolean>((resolve) => (finishLookup = resolve)),
      );

      const socket = connect();
      receive(socket, { type: 'auth', token: 'token-of-7' });
      disconnect(socket);
      finishLookup(true);
      await flush();

      expect(internals.wss().privateClients.size).toBe(0);
      expect(presence.onSocketOpen).not.toHaveBeenCalled();
    });

    it('announces the stored notifications only once presence knows the user', async () => {
      server.setPresenceHandler(presence);
      let finishOpen: (snapshot: []) => void = () => undefined;
      presence.onSocketOpen.mockReturnValue(new Promise((resolve) => (finishOpen = resolve)));

      const socket = await authenticate('token-of-7');
      expect(sent(socket)).toEqual([]);

      finishOpen([]);
      await flush();

      expect(sent(socket).map((message) => message.type)).toEqual([
        'presence:snapshot',
        'notifications:init',
      ]);
    });

    it('reports a failed load of the stored notifications', async () => {
      const warn = jest.spyOn(server.logger, 'warn').mockImplementation();
      notificationsService.getUserNotifications.mockRejectedValue(
        new Error('database unreachable'),
      );

      const socket = await authenticate('token-of-7');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('database unreachable'));
      expect(sent(socket)).toEqual([{ type: 'notifications:init', payload: [] }]);
    });
  });

  describe('per-user delivery', () => {
    it('reaches every socket of the user and no socket of anyone else', async () => {
      const first = await authenticate('token-of-7');
      const second = await authenticate('token-of-7');
      const other = await authenticate('token-of-8');

      server.sendToUser(7, notification);

      const delivered = { type: 'notification', payload: notification };
      expect(sent(first)).toContainEqual(delivered);
      expect(sent(second)).toContainEqual(delivered);
      expect(sent(other)).not.toContainEqual(delivered);
    });

    it('stops reaching a socket that closed and forgets a user with none left', async () => {
      const first = await authenticate('token-of-7');
      const second = await authenticate('token-of-7');

      disconnect(first);
      server.sendToUser(7, notification);

      expect(sent(second)).toContainEqual({
        type: 'notification',
        payload: notification,
      });
      expect(internals.wss().privateClients.get(7)).toEqual(new Set([second]));

      disconnect(second);

      expect(internals.wss().privateClients.has(7)).toBe(false);
    });

    it("tells presence when a user's socket opens and closes", async () => {
      server.setPresenceHandler(presence);

      const socket = await authenticate('token-of-7');
      expect(presence.onSocketOpen).toHaveBeenCalledWith(7);
      expect(presence.onSocketClose).not.toHaveBeenCalled();

      disconnect(socket);
      expect(presence.onSocketClose).toHaveBeenCalledWith(7);
    });
  });

  describe('messages', () => {
    it('answers a ping', () => {
      const socket = connect();

      receive(socket, { type: 'ping' });

      expect(sent(socket)).toEqual([{ type: 'pong' }]);
    });

    it('ignores a presence update from a socket that has not authenticated', () => {
      server.setPresenceHandler(presence);
      const socket = connect();

      receive(socket, { type: 'presence:set', kind: 'PLAYING', releaseId: 42 });

      expect(presence.onSet).not.toHaveBeenCalled();
    });

    it("hands a presence update to presence under the socket's user", async () => {
      server.setPresenceHandler(presence);
      const socket = await authenticate('token-of-7');

      receive(socket, { type: 'presence:set', kind: 'PLAYING', releaseId: 42 });

      expect(presence.onSet).toHaveBeenCalledWith(7, {
        kind: 'PLAYING',
        releaseId: 42,
        projectId: null,
      });
    });

    it('closes a socket that sends a message of an unknown type', () => {
      const socket = connect();

      receive(socket, { type: 'subscribe' });

      expect(socket.close).toHaveBeenCalled();
    });

    it.each(['{', '"hello"', '42', 'null', '[{"type":"ping"}]'])(
      'closes a socket whose frame is not a JSON object (%s)',
      (frame) => {
        const socket = connect();

        expect(() => socket.emit('message', frame)).not.toThrow();

        expect(socket.close).toHaveBeenCalled();
        expect(sent(socket)).toEqual([]);
      },
    );

    it("caps a frame far below the library's own limit", () => {
      expect(internals.wss().options.maxPayload).toBeLessThanOrEqual(64 * 1024);
    });
  });

  describe('heartbeat', () => {
    const interval = new NotificationWebRTCServerOptions().heartbeatIntervalMs;

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });

    it('closes a socket that has not authenticated within one interval', () => {
      const socket = connect();

      jest.advanceTimersByTime(interval);

      expect(socket.close).toHaveBeenCalled();
      expect(socket.ping).not.toHaveBeenCalled();
    });

    it('keeps an authenticated socket that answers its pings', async () => {
      const socket = await authenticate('token-of-7');

      jest.advanceTimersByTime(interval);
      expect(socket.ping).toHaveBeenCalledTimes(1);
      socket.emit('pong');
      jest.advanceTimersByTime(interval);

      expect(socket.ping).toHaveBeenCalledTimes(2);
      expect(socket.close).not.toHaveBeenCalled();
    });

    it('drops an authenticated socket that missed a pong', async () => {
      const socket = await authenticate('token-of-7');

      jest.advanceTimersByTime(interval);
      expect(socket.terminate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(interval);

      expect(socket.terminate).toHaveBeenCalled();
      expect(socket.ping).toHaveBeenCalledTimes(1);
    });

    it('stops pinging a socket that closed', async () => {
      const socket = await authenticate('token-of-7');

      disconnect(socket);
      jest.advanceTimersByTime(interval * 2);

      expect(socket.ping).not.toHaveBeenCalled();
    });
  });
});
