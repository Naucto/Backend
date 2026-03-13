import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BadEnvVarError,
  MissingEnvVarError,
} from "@auth/auth.error";

@Injectable()
export class CloudfrontService {
  constructor(private readonly configService: ConfigService) {}

  private getEdgeEndpointRaw(): string {
    const endpoint =
      this.configService.get<string>("EDGE_ENDPOINT");
    if (!endpoint) throw new MissingEnvVarError("EDGE_ENDPOINT");
    return endpoint;
  }

  private normalizeEndpoint(endpoint: string): string {
    const trimmed = endpoint.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `https://${trimmed}`;
  }

  private getEdgeEndpointUrl(): string {
    return this.normalizeEndpoint(this.getEdgeEndpointRaw());
  }

  private buildResourceUrl(
    key: string,
    options?: { allowWildcard?: boolean }
  ): string {
    const endpoint = this.getEdgeEndpointUrl();

    if (options?.allowWildcard && key === "*") {
      return `${endpoint}/*`;
    }

    const encodedKey = key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return `${endpoint}/${encodedKey}`;
  }

  getCookieDomain(): string {
    try {
      return new URL(this.getEdgeEndpointUrl()).hostname;
    } catch {
      throw new BadEnvVarError("EDGE_ENDPOINT");
    }
  }

  generateSignedUrl(fileKey: string): string {
      return this.buildResourceUrl(fileKey);
  }

  getCDNUrl(key: string): string {
    return this.buildResourceUrl(key);
  }
}