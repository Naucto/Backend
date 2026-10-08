import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';

import { WebRTCService } from '../webrtc.service';
import { WebRTCClientReadyState } from './webrtc.server';
import {
  SyncedGameTableHostDisconnectHandler,
  SyncedGameTableTicketVerifier,
  SyncedGameTableWebRTCServer,
  SyncedGameTableWebRTCServerOptions,
} from './webrtc.server.synced-game-table';
import {
  SyncedGameTableRole,
  SyncedGameTableTicket,
} from './webrtc.server.synced-game-table.ticket';

const HOST_DISCONNECT_GRACE_MS = 15000;

type FakeSocket = EventEmitter & {
  readyState: WebRTCClientReadyState;
  send: jest.Mock;
  close: jest.Mock;
  ping: jest.Mock;
  terminate: jest.Mock;
};

type Frame = Record<string, unknown>;

interface Room {
  host: FakeSocket | null;
  slaves: Map<number, FakeSocket>;
  maxPlayers: number;
  hostGraceTimer: NodeJS.Timeout | null;
}

/** What a test reads of the server: its rooms, and the upgrade ws hands over after a handshake. */
interface Internals {
  wss(): WebSocketServer & { rooms: Map<string, Room> };
  _internal_base_onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

function fakeSocket(): FakeSocket {
  return Object.assign(new EventEmitter(), {
    readyState: WebRTCClientReadyState.OPEN,
    send: jest.fn(),
    close: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn(),
  });
}

function ticket(
  sessionId: string,
  userId: number,
  role: SyncedGameTableRole,
  maxPlayers = 4,
): SyncedGameTableTicket {
  return { sessionId, userId, role, maxPlayers };
}

function framesSentTo(socket: FakeSocket): Frame[] {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string) as Frame);
}

/**
 * A game-table server driven the way ws drives it: an upgrade carrying a ticket, then the socket's own
 * events. Handshakes are faked; everything after them runs the server's real handlers.
 */
function harness(onHostDisconnected?: SyncedGameTableHostDisconnectHandler): {
  server: SyncedGameTableWebRTCServer;
  verifyTicket: jest.MockedFunction<SyncedGameTableTicketVerifier>;
  upgrade(url: string): FakeSocket;
  connect(seat: SyncedGameTableTicket): FakeSocket;
  deliver(socket: FakeSocket, frame: Frame): void;
  disconnect(socket: FakeSocket): void;
  roomOf(sessionId: string): Room | undefined;
} {
  const webrtcService = { registerServer: jest.fn() } as unknown as WebRTCService;
  const verifyTicket: jest.MockedFunction<SyncedGameTableTicketVerifier> = jest.fn();
  const options = new SyncedGameTableWebRTCServerOptions();
  options.port = 14096;

  const server = new SyncedGameTableWebRTCServer(
    webrtcService,
    'test',
    verifyTicket,
    onHostDisconnected,
    options,
  );
  const internals = server as unknown as Internals;

  function upgrade(url: string): FakeSocket {
    const socket = fakeSocket();

    jest
      .spyOn(internals.wss(), 'handleUpgrade')
      .mockImplementationOnce((request, _duplex, _head, done) => {
        done(socket as unknown as WebSocket, request);
      });
    internals._internal_base_onUpgrade(
      { url, socket: { remoteAddress: 'test' } } as IncomingMessage,
      { destroy: jest.fn() } as unknown as Duplex,
      Buffer.alloc(0),
    );

    return socket;
  }

  return {
    server,
    verifyTicket,
    upgrade,
    connect(seat: SyncedGameTableTicket): FakeSocket {
      verifyTicket.mockReturnValueOnce(seat);
      return upgrade('/?ticket=t');
    },
    deliver(socket: FakeSocket, frame: Frame): void {
      socket.emit('message', JSON.stringify(frame));
    },
    disconnect(socket: FakeSocket): void {
      socket.readyState = WebRTCClientReadyState.CLOSED;
      socket.emit('close', 1000, Buffer.alloc(0));
    },
    roomOf(sessionId: string): Room | undefined {
      return internals.wss().rooms.get(sessionId);
    },
  };
}

describe('SyncedGameTableWebRTCServer', () => {
  let table: ReturnType<typeof harness>;
  let host: FakeSocket;
  let slave: FakeSocket;

  beforeEach(() => {
    table = harness();
    host = table.connect(ticket('s1', 1, 'host'));
    slave = table.connect(ticket('s1', 2, 'slave'));
    host.send.mockClear();
  });

  afterEach(() => {
    table.server.shutdown();
  });

  it('relays host state to slaves', () => {
    table.deliver(host, { type: 'state', data: { kind: 'patch', ops: [] } });

    expect(host.close).not.toHaveBeenCalled();
    expect(framesSentTo(slave)).toEqual([{ type: 'state', data: { kind: 'patch', ops: [] } }]);
  });

  it('rejects and closes a slave that tries to broadcast state', () => {
    table.deliver(slave, { type: 'state', data: { hp: 999 } });

    expect(slave.close).toHaveBeenCalled();
    expect(host.send).not.toHaveBeenCalled();
  });

  it('relays a slave request to the host with a server-stamped `from`', () => {
    table.deliver(slave, { type: 'request', data: { kind: 'write' } });

    expect(slave.close).not.toHaveBeenCalled();
    expect(framesSentTo(host)).toEqual([{ type: 'request', from: 2, data: { kind: 'write' } }]);
  });

  it('rejects and closes a host that sends a request', () => {
    table.deliver(host, { type: 'request', data: {} });

    expect(host.close).toHaveBeenCalled();
  });

  it('relays a host response to the addressed slave', () => {
    table.deliver(host, { type: 'response', to: 2, data: { ok: true } });

    expect(framesSentTo(slave)).toEqual([{ type: 'response', data: { ok: true } }]);
  });

  it('rejects and closes a slave that sends a response', () => {
    const other = table.connect(ticket('s1', 3, 'slave'));

    table.deliver(slave, { type: 'response', to: 3, data: { ok: true } });

    expect(slave.close).toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it('relays a slave signal to the host with a server-stamped `from`', () => {
    table.deliver(slave, { type: 'signal', data: { sdp: 'offer' } });

    expect(framesSentTo(host)).toEqual([{ type: 'signal', from: 2, data: { sdp: 'offer' } }]);
  });

  it('relays a host signal to the addressed slave', () => {
    table.deliver(host, { type: 'signal', to: 2, data: { sdp: 'answer' } });

    expect(framesSentTo(slave)).toEqual([{ type: 'signal', data: { sdp: 'answer' } }]);
  });

  it('caps a frame, as any ticket holder may send one', () => {
    const { options } = (table.server as unknown as Internals).wss();

    expect(options.maxPayload).toBe(1024 * 1024);
  });

  it('closeRoom ends the room and disconnects everyone', () => {
    table.server.closeRoom('s1');

    expect(host.close).toHaveBeenCalled();
    expect(slave.close).toHaveBeenCalled();
    expect(table.roomOf('s1')).toBeUndefined();
  });
});

describe('SyncedGameTableWebRTCServer — connection lifecycle', () => {
  let table: ReturnType<typeof harness>;

  beforeEach(() => {
    jest.useFakeTimers();
    table = harness();
  });

  afterEach(() => {
    table.server.shutdown();
    jest.useRealTimers();
  });

  it('rejects a ticketless upgrade', () => {
    const socket = table.upgrade('/');

    expect(socket.terminate).toHaveBeenCalled();
    expect(table.verifyTicket).not.toHaveBeenCalled();
  });

  it('rejects an upgrade whose ticket fails to verify', () => {
    table.verifyTicket.mockImplementationOnce(() => {
      throw new Error('bad ticket');
    });

    const socket = table.upgrade('/?ticket=t');

    expect(socket.terminate).toHaveBeenCalled();
  });

  it('registers the host', () => {
    const host = table.connect(ticket('s2', 1, 'host'));

    expect(table.roomOf('s2')!.host).toBe(host);
  });

  it('rejects a second live host', () => {
    const hostA = table.connect(ticket('s2', 1, 'host'));
    const hostB = table.connect(ticket('s2', 1, 'host'));

    expect(hostB.close).toHaveBeenCalled();
    expect(table.roomOf('s2')!.host).toBe(hostA);
  });

  it('registers a slave and announces it to the host', () => {
    const host = table.connect(ticket('s2', 1, 'host'));
    const slave = table.connect(ticket('s2', 2, 'slave'));

    expect(table.roomOf('s2')!.slaves.get(2)).toBe(slave);
    expect(framesSentTo(host)).toEqual([{ type: 'peer-joined', userId: 2 }]);
  });

  it('rejects a slave when the room is full', () => {
    table.connect(ticket('s2', 1, 'host', 2));
    table.connect(ticket('s2', 2, 'slave', 2));

    const overflow = table.connect(ticket('s2', 3, 'slave', 2));

    expect(overflow.close).toHaveBeenCalled();
    expect(table.roomOf('s2')!.slaves.has(3)).toBe(false);
  });

  it('admits as many slaves as a resize allows, whatever the tickets were minted with', () => {
    table.connect(ticket('s2', 1, 'host', 2));
    table.connect(ticket('s2', 2, 'slave', 2));

    table.server.resizeRoom('s2', 3);
    const admitted = table.connect(ticket('s2', 3, 'slave', 2));
    const refused = table.connect(ticket('s2', 4, 'slave', 8));

    expect(admitted.close).not.toHaveBeenCalled();
    expect(refused.close).toHaveBeenCalled();
    expect([...table.roomOf('s2')!.slaves.keys()]).toEqual([2, 3]);
  });

  it('keeps the resized limit when the host reconnects with an older ticket', () => {
    const host = table.connect(ticket('s2', 1, 'host', 2));
    table.server.resizeRoom('s2', 4);

    table.disconnect(host);
    table.connect(ticket('s2', 1, 'host', 2));

    expect(table.roomOf('s2')!.maxPlayers).toBe(4);
  });

  it('replaces a reconnecting slave, announces it, and survives the stale close', () => {
    const host = table.connect(ticket('s2', 1, 'host'));
    const slaveA = table.connect(ticket('s2', 2, 'slave'));
    host.send.mockClear();

    const slaveB = table.connect(ticket('s2', 2, 'slave'));

    expect(slaveA.close).toHaveBeenCalled();
    expect(table.roomOf('s2')!.slaves.get(2)).toBe(slaveB);

    // Announced again: this is the host's only word that the player is there, and its game keeps
    // no player it was never told about.
    expect(framesSentTo(host)).toEqual([{ type: 'peer-joined', userId: 2 }]);
    host.send.mockClear();

    // The superseded socket's close must not touch the live replacement, nor report it gone.
    table.disconnect(slaveA);
    expect(table.roomOf('s2')!.slaves.get(2)).toBe(slaveB);
    expect(host.send).not.toHaveBeenCalled();
  });

  it('emits peer-left and removes a slave on disconnect', () => {
    const host = table.connect(ticket('s2', 1, 'host'));
    const slave = table.connect(ticket('s2', 2, 'slave'));
    host.send.mockClear();

    table.disconnect(slave);

    expect(table.roomOf('s2')!.slaves.has(2)).toBe(false);
    expect(framesSentTo(host)).toEqual([{ type: 'peer-left', userId: 2 }]);
  });

  it('ends a room whose host never arrives after a slave connected first', () => {
    const slave = table.connect(ticket('s2', 2, 'slave'));
    expect(table.roomOf('s2')!.host).toBeNull();

    jest.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS);

    expect(framesSentTo(slave)).toEqual([{ type: 'session-ended' }]);
    expect(slave.close).toHaveBeenCalled();
    expect(table.roomOf('s2')).toBeUndefined();
  });

  it('keeps a room whose host arrives after its first slave', () => {
    const slave = table.connect(ticket('s2', 2, 'slave'));
    const host = table.connect(ticket('s2', 1, 'host'));

    jest.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS);

    expect(table.roomOf('s2')!.host).toBe(host);
    expect(slave.close).not.toHaveBeenCalled();
  });

  it('drops a socket that missed a heartbeat, without waiting on a close handshake', () => {
    const host = table.connect(ticket('s2', 1, 'host'));

    jest.advanceTimersToNextTimer();
    expect(host.ping).toHaveBeenCalledTimes(1);
    expect(host.terminate).not.toHaveBeenCalled();

    jest.advanceTimersToNextTimer();
    expect(host.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('pings again a socket that answered the last heartbeat', () => {
    const host = table.connect(ticket('s2', 1, 'host'));

    jest.advanceTimersToNextTimer();
    host.emit('pong');
    jest.advanceTimersToNextTimer();

    expect(host.ping).toHaveBeenCalledTimes(2);
    expect(host.terminate).not.toHaveBeenCalled();
  });

  it('keeps the room alive during the host grace window, then ends it', () => {
    const host = table.connect(ticket('s2', 1, 'host'));
    const slave = table.connect(ticket('s2', 2, 'slave'));

    table.disconnect(host);

    // Grace window: the session must NOT be torn down yet — the host is
    // expected to reconnect (dev re-run / network blip).
    expect(table.roomOf('s2')).toBeDefined();
    expect(table.roomOf('s2')!.host).toBeNull();
    expect(slave.send).not.toHaveBeenCalled();
    expect(slave.close).not.toHaveBeenCalled();

    // Host never returns: after the grace window the room ends and slaves are
    // evicted with session-ended.
    jest.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS);

    expect(framesSentTo(slave)).toEqual([{ type: 'session-ended' }]);
    expect(slave.close).toHaveBeenCalled();
    expect(table.roomOf('s2')).toBeUndefined();
  });

  it('cancels the teardown when the host reconnects within the grace window', () => {
    const host = table.connect(ticket('s2', 1, 'host'));
    const slave = table.connect(ticket('s2', 2, 'slave'));

    table.disconnect(host);
    expect(table.roomOf('s2')!.host).toBeNull();

    // Host reconnects with a fresh socket before the window elapses.
    const hostB = table.connect(ticket('s2', 1, 'host'));
    expect(table.roomOf('s2')!.host).toBe(hostB);

    // The scheduled teardown must not fire now that the host is back.
    jest.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS);

    expect(table.roomOf('s2')!.host).toBe(hostB);
    expect(slave.close).not.toHaveBeenCalled();
    expect(table.roomOf('s2')!.slaves.get(2)).toBe(slave);
  });
});

describe('SyncedGameTableWebRTCServer — shutdown', () => {
  let table: ReturnType<typeof harness>;
  let onHostDisconnected: jest.MockedFunction<SyncedGameTableHostDisconnectHandler>;

  beforeEach(() => {
    jest.useFakeTimers();
    onHostDisconnected = jest.fn();
    table = harness(onHostDisconnected);
  });

  afterEach(() => {
    table.server.shutdown();
    jest.useRealTimers();
  });

  it('terminates every tracked client and flags itself as shutting down', () => {
    const { clients } = (table.server as unknown as Internals).wss();
    const clientA = fakeSocket();
    const clientB = fakeSocket();
    clients.add(clientA as unknown as WebSocket);
    clients.add(clientB as unknown as WebSocket);

    table.server.shutdown();

    expect(clientA.terminate).toHaveBeenCalledTimes(1);
    expect(clientB.terminate).toHaveBeenCalledTimes(1);
    expect(table.server.isShuttingDown).toBe(true);
  });

  // The host-disconnect grace is for runtime reconnects; process teardown
  // terminates every socket, and those closes must NOT schedule a grace timer
  // (which would hang shutdown) or end the persisted session (it should survive
  // the restart and be rejoinable).
  it('does not schedule the host grace or end the session on a shutdown close', () => {
    const host = table.connect(ticket('s3', 1, 'host'));
    const slave = table.connect(ticket('s3', 2, 'slave'));

    // Teardown begins, then the host's socket close arrives (as terminate()
    // would drive it).
    table.server.shutdown();
    table.disconnect(host);

    expect(table.roomOf('s3')?.hostGraceTimer).toBeNull();

    jest.advanceTimersByTime(HOST_DISCONNECT_GRACE_MS);

    expect(onHostDisconnected).not.toHaveBeenCalled();
    expect(slave.close).not.toHaveBeenCalled();
  });
});
