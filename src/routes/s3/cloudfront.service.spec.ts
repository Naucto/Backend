import { Test, TestingModule } from "@nestjs/testing";
import { CloudfrontService } from "./cloudfront.service";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import {
  getSignedUrl as getSignedCFUrl,
  getSignedCookies
} from "@aws-sdk/cloudfront-signer";
import { MissingEnvVarError, CloudfrontSignedCookiesException } from "@auth/auth.error";
import * as cloudfrontSigner from "@aws-sdk/cloudfront-signer";

jest.mock("fs");
jest.mock("@aws-sdk/cloudfront-signer");

describe("CloudfrontService", () => {
  let cloudfrontService: CloudfrontService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudfrontService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn()
          }
        }
      ]
    }).compile();

    cloudfrontService = module.get<CloudfrontService>(CloudfrontService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe("generateSignedUrl", () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
        case "CDN_URL":
          return "cdn.example.com";
        case "CLOUDFRONT_KEY_PAIR_ID":
          return "KEYPAIRID";
        case "CLOUDFRONT_PRIVATE_KEY_PATH":
          return "/fake/path.pem";
        default:
          return undefined;
        }
      });

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue("FAKE_PRIVATE_KEY");
      (getSignedCFUrl as jest.Mock).mockReturnValue("SIGNED_URL");
    });

    it("generates signed URL correctly", () => {
      const url = cloudfrontService.generateSignedUrl("file.txt");
      expect(url).toBe("SIGNED_URL");
      expect(fs.readFileSync).toHaveBeenCalledWith("/fake/path.pem", "utf8");
      expect(getSignedCFUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://cdn.example.com/file.txt",
          keyPairId: "KEYPAIRID",
          privateKey: "FAKE_PRIVATE_KEY"
        })
      );
    });

    it("throws MissingEnvVarError if CDN_URL missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });
  });

  describe("generateSignedUrl - missing env vars", () => {
    it("throws if CDN_URL is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });

    it("throws if CLOUDFRONT_KEY_PAIR_ID is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CDN_URL") return "cdn.example.com";
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });

    it("throws if CLOUDFRONT_PRIVATE_KEY_PATH is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CDN_URL") return "cdn.example.com";
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });
  });

  describe("generateSignedCookies", () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
          case "CDN_URL":
            return "cdn.example.com";
          case "CLOUDFRONT_KEY_PAIR_ID":
            return "KEYPAIRID";
          case "CLOUDFRONT_PRIVATE_KEY_PATH":
            return "/fake/path.pem";
          default:
            return undefined;
        }
      });

      (fs.readFileSync as jest.Mock).mockReturnValue("FAKE_PRIVATE_KEY");
      (getSignedCookies as jest.Mock).mockReturnValue({
        "CloudFront-Policy": "policy",
        "CloudFront-Signature": "signature",
        "CloudFront-Key-Pair-Id": "KEYPAIRID"
      });
    });

    it("returns signed cookies with expiration", () => {
      const cookies = cloudfrontService.generateSignedCookies();
      expect(cookies).toHaveProperty("CloudFront-Policy");
      expect(cookies).toHaveProperty("CloudFront-Signature");
      expect(cookies).toHaveProperty("CloudFront-Key-Pair-Id");
    });
  });

  describe("generateSignedCookies - missing env vars", () => {
    it("throws if CDN_URL is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedCookies()).toThrow(
        MissingEnvVarError
      );
    });

    it("throws if CLOUDFRONT_KEY_PAIR_ID is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CDN_URL") return "cdn.example.com";
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedCookies()).toThrow(
        MissingEnvVarError
      );
    });

    it("throws if CLOUDFRONT_PRIVATE_KEY_PATH is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CDN_URL") return "cdn.example.com";
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedCookies()).toThrow(
        MissingEnvVarError
      );
    });
  });

  describe("createSignedCookies - missing env vars", () => {
    it("throws if CLOUDFRONT_KEY_PAIR_ID is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.createSignedCookies("url", 3600)).toThrow(
        "CLOUDFRONT_KEY_PAIR_ID"
      );
    });

    it("throws if CLOUDFRONT_PRIVATE_KEY_PATH is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        return undefined;
      });

      expect(() => cloudfrontService.createSignedCookies("url", 3600)).toThrow(
        "CLOUDFRONT_PRIVATE_KEY_PATH"
      );
    });

    it("throws if signed cookies are incomplete", () => {
      (cloudfrontSigner.getSignedCookies as jest.Mock).mockReturnValue({
        "CloudFront-Policy": "policy"
      });

      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CLOUDFRONT_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "CLOUDFRONT_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.createSignedCookies("url", 3600)).toThrow(
        CloudfrontSignedCookiesException
      );
    });
  });

  describe("createSignedCookies", () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
        case "CLOUDFRONT_KEY_PAIR_ID":
          return "KEYPAIRID";
        case "CLOUDFRONT_PRIVATE_KEY_PATH":
          return "/fake/path.pem";
        default:
          return undefined;
        }
      });

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue("FAKE_PRIVATE_KEY");
      (getSignedCookies as jest.Mock).mockReturnValue({
        "CloudFront-Signature": "signature",
        "CloudFront-Key-Pair-Id": "KEYPAIRID"
      });
    });

    it("creates signed cookies with expires", () => {
      const cookies = cloudfrontService.createSignedCookies(
        "https://cdn.example.com/file.txt",
        3600
      );
      expect(cookies).toHaveProperty("CloudFront-Signature");
      expect(cookies).toHaveProperty("CloudFront-Key-Pair-Id");
      expect(cookies).toHaveProperty("CloudFront-Expires");
    });

    it("throws if signed cookies incomplete", () => {
      (getSignedCookies as jest.Mock).mockReturnValue({});
      expect(() =>
        cloudfrontService.createSignedCookies(
          "https://cdn.example.com/file.txt",
          3600
        )
      ).toThrow(CloudfrontSignedCookiesException);
    });

    it("throws if env vars missing", () => {
      (configService.get as jest.Mock).mockImplementation(() => undefined);
      expect(() => cloudfrontService.createSignedCookies("url", 3600)).toThrow(
        MissingEnvVarError
      );
    });
  });

  describe("getCDNUrl", () => {
    it("returns correctly encoded CDN URL", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "CDN_URL") return "cdn.example.com";
        return undefined;
      });

      const url = cloudfrontService.getCDNUrl("path/to/file.txt");
      expect(url).toBe("https://cdn.example.com/path/to/file.txt");
    });
  });
});
