import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MissingEnvVarError } from "@auth/auth.error";

/** A replaced object gets a new URL, so no cache keeps serving the old one. */
export function versionedUrl(url: string, etag: string | undefined): string {
  const version = etag?.replace(/"/g, "") ?? Date.now().toString();
  return `${url}?v=${version}`;
}

@Injectable()
export class EdgeService {
  constructor(private readonly configService: ConfigService) {}

  getCDNUrl(key: string): string {
    const raw = this.configService.get<string>("EDGE_ENDPOINT");
    if (!raw) throw new MissingEnvVarError("EDGE_ENDPOINT");

    const trimmed = raw.trim().replace(/\/+$/, "");
    const endpoint = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    const encodedKey = key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return `${endpoint}/${encodedKey}`;
  }
}
