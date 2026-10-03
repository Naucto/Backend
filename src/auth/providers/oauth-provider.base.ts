import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getExcerrMessage } from "../../util/errors";

// Shared base for third-party OAuth providers. Missing configuration disables a
// provider (logged warning) instead of crashing boot, so providers are optional
// per environment. Also centralizes the repeated fetch/error plumbing.
export abstract class OAuthProviderService {
  protected readonly logger: Logger;
  private available = false;

  constructor(protected readonly providerName: string) {
    this.logger = new Logger(`${providerName}AuthService`);
  }

  get isAvailable(): boolean {
    return this.available;
  }

  protected loadConfig(
    configService: ConfigService,
    vars: string[]
  ): Record<string, string> | null {
    const values: Record<string, string> = {};
    const missing: string[] = [];

    for (const name of vars) {
      const value = configService.get<string>(name);
      if (value) {
        values[name] = value;
      } else {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      this.logger.warn(
        `${this.providerName} OAuth disabled: missing ${missing.join(", ")}`
      );
      return null;
    }

    this.available = true;
    return values;
  }

  // Guards a public method so a disabled provider fails cleanly (503) instead of
  // dereferencing absent config.
  protected ensureAvailable(): void {
    if (!this.available) {
      throw new ServiceUnavailableException(
        `${this.providerName} authentication is not configured`
      );
    }
  }

  // Wraps fetch + JSON parsing with consistent error handling. Domain checks on
  // the parsed body stay with the caller.
  protected async fetchJson<T>(
    url: string,
    init: RequestInit,
    msgs: { unreachable: string; badResponse?: string }
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      this.logger.error(`${url} unreachable: ${getExcerrMessage(err)}`);
      throw new ServiceUnavailableException(msgs.unreachable);
    }

    if (msgs.badResponse && !response.ok) {
      throw new UnauthorizedException(msgs.badResponse);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException(`${this.providerName} returned an unreadable response`);
    }
  }
}
