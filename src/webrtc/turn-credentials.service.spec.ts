import { ConfigService } from "@nestjs/config";
import { TurnCredentialsService } from "./turn-credentials.service";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const FULL_CONFIG = {
  BACKEND_WEBRTC_TURN_KEY_ID: "key-id",
  BACKEND_WEBRTC_TURN_API_TOKEN: "api-token"
};

const ONE_SERVER_FOUR_TRANSPORTS = {
  iceServers: [
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
  ]
};

describe("TurnCredentialsService", () => {
  const originalFetch = global.fetch;

  // The test setup loads the real .env, so a case that forgot to replace fetch would spend a
  // developer's own credentials against the live provider.
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const respondWith = (body: unknown, ok = true, status = 201): jest.Mock => {
    const fetchMock = jest.fn().mockResolvedValue({ ok, status, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  it("stays inert, and silent on the network, without both variables", async () => {
    const fetchMock = respondWith(ONE_SERVER_FOUR_TRANSPORTS);
    const service = new TurnCredentialsService(
      configWith({ BACKEND_WEBRTC_TURN_KEY_ID: "key-id" })
    );

    expect(service.isConfigured).toBe(false);
    await service.onModuleInit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.current()).toBeUndefined();
  });

  it("mints one ICE server carrying every transport", async () => {
    const fetchMock = respondWith(ONE_SERVER_FOUR_TRANSPORTS);
    const service = new TurnCredentialsService(configWith(FULL_CONFIG));

    await service.onModuleInit();

    expect(service.current()).toEqual([
      {
        urls: ONE_SERVER_FOUR_TRANSPORTS.iceServers[0]?.urls,
        username: "minted-user",
        credential: "minted-secret"
      }
    ]);
    const [ url, init ] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/keys/key-id/credentials/generate-ice-servers");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer api-token");
    expect(JSON.parse(String(init.body))).toEqual({ ttl: 24 * 60 * 60 });
  });

  it("reads a lone object as readily as a list, and a lone URL as a list of one", async () => {
    respondWith({ iceServers: { urls: "stun:stun.example.net:3478" } });
    const service = new TurnCredentialsService(configWith(FULL_CONFIG));

    await service.onModuleInit();

    expect(service.current()).toEqual([
      { urls: [ "stun:stun.example.net:3478" ], username: undefined, credential: undefined }
    ]);
  });

  it("does not go back to the provider once it holds a pair", async () => {
    const fetchMock = respondWith(ONE_SERVER_FOUR_TRANSPORTS);
    const service = new TurnCredentialsService(configWith(FULL_CONFIG));

    await service.onModuleInit();
    service.current();
    service.current();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("comes back empty-handed rather than throwing when the provider is unreachable", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new TurnCredentialsService(configWith(FULL_CONFIG));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.current()).toBeUndefined();
  });

  it("keeps the pair it already has when a later refresh fails", async () => {
    respondWith(ONE_SERVER_FOUR_TRANSPORTS);
    const service = new TurnCredentialsService(configWith(FULL_CONFIG));
    await service.onModuleInit();
    const minted = service.current();

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await service.refresh();

    expect(service.current()).toBe(minted);
  });

  it("treats a response without an ICE server as no answer at all", async () => {
    respondWith({ iceServers: [] });
    const service = new TurnCredentialsService(configWith(FULL_CONFIG));

    await service.onModuleInit();

    expect(service.current()).toBeUndefined();
  });
});
