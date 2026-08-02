import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GithubAuthService } from "./github-auth.service";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const FULL_CONFIG = {
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret"
};

describe("GithubAuthService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("disables itself (no throw) when configuration is missing", async () => {
    const service = new GithubAuthService(configWith({}));

    expect(service.isAvailable).toBe(false);
    await expect(service.getUserFromCode("code")).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it("is available when fully configured", () => {
    expect(new GithubAuthService(configWith(FULL_CONFIG)).isAvailable).toBe(
      true
    );
  });

  it("returns the user payload on a successful code exchange", async () => {
    const service = new GithubAuthService(configWith(FULL_CONFIG));

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          login: "ada",
          name: "Ada",
          email: "ada@example.com"
        })
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.getUserFromCode("code");

    expect(result).toEqual({ email: "ada@example.com", name: "Ada" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
