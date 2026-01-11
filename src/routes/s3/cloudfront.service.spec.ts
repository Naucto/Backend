import { Test, TestingModule } from "@nestjs/testing";
import { CloudfrontService } from "./cloudfront.service";
import { ConfigService } from "@nestjs/config";
import { MissingEnvVarError, CloudfrontSignedCookiesException } from "@auth/auth.error";
import { CloudFrontPrivateKeyException } from "./s3.error";
import { getSignedUrl as getSignedCFUrl, getSignedCookies } from "@aws-sdk/cloudfront-signer";
import * as fs from "fs";

jest.mock("@aws-sdk/cloudfront-signer", () => ({
    getSignedUrl: jest.fn(),
    getSignedCookies: jest.fn(),
}));

jest.mock("fs");

describe("CloudfrontService", () => {
    let service: CloudfrontService;
    let mockConfig: jest.Mocked<ConfigService>;

    beforeEach(async () => {
        jest.clearAllMocks();

        mockConfig = {
            get: jest.fn(),
        } as any;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CloudfrontService,
                {
                    provide: ConfigService,
                    useValue: mockConfig,
                },
            ],
        }).compile();

        service = module.get<CloudfrontService>(CloudfrontService);
    });

    describe("getPrivateKey", () => {
        it("should return cached private key", () => {
            (service as any).privateKey = "cached-key";
            const result = (service as any).getPrivateKey();
            expect(result).toBe("cached-key");
        });

        it("should read private key from file", () => {
            mockConfig.get.mockReturnValue("/path/to/key.pem");
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("file-key-content");

            const result = (service as any).getPrivateKey();
            expect(result).toBe("file-key-content");
            expect(fs.existsSync).toHaveBeenCalledWith("/path/to/key.pem");
            expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/key.pem", "utf8");
        });

        it("should throw MissingEnvVarError when CLOUDFRONT_PRIVATE_KEY_PATH is missing", () => {
            mockConfig.get.mockReturnValue(undefined);

            expect(() => (service as any).getPrivateKey()).toThrow(MissingEnvVarError);
        });

        it("should throw CloudFrontPrivateKeyException when file does not exist", () => {
            mockConfig.get.mockReturnValue("/path/to/missing.pem");
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            expect(() => (service as any).getPrivateKey()).toThrow(CloudFrontPrivateKeyException);
        });

        it("should throw CloudFrontPrivateKeyException on read error", () => {
            mockConfig.get.mockReturnValue("/path/to/key.pem");
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockImplementation(() => {
                throw new Error("Read error");
            });

            expect(() => (service as any).getPrivateKey()).toThrow(CloudFrontPrivateKeyException);
        });

        it("should rethrow CloudFrontPrivateKeyException", () => {
            mockConfig.get.mockReturnValue("/path/to/key.pem");
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            const originalError = new CloudFrontPrivateKeyException("/path/to/key.pem", "Original error");
            (fs.readFileSync as jest.Mock).mockImplementation(() => {
                throw originalError;
            });

            expect(() => (service as any).getPrivateKey()).toThrow(originalError);
        });
    });

    describe("validateCookies", () => {
        it("should throw CloudfrontSignedCookiesException when cookies are invalid", () => {
            const invalidCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": undefined,
                "CloudFront-Key-Pair-Id": undefined,
            };

            expect(() => (service as any).validateCookies(invalidCookies)).toThrow(CloudfrontSignedCookiesException);
        });

        it("should not throw when cookies are valid", () => {
            const validCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": "signature",
                "CloudFront-Key-Pair-Id": "key-pair-id",
            };

            expect(() => (service as any).validateCookies(validCookies)).not.toThrow();
        });
    });

    describe("generateSignedUrl", () => {
        it("should generate signed URL successfully", () => {
            mockConfig.get
                .mockReturnValueOnce("cdn.example.com")
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");
            (getSignedCFUrl as jest.Mock).mockReturnValue("https://signed-url.com");

            const result = service.generateSignedUrl("test-file.txt");

            expect(result).toBe("https://signed-url.com");
            expect(getSignedCFUrl).toHaveBeenCalledWith({
                url: "https://cdn.example.com/test-file.txt",
                dateLessThan: expect.any(String),
                privateKey: "private-key-content",
                keyPairId: "key-pair-id",
            });
        });

        it("should throw MissingEnvVarError when CDN_URL is missing", () => {
            mockConfig.get
                .mockReturnValueOnce(undefined)
                .mockReturnValueOnce("key-pair-id");

            expect(() => service.generateSignedUrl("test-file.txt")).toThrow(MissingEnvVarError);
        });

        it("should throw MissingEnvVarError when CLOUDFRONT_KEY_PAIR_ID is missing", () => {
            mockConfig.get
                .mockReturnValueOnce("cdn.example.com")
                .mockReturnValueOnce(undefined);

            expect(() => service.generateSignedUrl("test-file.txt")).toThrow(MissingEnvVarError);
        });
    });

    describe("getCDNUrl", () => {
        it("should return CDN URL for key", () => {
            mockConfig.get.mockReturnValue("cdn.example.com");

            const result = service.getCDNUrl("test-file.txt");

            expect(result).toBe("https://cdn.example.com/test-file.txt");
        });

        it("should handle special characters in key", () => {
            mockConfig.get.mockReturnValue("cdn.example.com");

            const result = service.getCDNUrl("path/to/file with spaces.txt");

            expect(result).toBe("https://cdn.example.com/path/to/file with spaces.txt");
        });
    });

    describe("generateSignedCookies", () => {
        it("should generate signed cookies successfully", () => {
            mockConfig.get
                .mockReturnValueOnce("cdn.example.com")
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");

            const validCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": "signature",
                "CloudFront-Key-Pair-Id": "key-pair-id",
            };
            (getSignedCookies as jest.Mock).mockReturnValue(validCookies);

            const result = service.generateSignedCookies(3600);

            expect(result).toBe(validCookies);
            expect(getSignedCookies).toHaveBeenCalledWith({
                url: "https://cdn.example.com/*",
                keyPairId: "key-pair-id",
                privateKey: "private-key-content",
                dateLessThan: expect.any(String),
            });
        });

        it("should throw CloudfrontSignedCookiesException when cookies are invalid", () => {
            mockConfig.get
                .mockReturnValueOnce("cdn.example.com")
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");

            const invalidCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": undefined,
                "CloudFront-Key-Pair-Id": undefined,
            };
            (getSignedCookies as jest.Mock).mockReturnValue(invalidCookies);

            expect(() => service.generateSignedCookies(3600)).toThrow(CloudfrontSignedCookiesException);
        });

        it("should throw MissingEnvVarError when CDN_URL is missing", () => {
            mockConfig.get
                .mockReturnValueOnce(undefined)
                .mockReturnValueOnce("key-pair-id");

            expect(() => service.generateSignedCookies(3600)).toThrow(MissingEnvVarError);
        });

        it("should throw MissingEnvVarError when CLOUDFRONT_KEY_PAIR_ID is missing", () => {
            mockConfig.get
                .mockReturnValueOnce("cdn.example.com")
                .mockReturnValueOnce(undefined);

            expect(() => service.generateSignedCookies(3600)).toThrow(MissingEnvVarError);
        });

        it("should use default expiration (86400s) when argument is not provided", () => {
            mockConfig.get
                .mockReturnValueOnce("cdn.example.com")
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");

            const validCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": "signature",
                "CloudFront-Key-Pair-Id": "key-pair-id",
            };
            (getSignedCookies as jest.Mock).mockReturnValue(validCookies);

            const result = service.generateSignedCookies();

            expect(result).toBe(validCookies);
        });
    });

    describe("createSignedCookies", () => {
        it("should create signed cookies successfully", () => {
            mockConfig.get
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");

            const validCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": "signature",
                "CloudFront-Key-Pair-Id": "key-pair-id",
            };
            (getSignedCookies as jest.Mock).mockReturnValue(validCookies);

            const result = service.createSignedCookies("https://example.com/resource", 3600);

            expect(result).toEqual({
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": "signature",
                "CloudFront-Key-Pair-Id": "key-pair-id",
                "CloudFront-Expires": expect.any(String),
            });
        });

        it("should throw CloudfrontSignedCookiesException when cookies are invalid", () => {
            mockConfig.get
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");

            const invalidCookies = {
                "CloudFront-Policy": "policy",
                "CloudFront-Signature": undefined,
                "CloudFront-Key-Pair-Id": undefined,
            };
            (getSignedCookies as jest.Mock).mockReturnValue(invalidCookies);

            expect(() => service.createSignedCookies("https://example.com/resource", 3600))
                .toThrow(CloudfrontSignedCookiesException);
        });

        it("should throw MissingEnvVarError when CLOUDFRONT_KEY_PAIR_ID is missing", () => {
            mockConfig.get
                .mockReturnValueOnce(undefined);

            expect(() => service.createSignedCookies("https://example.com/resource", 3600))
                .toThrow(MissingEnvVarError);
        });

        it("should default CloudFront-Policy to empty string when undefined", () => {
            mockConfig.get
                .mockReturnValueOnce("key-pair-id")
                .mockReturnValueOnce("/path/to/key.pem");

            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.readFileSync as jest.Mock).mockReturnValue("private-key-content");

            const cookiesWithoutPolicy = {
                "CloudFront-Policy": undefined,
                "CloudFront-Signature": "signature",
                "CloudFront-Key-Pair-Id": "key-pair-id",
            };
            (getSignedCookies as jest.Mock).mockReturnValue(cookiesWithoutPolicy);

            const result = service.createSignedCookies("https://example.com/resource", 3600);

            expect(result["CloudFront-Policy"]).toBe("");
            expect(result["CloudFront-Signature"]).toBe("signature");
        });
    });
});
