import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";
import * as jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

@Injectable()
export class MicrosoftAuthService {
  private readonly jwksClient = jwksRsa({
    jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    cache: true,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
  });

  constructor(private readonly configService: ConfigService) {}

  async verifyToken(idToken: string): Promise<OAuthUserPayload> {
    const decoded = jwt.decode(idToken, { complete: true });

    if (!decoded || typeof decoded.payload === "string") {
      throw new UnauthorizedException("Invalid Microsoft token format");
    }

    let publicKey: string;
    try {
      const key = await this.jwksClient.getSigningKey(decoded.header.kid);
      publicKey = key.getPublicKey();
    } catch {
      throw new UnauthorizedException("Failed to fetch Microsoft signing key");
    }

    const clientId = this.configService.get<string>("MICROSOFT_CLIENT_ID");
    const tenantId = this.configService.get<string>("MICROSOFT_TENANT_ID");

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        audience: clientId,
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException("Microsoft token signature invalid");
    }

    const email =
      payload["preferred_username"] ?? payload["email"] ?? payload["upn"];
    const name = payload["name"] ?? "";

    if (!email) {
      throw new UnauthorizedException("No email found in Microsoft token");
    }

    return { email, name };
  }
}
