import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleAuthService } from "./google-auth.service";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const FULL_CONFIG = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://app.example/callback"
};

describe("GoogleAuthService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("disables itself (no throw) when configuration is missing", async () => {
    const service = new GoogleAuthService(configWith({}));

    expect(service.isAvailable).toBe(false);
    await expect(
      service.getUserFromCode("code", "verifier")
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("is available when fully configured", () => {
    expect(new GoogleAuthService(configWith(FULL_CONFIG)).isAvailable).toBe(
      true
    );
  });

  it("returns the user payload on a successful code exchange", async () => {
    const service = new GoogleAuthService(configWith(FULL_CONFIG));

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: "ada@example.com",
          email_verified: true,
          sub: "1",
          name: "Ada"
        })
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.getUserFromCode("code", "verifier");

    expect(result).toEqual({ email: "ada@example.com", name: "Ada" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
