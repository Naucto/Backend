import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MicrosoftAuthService } from "./microsoft-auth.service";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const FULL_CONFIG = {
  MICROSOFT_CLIENT_ID: "client-id",
  MICROSOFT_TENANT_ID: "tenant-id"
};

describe("MicrosoftAuthService", () => {
  it("disables itself (no throw) when configuration is missing", async () => {
    const service = new MicrosoftAuthService(configWith({}));

    expect(service.isAvailable).toBe(false);
    await expect(service.verifyToken("id-token")).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it("is available when fully configured", () => {
    expect(new MicrosoftAuthService(configWith(FULL_CONFIG)).isAvailable).toBe(
      true
    );
  });
});
