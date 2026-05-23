import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";
import {
  GoogleTokenResponse,
  GoogleUserInfo
} from "../dto/google-auth.dto";
import { getExcerrMessage } from "../../util/errors";

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(configService: ConfigService) {
    const clientId = configService.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = configService.get<string>("GOOGLE_CLIENT_SECRET");
    const redirectUri = configService.get<string>("GOOGLE_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      throw new InternalServerErrorException(
        "Missing Google OAuth configuration: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are required"
      );
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  async getUserFromCode(code: string, codeVerifier: string): Promise<OAuthUserPayload> {
    let tokenRes: Response;
    try {
      tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: this.redirectUri,
          grant_type: "authorization_code",
        }),
      });
    } catch (err) {
      this.logger.error(`Google token endpoint unreachable: ${getExcerrMessage(err)}`);
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
    let response: Response;
    try {
      response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      this.logger.warn(`Google userinfo endpoint unreachable: ${getExcerrMessage(error)}`);
      throw new UnauthorizedException("Invalid Google token");
    }

    if (!response.ok) {
      throw new UnauthorizedException("Invalid Google token");
    }

    const userInfo = await response.json() as GoogleUserInfo;

    if (!userInfo.email_verified) {
      throw new UnauthorizedException("Google email not verified");
    }
    if (!userInfo.email || !userInfo.sub) {
      throw new UnauthorizedException("Google token missing required fields");
    }

    return {
      email: userInfo.email,
      name: userInfo.name ?? userInfo.email.split("@")[0] ?? userInfo.email
    };
  }
}
