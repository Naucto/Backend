import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  async getUserFromCode(code: string, codeVerifier: string): Promise<OAuthUserPayload> {
    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = this.configService.get<string>("GOOGLE_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      throw new UnauthorizedException("Google OAuth configuration missing");
    }

    let tokenRes: Response;
    try {
      tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Google token endpoint unreachable: ${message}`);
      throw new UnauthorizedException("Google authentication service unavailable");
    }

    const tokens = await tokenRes.json() as GoogleTokenResponse;
    if (tokens.error || !tokens.access_token) {
      this.logger.warn(`Google code exchange failed: ${tokens.error_description ?? tokens.error}`);
      throw new UnauthorizedException("Failed to exchange Google authorization code");
    }

    return this.verifyToken(tokens.access_token);
  }

  async verifyToken(token: string): Promise<OAuthUserPayload> {
    if (!this.configService.get<string>("GOOGLE_CLIENT_ID")) {
      this.logger.error("GOOGLE_CLIENT_ID is not configured");
      throw new UnauthorizedException("Google authentication is not configured");
    }

    let userInfo: GoogleUserInfo;
    try {
      const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        throw new Error(`Google userinfo returned ${response.status}`);
      }
      userInfo = await response.json() as GoogleUserInfo;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(`Google token verification failed: ${message}`);
      throw new UnauthorizedException("Invalid Google token");
    }

    if (!userInfo.email_verified) {
      throw new UnauthorizedException("Google email not verified");
    }
    if (!userInfo.email || !userInfo.sub) {
      throw new UnauthorizedException("Google token missing required fields");
    }

    return {
      email: userInfo.email,
      name: userInfo.name ?? ""
    };
  }
}
