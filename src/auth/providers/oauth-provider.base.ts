import {
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
  private _available = false;

  constructor(protected readonly providerName: string) {
    this.logger = new Logger(`${providerName}AuthService`);
  }

  get isAvailable(): boolean {
    return this._available;
  }

  // Reads every required var; on any miss, warns and disables the provider
  // (returns null) rather than throwing, so the app can still boot.
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
      this._available = false;
      return null;
    }

    this._available = true;
    return values;
  }

  // Guards a public method so a disabled provider fails cleanly (503) instead of
  // dereferencing absent config.
  protected ensureAvailable(): void {
    if (!this._available) {
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
      throw new UnauthorizedException(msgs.unreachable);
    }

    if (msgs.badResponse && !response.ok) {
      throw new UnauthorizedException(msgs.badResponse);
    }

    return (await response.json()) as T;
  }
}
