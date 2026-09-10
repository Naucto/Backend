import { ConfigService } from "@nestjs/config";
import { WebRTCService } from "./webrtc.service";
import { WebRTCServerRuntimeError } from "./server/webrtc.server.error";
import { WEBRTC_SERVER_NAMES } from "./server/webrtc.server";
import { TurnCredentialsService } from "./turn-credentials.service";
import { WebRTCOfferPeerICEServerConfig } from "./webrtc.dto";

const stubCredentials = (
  current: WebRTCOfferPeerICEServerConfig[] | undefined = undefined
): TurnCredentialsService => ({ current: () => current }) as unknown as TurnCredentialsService;

describe("WebRTCService.buildSignalingUrl", () => {
  const collab = { name: "collab" as const, port: 10000 };
  const game = { name: "game" as const, port: 10001 };

  const createService = (env: Record<string, string | undefined>): WebRTCService => {
    const configService = {
      get: jest.fn((key: string) => env[key])
    } as unknown as ConfigService;
    const service = new WebRTCService(configService, stubCredentials());
    service._publicAddress = env["BACKEND_WEBRTC_HOSTNAME"] ?? "localhost";
    service.loadPublicUrlTemplate(env["BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE"]);
    return service;
  };

  it("substitutes the server name into the public URL template", () => {
    const service = createService({
      BACKEND_WEBRTC_HOSTNAME: "beta.naucto.net",
      BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE: "wss://{name}.ws.beta.naucto.net"
    });

    expect(service.buildSignalingUrl(collab)).toBe("wss://collab.ws.beta.naucto.net");
    expect(service.buildSignalingUrl(game)).toBe("wss://game.ws.beta.naucto.net");
  });

  it("also substitutes the port when the template asks for it", () => {
    const service = createService({
      BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE: "ws://ws.local:{port}/{name}"
    });

    expect(service.buildSignalingUrl(game)).toBe("ws://ws.local:10001/game");
  });

  it("refuses to advertise a nameless server through the template", () => {
    const service = createService({
      BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE: "wss://{name}.ws.beta.naucto.net"
    });

    expect(() => service.buildSignalingUrl({ name: undefined, port: 10005 })).toThrow(
      WebRTCServerRuntimeError
    );
  });

  it("falls back to hostname and port without a template", () => {
    expect(createService({}).buildSignalingUrl(collab)).toBe("ws://localhost:10000");
    expect(
      createService({ BACKEND_WEBRTC_HOSTNAME: "backend.example.org" }).buildSignalingUrl(collab)
    ).toBe("wss://backend.example.org:10000");
  });

  it("treats a blank template as unset", () => {
    expect(
      createService({ BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE: "   " }).buildSignalingUrl(collab)
    ).toBe("ws://localhost:10000");
  });

  it("rejects templates without a WebSocket scheme", () => {
    expect(() =>
      createService({ BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE: "https://{name}.ws.naucto.net" })
    ).toThrow(WebRTCServerRuntimeError);
  });

  it("passes explicit WebSocket URLs through and rejects malformed ones", () => {
    const service = createService({});

    expect(service.buildSignalingUrl("wss://relay.example.org")).toBe("wss://relay.example.org");
    expect(() => service.buildSignalingUrl("relay.example.org")).toThrow(
      WebRTCServerRuntimeError
    );
  });
});

/** Pinned because a deployment maps a name to a port outside this repository. */
describe("WebRTCService.allocatePort", () => {
  const createService = (base?: string): WebRTCService => {
    const configService = {
      get: jest.fn((key: string) => (key === "BACKEND_WEBRTC_PORT_BASE" ? base : undefined))
    } as unknown as ConfigService;

    return new WebRTCService(configService, stubCredentials());
  };

  it("gives a named server the port its name sits at, whatever order it is asked in", () => {
    const service = createService("10010");

    expect(service.allocatePort("user")).toBe(10012);
    expect(service.allocatePort("collab")).toBe(10010);
    expect(service.allocatePort("game")).toBe(10011);
    // Asking twice is the same answer: the port belongs to the name, not to the call.
    expect(service.allocatePort("user")).toBe(10012);
  });

  it("keeps unnamed servers off every named port", () => {
    const service = createService("10010");
    const named = Object.values(WEBRTC_SERVER_NAMES).map((n) => service.allocatePort(n));

    expect(service.allocatePort()).toBe(10010 + named.length);
    expect(service.allocatePort()).toBe(10011 + named.length);
    expect(named).not.toContain(10010 + named.length);
  });

  it("falls back to 10000 when the base is unset or nonsense", () => {
    expect(createService(undefined).allocatePort("collab")).toBe(10000);
    expect(createService("not-a-port").allocatePort("collab")).toBe(10000);
  });
});

describe("WebRTCService.buildOffer", () => {
  const createService = async (
    credentials: TurnCredentialsService
  ): Promise<WebRTCService> => {
    const configService = {
      get: jest.fn(() => undefined)
    } as unknown as ConfigService;
    const service = new WebRTCService(configService, credentials);
    service._publicAddress = "localhost";
    // Reads the committed relay file -- the same one a deployment decodes into place.
    await service.loadConfig();

    return service;
  };

  const iceServersOf = (service: WebRTCService): WebRTCOfferPeerICEServerConfig[] =>
    service.buildOffer("ws://localhost:10000").peerOpts.config.iceServers;

  it("wraps each configured relay's single URL in a list", async () => {
    const service = await createService(stubCredentials());

    const iceServers = iceServersOf(service);

    expect(iceServers.length).toBeGreaterThan(0);
    for (const server of iceServers) {
      expect(Array.isArray(server.urls)).toBe(true);
      expect(server.urls).toHaveLength(1);
    }
    expect(iceServers[0]?.urls[0]).toMatch(/^stun:/);
  });

  it("hands out minted credentials whole, without running them through pickRelays", async () => {
    const minted: WebRTCOfferPeerICEServerConfig[] = [
      {
        urls: [
          "stun:stun.example.net:3478",
          "turn:turn.example.net:3478?transport=udp",
          "turn:turn.example.net:3478?transport=tcp",
          "turns:turn.example.net:5349?transport=tcp"
        ],
        username: "minted-user",
        credential: "minted-secret"
      }
    ];
    const service = await createService(stubCredentials(minted));

    // One server carrying four transports: not four servers, and so not three of them either.
    expect(iceServersOf(service)).toEqual(minted);
  });

  it("still takes maxConns from the file when credentials are minted", async () => {
    const withMinted = await createService(stubCredentials([ { urls: [ "turn:x:1" ] } ]));
    const withoutMinted = await createService(stubCredentials());

    expect(withMinted.buildOffer("ws://localhost:10000").maxConns).toBe(
      withoutMinted.buildOffer("ws://localhost:10000").maxConns
    );
  });
});
