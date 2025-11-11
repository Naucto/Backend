import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { getSignedCookies, getSignedUrl as getSignedCFUrl, CloudfrontSignedCookiesOutput } from "@aws-sdk/cloudfront-signer";
import { MissingEnvVarError } from "@auth/auth.error";

@Injectable()
export class CloudfrontService {
  constructor(private readonly configService: ConfigService) {}

  generateSignedUrl(fileKey: string): string {
    const cdnUrl = this.configService.get<string>("CDN_URL");
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    const privateKeyPath = this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");
    if (!cdnUrl) {
      throw new MissingEnvVarError("CDN_URL");
    }
    if (!keyPairId) {
      throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");
    }
    if (!privateKeyPath) {
      throw new MissingEnvVarError("CLOUDFRONT_PRIVATE_KEY_PATH");
    }
    const resourceUrl = this.getCDNUrl(fileKey);
    const privateKey = fs.readFileSync(privateKeyPath, "utf8");

    const signedUrl = getSignedCFUrl({
      url: resourceUrl,
      dateLessThan: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      privateKey: privateKey,
      keyPairId: keyPairId,
    });

    return signedUrl;
  }

  generateSignedCookies(): CloudfrontSignedCookiesOutput {
    const cdnUrl = this.configService.get<string>("CDN_URL");
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    const privateKeyPath = this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");

    if (!cdnUrl) throw new Error("Missing CDN_URL");
    if (!keyPairId) throw new Error("Missing CLOUDFRONT_KEY_PAIR_ID");
    if (!privateKeyPath) throw new Error("Missing CLOUDFRONT_PRIVATE_KEY_PATH");

    const privateKey = fs.readFileSync(privateKeyPath, "utf8");

    const expires = Math.floor(Date.now() / 1000) + 60 * 60; // expire in 1h

    const cookies = getSignedCookies({
      url: `https://${cdnUrl}/*`,
      keyPairId: keyPairId,
      privateKey: privateKey,
      dateLessThan: expires,
    });

    return cookies;
  }

  /*createSignedCookies(resourceUrl: string, sessionCookieTimeout: number): Record<string, string> {
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    const privateKeyPath = this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");
    if (!keyPairId) {
      throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");
    }
    if (!privateKeyPath) {
      throw new MissingEnvVarError("CLOUDFRONT_PRIVATE_KEY_PATH");
    }

    const privateKey = fs.readFileSync(privateKeyPath, "utf8");
    const expires = Math.floor(Date.now() / 1000) + sessionCookieTimeout;
    const policy = createPolicy(resourceUrl, expires);
    const signature = rsaSha256Sign(privateKey, policy);

    return {
      "CloudFront-Policy": base64UrlEncode(policy),
      "CloudFront-Signature": base64UrlEncode(signature),
      "CloudFront-Key-Pair-Id": keyPairId,
    };
  }*/

  createSignedCookies(resourceUrl: string, sessionCookieTimeout: number): CloudfrontSignedCookiesOutput {
    const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
    const privateKeyPath = this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");
    if (!keyPairId) throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");
    if (!privateKeyPath) throw new MissingEnvVarError("CLOUDFRONT_PRIVATE_KEY_PATH");

    const privateKey = fs.readFileSync(privateKeyPath, "utf8");
    const expires = Math.floor(Date.now() / 1000) + sessionCookieTimeout;

    const cookies = getSignedCookies({
      url: resourceUrl,
      keyPairId,
      privateKey,
      dateLessThan: expires,
    });

    if (!cookies["CloudFront-Signature"] || !cookies["CloudFront-Key-Pair-Id"]) {
      throw new Error(`Signed cookies are incomplete: ${JSON.stringify(cookies)}`);
    }

    return {
      ...cookies,
      "CloudFront-Expires": expires,
    };
  }

  getCDNUrl(key: string): string {
    const cdnUrl = this.configService.get<string>("CDN_URL");
    return `https://${cdnUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}
