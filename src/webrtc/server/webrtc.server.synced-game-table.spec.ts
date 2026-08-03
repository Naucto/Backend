import { WebRTCClientSocket } from "@webrtc/server/webrtc.server";
import { WebRTCService } from "@webrtc/webrtc.service";
import {
  SyncedGameTableRole,
  SyncedGameTableWebRTCServer,
  SyncedGameTableWebRTCServerOptions
} from "@webrtc/server/webrtc.server.synced-game-table";

type FakeSocket = WebRTCClientSocket & {
  send: jest.Mock;
  close: jest.Mock;
};

function fakeSocket(
  sessionId: string,
  userId: number,
  role: SyncedGameTableRole
): FakeSocket {
  return {
    remoteAddress: "test",
    readyState: 1,
    sessionId,
    userId,
    role,
    send: jest.fn(),
    close: jest.fn()
  } as unknown as FakeSocket;
}

describe("SyncedGameTableWebRTCServer", () => {
  const webrtcService = {
    registerServer: jest.fn()
  } as unknown as WebRTCService;
  const verifyTicket = jest.fn();

  let server: SyncedGameTableWebRTCServer;
  let host: FakeSocket;
  let slave: FakeSocket;
  let nextPort = 15096;

  beforeEach(() => {
    const options = new SyncedGameTableWebRTCServerOptions();
    Object.assign(options, { port: nextPort++ });

    server = new SyncedGameTableWebRTCServer(
      webrtcService,
      "test",
      verifyTicket,
      undefined,
      options
    );

    host = fakeSocket("s1", 1, "host");
    slave = fakeSocket("s1", 2, "slave");

    // Seed a room directly on the server socket.
    const rooms = (
      server as unknown as {
        wss(): { rooms: Map<string, unknown> };
      }
    ).wss().rooms;

    rooms.set("s1", {
      host,
      slaves: new Map([[2, slave]]),
      maxPlayers: 4,
      hostGraceTimer: null
    });
  });

  afterEach(() => {
    server.shutdown();
  });

  function onState(socket: FakeSocket, data: unknown): void {
    (
      server as unknown as {
        _internal_sgt_onState(s: FakeSocket, b: unknown): void;
      }
    )._internal_sgt_onState(socket, { type: "state", data });
  }

  function onRequest(socket: FakeSocket, data: unknown): void {
    (
      server as unknown as {
        _internal_sgt_onRequest(s: FakeSocket, b: unknown): void;
      }
    )._internal_sgt_onRequest(socket, { type: "request", data });
  }

  function onResponse(socket: FakeSocket, to: number, data: unknown): void {
    (
      server as unknown as {
        _internal_sgt_onResponse(s: FakeSocket, b: unknown): void;
      }
    )._internal_sgt_onResponse(socket, { type: "response", to, data });
  }

  function onSignal(socket: FakeSocket, body: Record<string, unknown>): void {
    (
      server as unknown as {
        _internal_sgt_onSignal(s: FakeSocket, b: unknown): void;
      }
    )._internal_sgt_onSignal(socket, { type: "signal", ...body });
  }

  // Drives a frame through the REAL message pipeline (JSON decode + DTO
  // validation + dispatch), unlike the on* helpers above which call handlers
  // directly and so never exercise validation.
  function deliver(socket: FakeSocket, frame: Record<string, unknown>): void {
    (
      server as unknown as {
        _internal_eb_onMessage(s: FakeSocket, raw: string): void;
      }
    )._internal_eb_onMessage(socket, JSON.stringify(frame));
  }

  // Regression: the state/request DTOs must carry class-validator metadata, or
  // validateSync (forbidUnknownValues) rejects every frame as "an unknown value"
  // and the pipeline closes the sender — which broke all host->slave state and
  // slave->host input.
  it("validates and dispatches a host state broadcast (does not close the host)", () => {
    deliver(host, { type: "state", data: { kind: "patch", ops: [] } });

    expect(host.close).not.toHaveBeenCalled();
    expect(slave.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(slave.send.mock.calls[0]![0] as string)).toMatchObject({
      type: "state",
      data: { kind: "patch", ops: [] }
    });
  });

  it("validates and dispatches a slave request to the host (does not close the slave)", () => {
    deliver(slave, { type: "request", data: { kind: "write" } });

    expect(slave.close).not.toHaveBeenCalled();
    expect(host.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(host.send.mock.calls[0]![0] as string)).toMatchObject({
      type: "request",
      from: 2,
      data: { kind: "write" }
    });
  });

  it("relays host state to slaves", () => {
    onState(host, { hp: 10 });

    expect(slave.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(slave.send.mock.calls[0]![0] as string);
    expect(payload).toMatchObject({ type: "state", data: { hp: 10 } });
  });

  it("rejects and closes a slave that tries to broadcast state", () => {
    onState(slave, { hp: 999 });

    expect(slave.close).toHaveBeenCalled();
    expect(host.send).not.toHaveBeenCalled();
  });

  it("relays a slave request to the host with a server-stamped `from`", () => {
    onRequest(slave, { action: "read" });

    expect(host.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(host.send.mock.calls[0]![0] as string);
    expect(payload).toMatchObject({
      type: "request",
      from: 2,
      data: { action: "read" }
    });
  });

  it("rejects and closes a host that sends a request", () => {
    onRequest(host, {});

    expect(host.close).toHaveBeenCalled();
  });

  it("relays a host response to the addressed slave", () => {
    onResponse(host, 2, { ok: true });

    expect(slave.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(slave.send.mock.calls[0]![0] as string);
    expect(payload).toMatchObject({ type: "response", data: { ok: true } });
  });

  it("relays a slave signal to the host with a server-stamped `from`", () => {
    onSignal(slave, { data: { sdp: "offer" } });

    expect(host.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(host.send.mock.calls[0]![0] as string);
    expect(payload).toMatchObject({
      type: "signal",
      from: 2,
      data: { sdp: "offer" }
    });
  });

  it("relays a host signal to the addressed slave", () => {
    onSignal(host, { to: 2, data: { sdp: "answer" } });

    expect(slave.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(slave.send.mock.calls[0]![0] as string);
    expect(payload).toMatchObject({ type: "signal", data: { sdp: "answer" } });
  });

  it("closeRoom ends the room and disconnects everyone", () => {
    server.closeRoom("s1");

    expect(host.close).toHaveBeenCalled();
    expect(slave.close).toHaveBeenCalled();

    const rooms = (
      server as unknown as {
        wss(): { rooms: Map<string, unknown> };
      }
    ).wss().rooms;
    expect(rooms.has("s1")).toBe(false);
  });
});

interface Room {
  host: FakeSocket | null;
  slaves: Map<number, FakeSocket>;
  maxPlayers: number;
  hostGraceTimer: NodeJS.Timeout | null;
}

interface Internals {
  _internal_sgt_authenticate(
    req: unknown,
    sock: unknown,
    head: unknown
  ): boolean;
  _internal_sgt_onConnection(
    serverSock: unknown,
    sock: FakeSocket,
    req: unknown
  ): void;
  _internal_sgt_onClose(sock: FakeSocket): void;
  wss(): { rooms: Map<string, Room> };
}

function rawSocket(): FakeSocket {
  return {
    remoteAddress: "test",
    readyState: 1,
    send: jest.fn(),
    close: jest.fn()
  } as unknown as FakeSocket;
}

describe("SyncedGameTableWebRTCServer — connection lifecycle", () => {
  const webrtcService = {
    registerServer: jest.fn()
  } as unknown as WebRTCService;
  const verifyTicket = jest.fn();

  let server: SyncedGameTableWebRTCServer;
  let internals: Internals;
  let nextPort = 16096;

  beforeEach(() => {
    const options = new SyncedGameTableWebRTCServerOptions();
    Object.assign(options, { port: nextPort++ });

    server = new SyncedGameTableWebRTCServer(
      webrtcService,
      "test",
      verifyTicket,
      undefined,
      options
    );
    internals = server as unknown as Internals;
  });

  afterEach(() => {
    server.shutdown();
  });

  function ticket(
    sessionId: string,
    userId: number,
    role: SyncedGameTableRole,
    maxPlayers = 4
  ): unknown {
    return { sessionId, userId, role, maxPlayers };
  }

  function authAndConnect(claims: unknown, socket: FakeSocket): boolean {
    verifyTicket.mockReturnValueOnce(claims);
    const req = { url: "/?ticket=t" };
    const ok = internals._internal_sgt_authenticate(req, {}, Buffer.alloc(0));
    if (ok) {
      internals._internal_sgt_onConnection(internals.wss(), socket, req);
    }
    return ok;
  }

  function roomOf(sessionId: string): Room | undefined {
    return internals.wss().rooms.get(sessionId);
  }

  it("rejects a ticketless upgrade", () => {
    expect(
      internals._internal_sgt_authenticate({ url: "/" }, {}, Buffer.alloc(0))
    ).toBe(false);
    expect(verifyTicket).not.toHaveBeenCalled();
  });

  it("rejects an upgrade whose ticket fails to verify", () => {
    verifyTicket.mockImplementationOnce(() => {
      throw new Error("bad ticket");
    });
    expect(
      internals._internal_sgt_authenticate(
        { url: "/?ticket=t" },
        {},
        Buffer.alloc(0)
      )
    ).toBe(false);
  });

  it("registers the host and stamps its identity", () => {
    const host = rawSocket();
    expect(authAndConnect(ticket("s2", 1, "host"), host)).toBe(true);

    expect(roomOf("s2")!.host).toBe(host);
    expect((host as unknown as { sessionId: string }).sessionId).toBe("s2");
  });

  it("rejects a second live host", () => {
    const hostA = rawSocket();
    const hostB = rawSocket();
    authAndConnect(ticket("s2", 1, "host"), hostA);
    authAndConnect(ticket("s2", 1, "host"), hostB);

    expect(hostB.close).toHaveBeenCalled();
    expect(roomOf("s2")!.host).toBe(hostA);
  });

  it("registers a slave and announces it to the host", () => {
    const host = rawSocket();
    const slave = rawSocket();
    authAndConnect(ticket("s2", 1, "host"), host);
    authAndConnect(ticket("s2", 2, "slave"), slave);

    expect(roomOf("s2")!.slaves.get(2)).toBe(slave);
    expect(JSON.parse(host.send.mock.calls[0]![0] as string)).toMatchObject({
      type: "peer-joined",
      userId: 2
    });
  });

  it("rejects a slave when the room is full", () => {
    const host = rawSocket();
    authAndConnect(ticket("s2", 1, "host", 2), host);
    authAndConnect(ticket("s2", 2, "slave", 2), rawSocket());

    const overflow = rawSocket();
    authAndConnect(ticket("s2", 3, "slave", 2), overflow);

    expect(overflow.close).toHaveBeenCalled();
    expect(roomOf("s2")!.slaves.has(3)).toBe(false);
  });

  it("replaces a reconnecting slave without the stale close evicting it", () => {
    const host = rawSocket();
    const slaveA = rawSocket();
    authAndConnect(ticket("s2", 1, "host"), host);
    authAndConnect(ticket("s2", 2, "slave"), slaveA);
    host.send.mockClear();

    const slaveB = rawSocket();
    authAndConnect(ticket("s2", 2, "slave"), slaveB);

    expect(slaveA.close).toHaveBeenCalled();
    expect(roomOf("s2")!.slaves.get(2)).toBe(slaveB);
    expect(host.send).not.toHaveBeenCalled();

    // The superseded socket's close must not touch the live replacement.
    internals._internal_sgt_onClose(slaveA);
    expect(roomOf("s2")!.slaves.get(2)).toBe(slaveB);
    expect(host.send).not.toHaveBeenCalled();
  });

  it("emits peer-left and removes a slave on disconnect", () => {
    const host = rawSocket();
    const slave = rawSocket();
    authAndConnect(ticket("s2", 1, "host"), host);
    authAndConnect(ticket("s2", 2, "slave"), slave);
    host.send.mockClear();

    internals._internal_sgt_onClose(slave);

    expect(roomOf("s2")!.slaves.has(2)).toBe(false);
    expect(JSON.parse(host.send.mock.calls[0]![0] as string)).toMatchObject({
      type: "peer-left",
      userId: 2
    });
  });

  it("keeps the room alive during the host grace window, then ends it", () => {
    jest.useFakeTimers();
    try {
      const host = rawSocket();
      const slave = rawSocket();
      authAndConnect(ticket("s2", 1, "host"), host);
      authAndConnect(ticket("s2", 2, "slave"), slave);
      slave.send.mockClear();

      internals._internal_sgt_onClose(host);

      // Grace window: the session must NOT be torn down yet — the host is
      // expected to reconnect (dev re-run / network blip).
      expect(roomOf("s2")).toBeDefined();
      expect(roomOf("s2")!.host).toBeNull();
      expect(slave.send).not.toHaveBeenCalled();
      expect(slave.close).not.toHaveBeenCalled();

      // Host never returns: after the grace window the room ends and slaves are
      // evicted with session-ended.
      jest.advanceTimersByTime(15000);

      expect(JSON.parse(slave.send.mock.calls[0]![0] as string)).toMatchObject({
        type: "session-ended"
      });
      expect(slave.close).toHaveBeenCalled();
      expect(roomOf("s2")).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels the teardown when the host reconnects within the grace window", () => {
    jest.useFakeTimers();
    try {
      const host = rawSocket();
      const slave = rawSocket();
      authAndConnect(ticket("s2", 1, "host"), host);
      authAndConnect(ticket("s2", 2, "slave"), slave);
      slave.send.mockClear();

      internals._internal_sgt_onClose(host);
      expect(roomOf("s2")!.host).toBeNull();

      // Host reconnects with a fresh socket before the window elapses.
      const hostB = rawSocket();
      authAndConnect(ticket("s2", 1, "host"), hostB);
      expect(roomOf("s2")!.host).toBe(hostB);

      // The scheduled teardown must not fire now that the host is back.
      jest.advanceTimersByTime(15000);

      expect(roomOf("s2")).toBeDefined();
      expect(roomOf("s2")!.host).toBe(hostB);
      expect(slave.close).not.toHaveBeenCalled();
      expect(roomOf("s2")!.slaves.get(2)).toBe(slave);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("SyncedGameTableWebRTCServer — shutdown", () => {
  const webrtcService = {
    registerServer: jest.fn()
  } as unknown as WebRTCService;
  const verifyTicket = jest.fn();

  let server: SyncedGameTableWebRTCServer;
  let onHostDisconnected: jest.Mock;
  let nextPort = 17096;

  function build(): SyncedGameTableWebRTCServer {
    const options = new SyncedGameTableWebRTCServerOptions();
    Object.assign(options, { port: nextPort++ });

    onHostDisconnected = jest.fn();

    return new SyncedGameTableWebRTCServer(
      webrtcService,
      "test",
      verifyTicket,
      onHostDisconnected,
      options
    );
  }

  afterEach(() => {
    server?.shutdown();
  });

  // Regression: shutdown() used to terminate clients *inside* wss.close()'s
  // callback, which in noServer mode never fires while clients are still alive —
  // so a browser holding a socket open deadlocked the whole process teardown.
  it("terminates every tracked client and flags itself as shutting down", () => {
    server = build();

    const wss = (
      server as unknown as { wss(): { clients: Set<unknown> } }
    ).wss();
    const clientA = { terminate: jest.fn() };
    const clientB = { terminate: jest.fn() };
    wss.clients.add(clientA);
    wss.clients.add(clientB);

    server.shutdown();

    expect(clientA.terminate).toHaveBeenCalledTimes(1);
    expect(clientB.terminate).toHaveBeenCalledTimes(1);
    expect(server.isShuttingDown).toBe(true);
  });

  // The 15s host-disconnect grace is for runtime reconnects; process teardown
  // terminates every socket, and those closes must NOT schedule a grace timer
  // (which would hang shutdown) or end the persisted session (it should survive
  // the restart and be rejoinable).
  it("does not schedule the host grace or end the session on a shutdown close", () => {
    jest.useFakeTimers();
    try {
      server = build();
      const internals = server as unknown as {
        _internal_sgt_authenticate(r: unknown, s: unknown, h: unknown): boolean;
        _internal_sgt_onConnection(sv: unknown, s: FakeSocket, r: unknown): void;
        _internal_sgt_onClose(s: FakeSocket): void;
        wss(): { rooms: Map<string, Room> };
      };

      const host = rawSocket();
      const slave = rawSocket();

      verifyTicket.mockReturnValueOnce({
        sessionId: "s3",
        userId: 1,
        role: "host",
        maxPlayers: 4
      });
      const hostReq = { url: "/?ticket=t" };
      internals._internal_sgt_authenticate(hostReq, {}, Buffer.alloc(0));
      internals._internal_sgt_onConnection(internals.wss(), host, hostReq);

      verifyTicket.mockReturnValueOnce({
        sessionId: "s3",
        userId: 2,
        role: "slave",
        maxPlayers: 4
      });
      const slaveReq = { url: "/?ticket=t" };
      internals._internal_sgt_authenticate(slaveReq, {}, Buffer.alloc(0));
      internals._internal_sgt_onConnection(internals.wss(), slave, slaveReq);
      slave.send.mockClear();

      // Teardown begins, then the host's socket close arrives (as terminate()
      // would drive it).
      server.shutdown();
      internals._internal_sgt_onClose(host);

      const room = internals.wss().rooms.get("s3");
      expect(room?.hostGraceTimer).toBeNull();

      jest.advanceTimersByTime(15000);

      expect(onHostDisconnected).not.toHaveBeenCalled();
      expect(slave.close).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
