import { WebRTCClientSocket } from "@webrtc/server/webrtc.server";
import { YjsWebRTCServer, YjsWebRTCServerOptions } from "@webrtc/server/webrtc.server.yjs";
import { WebRTCService } from "@webrtc/webrtc.service";

type FakeSocket = WebRTCClientSocket & {
  send: jest.Mock;
  close: jest.Mock;
  ping: jest.Mock;
  terminate: jest.Mock;
};

type Internals = {
  _internal_yjs_onConnection(server: unknown, socket: FakeSocket): void;
  _internal_yjs_onClosed(socket: FakeSocket): void;
  _internal_yjs_onPonged(socket: FakeSocket): void;
  _internal_eb_onMessage(socket: FakeSocket, raw: string): void;
  wss(): { topics: Map<string, Set<FakeSocket>>; options: { maxPayload?: number } };
};

describe("YjsWebRTCServer", () => {
  const webrtcService = {
    registerServer: jest.fn()
  } as unknown as WebRTCService;

  let server: YjsWebRTCServer;
  let internals: Internals;

  beforeEach(() => {
    jest.useFakeTimers();

    const options = new YjsWebRTCServerOptions();
    options.port = 14096;

    server = new YjsWebRTCServer(webrtcService, "test", options);
    internals = server as unknown as Internals;
  });

  afterEach(() => {
    server.shutdown();
    jest.useRealTimers();
  });

  function connect(): FakeSocket {
    const socket = {
      remoteAddress: "test",
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn()
    } as unknown as FakeSocket;

    internals._internal_yjs_onConnection(internals.wss(), socket);

    return socket;
  }

  function deliver(socket: FakeSocket, frame: Record<string, unknown>): void {
    internals._internal_eb_onMessage(socket, JSON.stringify(frame));
  }

  it("relays a publish to the topic's other subscribers, never back to its sender", () => {
    const sender = connect();
    const peer = connect();
    const stranger = connect();
    deliver(sender, { type: "subscribe", topics: ["room"] });
    deliver(peer, { type: "subscribe", topics: ["room"] });
    deliver(stranger, { type: "subscribe", topics: ["elsewhere"] });

    deliver(sender, { type: "publish", topic: "room", data: { sdp: "offer" } });

    expect(peer.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(peer.send.mock.calls[0]![0] as string)).toEqual({
      type: "publish",
      topic: "room",
      data: { sdp: "offer" }
    });
    expect(sender.send).not.toHaveBeenCalled();
    expect(stranger.send).not.toHaveBeenCalled();
  });

  it("stops delivering after an unsubscribe and forgets a topic left empty", () => {
    const sender = connect();
    const peer = connect();
    deliver(sender, { type: "subscribe", topics: ["room"] });
    deliver(peer, { type: "subscribe", topics: ["room"] });

    deliver(peer, { type: "unsubscribe", topics: ["room"] });
    deliver(sender, { type: "publish", topic: "room", data: 1 });

    expect(peer.send).not.toHaveBeenCalled();
    expect(internals.wss().topics.has("room")).toBe(true);

    deliver(sender, { type: "unsubscribe", topics: ["room"] });

    expect(internals.wss().topics.has("room")).toBe(false);
  });

  it("takes a closing socket out of every topic and forgets those left empty", () => {
    const leaving = connect();
    const staying = connect();
    deliver(leaving, { type: "subscribe", topics: ["shared", "alone"] });
    deliver(staying, { type: "subscribe", topics: ["shared"] });

    internals._internal_yjs_onClosed(leaving);

    const { topics } = internals.wss();
    expect(topics.has("alone")).toBe(false);
    expect([...topics.get("shared")!]).toEqual([staying]);
  });

  it("drops a socket that missed a heartbeat, without waiting on a close handshake", () => {
    const socket = connect();

    jest.advanceTimersToNextTimer();
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();

    jest.advanceTimersToNextTimer();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("pings again a socket that answered the last heartbeat", () => {
    const socket = connect();

    jest.advanceTimersToNextTimer();
    internals._internal_yjs_onPonged(socket);
    jest.advanceTimersToNextTimer();

    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it("caps a frame well under the library's default, as it only relays signalling", () => {
    expect(internals.wss().options.maxPayload).toBe(64 * 1024);
  });
});
