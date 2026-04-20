import {
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { OAuthUserPayload } from "../auth.types";

interface MicrosoftUserResponse {
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
  givenName?: string;
}

@Injectable()
export class MicrosoftAuthService {
  private readonly logger = new Logger(MicrosoftAuthService.name);

  async verifyToken(token: string): Promise<OAuthUserPayload> {
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      this.logger.warn(`Microsoft token validation failed: ${response.status}`);
      throw new UnauthorizedException("Invalid Microsoft token");
    }

    const data = (await response.json()) as MicrosoftUserResponse;
    const email = data.mail ?? data.userPrincipalName;

    if (!email) {
      throw new UnauthorizedException(
        "No email found on Microsoft account"
      );
    }

    return {
      email,
      name: data.displayName ?? data.givenName ?? ""
    };
  }
}
