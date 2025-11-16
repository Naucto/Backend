import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { getSignedCookies, getSignedUrl as getSignedCFUrl, CloudfrontSignedCookiesOutput } from "@aws-sdk/cloudfront-signer";
import { MissingEnvVarError, CloudfrontSignedCookiesException } from "@auth/auth.error";

@Injectable()
export class CloudfrontService {
    constructor(private readonly configService: ConfigService) {}

    generateSignedUrl(fileKey: string): string {
        const cdnUrl = this.configService.get<string>("CDN_URL");
        const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
        const privateKeyPath = this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");

        if (!cdnUrl) throw new MissingEnvVarError("CDN_URL");
        if (!keyPairId) throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");
        if (!privateKeyPath) throw new MissingEnvVarError("CLOUDFRONT_PRIVATE_KEY_PATH");

        const privateKey = fs.readFileSync(privateKeyPath, "utf8");
        const resourceUrl = `https://${cdnUrl}/${fileKey}`;

        const signedUrl = getSignedCFUrl({
            url: resourceUrl,
            dateLessThan: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24h
            privateKey,
            keyPairId,
        });

        return signedUrl;
    }

    getCDNUrl(key: string): string {
        const cdnUrl = this.configService.get<string>("CDN_URL");
        return `https://${cdnUrl}/${key}`;
    }

    generateSignedCookies(): CloudfrontSignedCookiesOutput {
        const cdnUrl = this.configService.get<string>("CDN_URL");
        const keyPairId = this.configService.get<string>("CLOUDFRONT_KEY_PAIR_ID");
        const privateKeyPath = this.configService.get<string>("CLOUDFRONT_PRIVATE_KEY_PATH");

        if (!cdnUrl) throw new MissingEnvVarError("CDN_URL");
        if (!keyPairId) throw new MissingEnvVarError("CLOUDFRONT_KEY_PAIR_ID");
        if (!privateKeyPath) throw new MissingEnvVarError("CLOUDFRONT_PRIVATE_KEY_PATH");

        const privateKey = fs.readFileSync(privateKeyPath, "utf8");
        const expires = Math.floor(Date.now() / 1000) + 60 * 60; // 1h

        const cookies = getSignedCookies({
            url: `https://${cdnUrl}/*`,
            keyPairId,
            privateKey,
            dateLessThan: expires,
        });

        return cookies;
    }

    createSignedCookies(resourceUrl: string, sessionCookieTimeout: number): Record<string, string> {
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
            const normalizedCookies: Record<string, string | undefined> = {
                "CloudFront-Policy": cookies["CloudFront-Policy"],
                "CloudFront-Signature": cookies["CloudFront-Signature"],
                "CloudFront-Key-Pair-Id": cookies["CloudFront-Key-Pair-Id"],
            };
            throw new CloudfrontSignedCookiesException(normalizedCookies);
        }

        return {
            "CloudFront-Policy": cookies["CloudFront-Policy"] ?? "",
            "CloudFront-Signature": cookies["CloudFront-Signature"]!,
            "CloudFront-Key-Pair-Id": cookies["CloudFront-Key-Pair-Id"]!,
            "CloudFront-Expires": expires.toString(),
        };
    }
}
