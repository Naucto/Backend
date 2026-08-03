import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";
import {
  GithubEmail,
  GithubTokenResponse,
  GithubUser
} from "../dto/github-auth.dto";
import { OAuthProviderService } from "./oauth-provider.base";

@Injectable()
export class GithubAuthService extends OAuthProviderService {
  private readonly clientId!: string;
  private readonly clientSecret!: string;

  constructor(configService: ConfigService) {
    super("GitHub");

    const config = this.loadConfig(configService, [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET"
    ]);

    if (config) {
      this.clientId = config["GITHUB_CLIENT_ID"]!;
      this.clientSecret = config["GITHUB_CLIENT_SECRET"]!;
    }
  }

  async getUserFromCode(code: string): Promise<OAuthUserPayload> {
    this.ensureAvailable();

    const accessToken = await this.exchangeCodeForToken(code);
    const githubUser = await this.fetchUser(accessToken);
    const email =
      githubUser.email ?? (await this.fetchPrimaryEmail(accessToken));

    return {
      email,
      name: githubUser.name || githubUser.login
    };
  }

  private async exchangeCodeForToken(code: string): Promise<string> {
    const data = await this.fetchJson<GithubTokenResponse>(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code
        })
      },
      { unreachable: "GitHub authentication service unavailable" }
    );

    if (data.error || !data.access_token) {
      this.logger.warn(
        `GitHub code exchange failed: ${data.error_description ?? data.error}`
      );
      throw new UnauthorizedException("Invalid or expired GitHub code");
    }

    return data.access_token;
  }

  private async fetchUser(accessToken: string): Promise<GithubUser> {
    return this.fetchJson<GithubUser>(
      "https://api.github.com/user",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "NestJS-Backend"
        }
      },
      {
        unreachable: "GitHub authentication service unavailable",
        badResponse: "Failed to fetch GitHub user info"
      }
    );
  }

  private async fetchPrimaryEmail(accessToken: string): Promise<string> {
    const emails = await this.fetchJson<GithubEmail[]>(
      "https://api.github.com/user/emails",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "NestJS-Backend"
        }
      },
      {
        unreachable: "GitHub authentication service unavailable",
        badResponse: "Failed to fetch GitHub user emails"
      }
    );

    const primary = emails.find((e) => e.primary && e.verified);

    if (!primary) {
      throw new UnauthorizedException(
        "No verified primary email found on GitHub account"
      );
    }

    return primary.email;
  }
}
