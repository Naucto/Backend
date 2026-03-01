import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import {
  getSignedCookies,
  getSignedUrl as getSignedCFUrl,
  CloudfrontSignedCookiesOutput
} from "@aws-sdk/cloudfront-signer";
import {
  BadEnvVarError,
  MissingEnvVarError,
  CloudfrontSignedCookiesException
} from "@auth/auth.error";
import { CloudFrontPrivateKeyException } from "./s3.error";

@Injectable()
export class CloudfrontService {
  private readonly logger = new Logger(CloudfrontService.name);
  private privateKey: string | null = null;
  constructor(private readonly configService: ConfigService) {}

  private hasSigningConfiguration(): boolean {
    const keyPairId =
      this.configService.get<string>("EDGE_KEY_PAIR_ID") ??
      this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    const inlinePrivateKey =
      this.configService.get<string>("EDGE_PRIVATE_KEY") ??
      this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY");
    const privateKeyPath =
      this.configService.get<string>("EDGE_PRIVATE_KEY_PATH") ??
      this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");

    return Boolean(keyPairId && (inlinePrivateKey || privateKeyPath));
  }

  private getEdgeEndpointRaw(): string {
    const endpoint =
      this.configService.get<string>("EDGE_ENDPOINT") ??
      this.configService.get<string>("CDN_URL");
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

  private getKeyPairId(): string {
    const keyPairId =
      this.configService.get<string>("EDGE_KEY_PAIR_ID") ??
      this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    if (!keyPairId) throw new MissingEnvVarError("EDGE_KEY_PAIR_ID");
    return keyPairId;
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

  private getPrivateKey(): string {
    if (this.privateKey) {
      return this.privateKey;
    }

    const envPrivateKey =
      this.configService.get<string>("EDGE_PRIVATE_KEY") ??
      this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY");
    if (envPrivateKey) {
      this.privateKey = envPrivateKey.replace(/\\n/g, "\n");
      return this.privateKey;
    }

    const privateKeyPath =
      this.configService.get<string>("EDGE_PRIVATE_KEY_PATH") ??
      this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");
    if (!privateKeyPath) throw new MissingEnvVarError("EDGE_PRIVATE_KEY_PATH");

    try {
      if (!fs.existsSync(privateKeyPath)) {
        throw new CloudFrontPrivateKeyException(
          privateKeyPath,
          "File does not exist on disk"
        );
      }
      this.privateKey = fs.readFileSync(privateKeyPath, "utf8");
      return this.privateKey;
    } catch (error) {
      if (error instanceof CloudFrontPrivateKeyException) {
        throw error;
      }
      this.logger.error(`Failed to read Edge private key: ${error}`);
      throw new CloudFrontPrivateKeyException(privateKeyPath, error);
    }
  }

  getCookieDomain(): string {
    try {
      return new URL(this.getEdgeEndpointUrl()).hostname;
    } catch {
      throw new BadEnvVarError("EDGE_ENDPOINT");
    }
  }

  private validateCookies(
    cookies: CloudfrontSignedCookiesOutput
  ): Record<string, string | undefined> {
    const normalizedCookies: Record<string, string | undefined> = {
      "CloudFront-Policy": cookies["CloudFront-Policy"],
      "CloudFront-Signature": cookies["CloudFront-Signature"],
      "CloudFront-Key-Pair-Id": cookies["CloudFront-Key-Pair-Id"]
    };
    if (
      !cookies["CloudFront-Signature"] ||
      !cookies["CloudFront-Key-Pair-Id"]
    ) {
      throw new CloudfrontSignedCookiesException(normalizedCookies);
    }
    return normalizedCookies;
  }

  generateSignedUrl(fileKey: string): string {
    if (!this.hasSigningConfiguration()) {
      return this.buildResourceUrl(fileKey);
    }

    const keyPairId = this.getKeyPairId();

    const resourceUrl = this.buildResourceUrl(fileKey);
    const privateKey = this.getPrivateKey();

    const signedUrl = getSignedCFUrl({
      url: resourceUrl,
      dateLessThan: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24h
      privateKey,
      keyPairId
    });

    return signedUrl;
  }

  getCDNUrl(key: string): string {
    return this.buildResourceUrl(key);
  }

  generateSignedCookies(
    expiresInSeconds: number = 86400
  ): CloudfrontSignedCookiesOutput {
    if (!this.hasSigningConfiguration()) {
      return {} as CloudfrontSignedCookiesOutput;
    }

    const keyPairId = this.getKeyPairId();

    const privateKey = this.getPrivateKey();
    const dateLessThan = new Date(
      Date.now() + expiresInSeconds * 1000
    ).toISOString();

    const cookies = getSignedCookies({
      url: this.buildResourceUrl("*", { allowWildcard: true }),
      keyPairId,
      privateKey,
      dateLessThan
    });
    this.validateCookies(cookies);

    return cookies;
  }

  createSignedCookies(
    resourceUrl: string,
    sessionCookieTimeout: number
  ): Record<string, string> {
    if (!this.hasSigningConfiguration()) {
      return {};
    }

    const keyPairId = this.getKeyPairId();

    const privateKey = this.getPrivateKey();
    const expires = Math.floor(Date.now() / 1000) + sessionCookieTimeout;

    const cookies = getSignedCookies({
      url: resourceUrl,
      keyPairId,
      privateKey,
      dateLessThan: expires
    });
    this.validateCookies(cookies);

    return {
      "CloudFront-Policy": cookies["CloudFront-Policy"] ?? "",
      "CloudFront-Signature": cookies["CloudFront-Signature"]!,
      "CloudFront-Key-Pair-Id": cookies["CloudFront-Key-Pair-Id"]!,
      "CloudFront-Expires": expires.toString()
    };
  }
}
