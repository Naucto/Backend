import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUser {
  login: string;
  name: string | null;
  email: string | null;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

@Injectable()
export class GithubAuthService {
  private readonly logger = new Logger(GithubAuthService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  async getUserFromCode(code: string): Promise<OAuthUserPayload> {
    const clientId = this.configService.get<string>("GITHUB_CLIENT_ID");
    const clientSecret = this.configService.get<string>("GITHUB_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      this.logger.error("GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is not configured");
      throw new UnauthorizedException(
        "GitHub authentication is not configured"
      );
    }

    const accessToken = await this.exchangeCodeForToken(code, clientId, clientSecret);
    const githubUser = await this.fetchUser(accessToken);
    const email = githubUser.email ?? await this.fetchPrimaryEmail(accessToken);

    return {
      email,
      name: githubUser.name || githubUser.login
    };
  }

  private async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<string> {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
    });

    const data = (await response.json()) as GithubTokenResponse;

    if (data.error || !data.access_token) {
      this.logger.warn(`GitHub code exchange failed: ${data.error_description ?? data.error}`);
      throw new UnauthorizedException("Invalid or expired GitHub code");
    }

    return data.access_token;
  }

  private async fetchUser(accessToken: string): Promise<GithubUser> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "NestJS-Backend"
      }
    });

    if (!response.ok) {
      throw new UnauthorizedException("Failed to fetch GitHub user info");
    }

    return response.json() as Promise<GithubUser>;
  }

  private async fetchPrimaryEmail(accessToken: string): Promise<string> {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "NestJS-Backend"
      }
    });

    if (!response.ok) {
      throw new UnauthorizedException("Failed to fetch GitHub user emails");
    }

    const emails = (await response.json()) as GithubEmail[];
    const primary = emails.find((e) => e.primary && e.verified);

    if (!primary) {
      throw new UnauthorizedException(
        "No verified primary email found on GitHub account"
      );
    }

    return primary.email;
  }
}
