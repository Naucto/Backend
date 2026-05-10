import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";
import * as jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import axios from "axios";

@Injectable()
export class MicrosoftAuthService {
  private jwksClient = jwksRsa({
    jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    cache: true,
    rateLimit: true
  });

  constructor(private readonly configService: ConfigService) {}

  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<string> {
    const clientId = this.configService.get<string>("MICROSOFT_CLIENT_ID");
    const clientSecret = this.configService.get<string>("MICROSOFT_CLIENT_SECRET");
    const tenantId = this.configService.get<string>("MICROSOFT_TENANT_ID");
    const redirectUri = this.configService.get<string>("MICROSOFT_REDIRECT_URI");

    if (!clientId || !clientSecret || !tenantId || !redirectUri) {
      throw new UnauthorizedException("Microsoft OAuth configuration missing");
    }

    try {
      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
      const params = new URLSearchParams();
      params.append("client_id", clientId);
      params.append("client_secret", clientSecret);
      params.append("code", code);
      params.append("code_verifier", codeVerifier);
      params.append("redirect_uri", redirectUri);
      params.append("grant_type", "authorization_code");
      params.append("scope", "openid profile email");

      const response = await axios.post(tokenUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });

      return response.data.id_token;
    } catch (error: unknown) {
      const axiosError = error as any;
      console.error("Microsoft token exchange failed:", axiosError.response?.data || axiosError.message);
      throw new UnauthorizedException("Failed to exchange authorization code");
    }
  }

  async verifyToken(token: string): Promise<OAuthUserPayload> {
    try {
      const decoded = jwt.decode(token, { complete: true });
      
      if (!decoded || typeof decoded.payload === "string") {
        throw new UnauthorizedException("Invalid Microsoft token");
      }

      const key = await this.jwksClient.getSigningKey((decoded as any).header.kid);
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
    } catch (error: unknown) {
      const err = error as any;
      console.error("Microsoft token verification failed:", err.message || err);
      throw error;
    }
  }
}
