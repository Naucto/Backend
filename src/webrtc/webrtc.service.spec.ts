import { ConfigService } from "@nestjs/config";
import { WebRTCService } from "./webrtc.service";
import { WebRTCServerRuntimeError } from "./server/webrtc.server.error";

describe("WebRTCService.buildSignalingUrl", () => {
  const collab = { name: "collab" as const, port: 10000 };
  const game = { name: "game" as const, port: 10001 };

  const createService = (env: Record<string, string | undefined>): WebRTCService => {
    const configService = {
      get: jest.fn((key: string) => env[key])
    } as unknown as ConfigService;
    const service = new WebRTCService(configService);
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
