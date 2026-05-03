import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";
import * as jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

@Injectable()
export class MicrosoftAuthService {
  private jwksClient = jwksRsa({
    jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    cache: true,
    rateLimit: true
  });

  constructor(private readonly configService: ConfigService) {}

  async verifyToken(token: string): Promise<OAuthUserPayload> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded.payload === "string") {
      throw new UnauthorizedException("Invalid Microsoft token");
    }

    const key = await this.jwksClient.getSigningKey(decoded.header.kid);
    const publicKey = key.getPublicKey();

    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      audience: this.configService.get<string>("MICROSOFT_CLIENT_ID"),
      issuer: `https://login.microsoftonline.com/${this.configService.get<string>("MICROSOFT_TENANT_ID")}/v2.0`
    }) as jwt.JwtPayload;

    const email =
      payload["preferred_username"] ?? payload["email"] ?? payload["upn"];
    const name = payload["name"] ?? "";

    if (!email) {
      throw new UnauthorizedException("No email found on Microsoft token");
    }

    return { email, name };
  }
}
