import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import {
  getSignedCookies,
  getSignedUrl as getSignedCFUrl,
  CloudfrontSignedCookiesOutput
} from "@aws-sdk/cloudfront-signer";
import {
  MissingEnvVarError,
  CloudfrontSignedCookiesException
} from "@auth/auth.error";
import { CloudFrontPrivateKeyException } from "./s3.error";

@Injectable()
export class CloudfrontService {
  private readonly logger = new Logger(CloudfrontService.name);
  private privateKey: string | null = null;
  constructor(private readonly configService: ConfigService) {}

  private getPrivateKey(): string {
    if (this.privateKey) {
      return this.privateKey;
    }

    const privateKeyPath = this.configService.get<string>(
      "CLOUDFRONT_PRIVATE_KEY_PATH"
    );
    if (!privateKeyPath)
      throw new MissingEnvVarError("CLOUDFRONT_PRIVATE_KEY_PATH");

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
      this.logger.error(`Failed to read CloudFront private key: ${error}`);
      throw new CloudFrontPrivateKeyException(privateKeyPath, error);
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
    const cdnUrl = this.configService.get<string>("CDN_URL");
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");

    if (!cdnUrl) throw new MissingEnvVarError("CDN_URL");
    if (!keyPairId) throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");

    const resourceUrl = `https://${cdnUrl}/${fileKey}`;
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
    const cdnUrl = this.configService.get<string>("CDN_URL");
    return `https://${cdnUrl}/${key}`;
  }

  generateSignedCookies(
    expiresInSeconds: number = 86400
  ): CloudfrontSignedCookiesOutput {
    const cdnUrl = this.configService.get<string>("CDN_URL");
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");

    if (!cdnUrl) throw new MissingEnvVarError("CDN_URL");
    if (!keyPairId) throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");

    const privateKey = this.getPrivateKey();
    const dateLessThan = new Date(
      Date.now() + expiresInSeconds * 1000
    ).toISOString();

    const cookies = getSignedCookies({
      url: `https://${cdnUrl}/*`,
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
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    if (!keyPairId) throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");

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
