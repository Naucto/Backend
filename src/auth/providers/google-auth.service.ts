import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuth2Client, LoginTicket } from "google-auth-library";
import { OAuthUserPayload } from "../auth.types";

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly client: OAuth2Client;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {
    this.client = new OAuth2Client(
      this.configService.get<string>("GOOGLE_CLIENT_ID")
    );
  }

  async verifyToken(token: string): Promise<OAuthUserPayload> {
    const audience = this.configService.get<string>("GOOGLE_CLIENT_ID");
    if (!audience) {
      this.logger.error("GOOGLE_CLIENT_ID is not configured");
      throw new UnauthorizedException(
        "Google authentication is not configured"
      );
    }

    let ticket: LoginTicket;
    try {
      ticket = await this.client.verifyIdToken({ idToken: token, audience });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(`Google token verification failed: ${message}`);
      throw new UnauthorizedException("Invalid Google token");
    }

    const payload = ticket.getPayload();
    if (!payload) {
      throw new UnauthorizedException("Invalid Google token payload");
    }
    if (!payload.email_verified) {
      throw new UnauthorizedException("Google email not verified");
    }
    if (!payload.email || !payload.sub) {
      throw new UnauthorizedException("Google token missing required fields");
    }

    return {
      email: payload.email,
      name: payload.name ?? ""
    };
  }
}
