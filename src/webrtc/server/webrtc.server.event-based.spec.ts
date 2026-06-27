import { IsString } from "class-validator";

import { WebRTCClientSocket } from "@webrtc/server/webrtc.server";
import { WebRTCService } from "@webrtc/webrtc.service";
import {
  EventBasedMessage,
  EventBasedWebRTCServer,
  EventBasedWebRTCServerOptions
} from "@webrtc/server/webrtc.server.event-based";

class GreetMessage {
  type!: string;

  @IsString()
    name!: string;
};

class BoomMessage {
  type!: string;
};

class TestEventBasedServer extends EventBasedWebRTCServer {
  public readonly greeted: string[] = [];

  @EventBasedMessage("greet", GreetMessage)
  protected _onGreet(_socket: WebRTCClientSocket, body: GreetMessage): void {
    this.greeted.push(body.name);
  }

  @EventBasedMessage("boom", BoomMessage)
  protected _onBoom(): void {
    throw new Error("handler blew up");
  }
};

function fakeSocket(): WebRTCClientSocket {
  return {
    remoteAddress: "test",
    readyState: 1,
    close: jest.fn(),
    send: jest.fn()
  } as unknown as WebRTCClientSocket;
}

describe("EventBasedWebRTCServer", () => {
  const webrtcService = { registerServer: jest.fn() } as unknown as WebRTCService;

  let server: TestEventBasedServer;
  let nextPort = 14096;

  function build(opts: Partial<EventBasedWebRTCServerOptions> = {}): TestEventBasedServer {
    const options = new EventBasedWebRTCServerOptions();
    Object.assign(options, opts, { port: nextPort++ });
    return new TestEventBasedServer(webrtcService, "test", options);
  }

  afterEach(() => {
    server?.shutdown();
  });

  function dispatch(s: TestEventBasedServer, socket: WebRTCClientSocket, payload: unknown): void {
    (s as unknown as {
      _internal_eb_onMessage(sock: WebRTCClientSocket, raw: string): void;
    })._internal_eb_onMessage(socket, JSON.stringify(payload));
  }

  it("dispatches a valid message to the registered handler", () => {
    server = build();
    const socket = fakeSocket();

    dispatch(server, socket, { type: "greet", name: "ada" });

    expect(server.greeted).toEqual(["ada"]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("closes the socket on a validation failure (default policy)", () => {
    server = build();
    const socket = fakeSocket();

    // `name` is required and missing
    dispatch(server, socket, { type: "greet" });

    expect(server.greeted).toEqual([]);
    expect(socket.close).toHaveBeenCalled();
  });

  it("ignores an unknown message type by default", () => {
    server = build();
    const socket = fakeSocket();

    dispatch(server, socket, { type: "unknown", name: "x" });

    expect(server.greeted).toEqual([]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("closes on an unknown type when configured to", () => {
    server = build({ onUnknownType: "close" });
    const socket = fakeSocket();

    dispatch(server, socket, { type: "unknown" });

    expect(socket.close).toHaveBeenCalled();
  });

  it("contains a throwing handler to its own socket without crashing", () => {
    server = build();
    const socket = fakeSocket();

    expect(() => dispatch(server, socket, { type: "boom" })).not.toThrow();
    expect(socket.close).toHaveBeenCalled();
  });

  it("closes the socket on malformed JSON", () => {
    server = build();
    const socket = fakeSocket();

    (server as unknown as {
      _internal_eb_onMessage(sock: WebRTCClientSocket, raw: string): void;
    })._internal_eb_onMessage(socket, "{not json");

    expect(socket.close).toHaveBeenCalled();
  });
});
