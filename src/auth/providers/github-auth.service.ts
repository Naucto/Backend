import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuthUserPayload } from "../auth.types";
import {
  GithubEmail,
  GithubTokenResponse,
  GithubUser
} from "../dto/github-auth.dto";
import { getExcerrMessage } from "../../util/errors";

@Injectable()
export class GithubAuthService {
  private readonly logger = new Logger(GithubAuthService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(configService: ConfigService) {
    const clientId = configService.get<string>("GITHUB_CLIENT_ID");
    const clientSecret = configService.get<string>("GITHUB_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        "Missing GitHub OAuth configuration: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required"
      );
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getUserFromCode(code: string): Promise<OAuthUserPayload> {
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
    let response: Response;
    try {
      response = await fetch(
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
        }
      );
    } catch (err) {
      this.logger.error(`GitHub token endpoint unreachable: ${getExcerrMessage(err)}`);
      throw new UnauthorizedException("GitHub authentication service unavailable");
    }

    const data = (await response.json()) as GithubTokenResponse;

    if (data.error || !data.access_token) {
      this.logger.warn(
        `GitHub code exchange failed: ${data.error_description ?? data.error}`
      );
      throw new UnauthorizedException("Invalid or expired GitHub code");
    }

    return data.access_token;
  }

  private async fetchUser(accessToken: string): Promise<GithubUser> {
    let response: Response;
    try {
      response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "NestJS-Backend"
        }
      });
    } catch (err) {
      this.logger.error(`GitHub user endpoint unreachable: ${getExcerrMessage(err)}`);
      throw new UnauthorizedException("GitHub authentication service unavailable");
    }

    if (!response.ok) {
      throw new UnauthorizedException("Failed to fetch GitHub user info");
    }

    return response.json() as Promise<GithubUser>;
  }

  private async fetchPrimaryEmail(accessToken: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "NestJS-Backend"
        }
      });
    } catch (err) {
      this.logger.error(`GitHub emails endpoint unreachable: ${getExcerrMessage(err)}`);
      throw new UnauthorizedException("GitHub authentication service unavailable");
    }

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
