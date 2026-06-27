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

    rooms.set("s1", { host, slaves: new Map([[2, slave]]), maxPlayers: 4 });
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

  it("ends the room when the host disconnects", () => {
    const host = rawSocket();
    const slave = rawSocket();
    authAndConnect(ticket("s2", 1, "host"), host);
    authAndConnect(ticket("s2", 2, "slave"), slave);

    internals._internal_sgt_onClose(host);

    expect(JSON.parse(slave.send.mock.calls[0]![0] as string)).toMatchObject({
      type: "session-ended"
    });
    expect(slave.close).toHaveBeenCalled();
    expect(roomOf("s2")).toBeUndefined();
  });
});
