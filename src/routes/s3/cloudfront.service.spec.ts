import { Test, TestingModule } from "@nestjs/testing";
import { CloudfrontService } from "./cloudfront.service";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import {
  getSignedUrl as getSignedCFUrl,
  getSignedCookies
} from "@aws-sdk/cloudfront-signer";
import { MissingEnvVarError } from "@auth/auth.error";
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
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  describe("generateSignedUrl", () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
        case "EDGE_ENDPOINT":
          return "https://cdn.example.com";
        case "EDGE_KEY_PAIR_ID":
          return "KEYPAIRID";
        case "EDGE_PRIVATE_KEY_PATH":
          return "/fake/path.pem";
        default:
          return undefined;
        }
      });

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

    it("throws MissingEnvVarError if EDGE_ENDPOINT missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });

    it("supports legacy CLOUDFRONT_* variables as fallback", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
        case "CDN_URL":
          return "cdn.example.com";
        case "CLOUDFRONT_KEY_PAIR_ID":
          return "LEGACY_KEYPAIR";
        case "CLOUDFRONT_PRIVATE_KEY_PATH":
          return "/legacy/path.pem";
        default:
          return undefined;
        }
      });

      (fs.readFileSync as jest.Mock).mockReturnValue("LEGACY_PRIVATE_KEY");
      (getSignedCFUrl as jest.Mock).mockReturnValue("SIGNED_LEGACY_URL");

      const url = cloudfrontService.generateSignedUrl("folder/file.txt");
      expect(url).toBe("SIGNED_LEGACY_URL");
      expect(getSignedCFUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://cdn.example.com/folder/file.txt",
          keyPairId: "LEGACY_KEYPAIR",
          privateKey: "LEGACY_PRIVATE_KEY"
        })
      );
    });
  });

  describe("generateSignedUrl - missing env vars", () => {
    it("throws if EDGE_ENDPOINT is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });

    it("returns unsigned URL if EDGE_KEY_PAIR_ID is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(cloudfrontService.generateSignedUrl("file.txt")).toBe(
        "https://cdn.example.com/file.txt"
      );
    });

    it("returns unsigned URL if EDGE_PRIVATE_KEY_PATH is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        return undefined;
      });

      expect(cloudfrontService.generateSignedUrl("file.txt")).toBe(
        "https://cdn.example.com/file.txt"
      );
    });
  });

  describe("generateSignedCookies", () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
        case "EDGE_ENDPOINT":
          return "https://cdn.example.com";
        case "EDGE_KEY_PAIR_ID":
          return "KEYPAIRID";
        case "EDGE_PRIVATE_KEY_PATH":
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
    it("throws if EDGE_ENDPOINT is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.generateSignedCookies()).toThrow(
        "EDGE_ENDPOINT"
      );
    });

    it("returns empty cookies if EDGE_KEY_PAIR_ID is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(cloudfrontService.generateSignedCookies()).toEqual({});
    });

    it("returns empty cookies if EDGE_PRIVATE_KEY_PATH is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        return undefined;
      });

      expect(cloudfrontService.generateSignedCookies()).toEqual({});
    });
  });

  describe("createSignedCookies - missing env vars", () => {
    it("returns empty cookies if EDGE_KEY_PAIR_ID is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(cloudfrontService.createSignedCookies("url", 3600)).toEqual({});
    });

    it("returns empty cookies if EDGE_PRIVATE_KEY_PATH is missing", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        return undefined;
      });

      expect(cloudfrontService.createSignedCookies("url", 3600)).toEqual({});
    });

    it("throws if signed cookies are incomplete", () => {
      (cloudfrontSigner.getSignedCookies as jest.Mock).mockReturnValue({
        "CloudFront-Policy": "policy"
      });

      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_KEY_PAIR_ID") return "KEYPAIRID";
        if (key === "EDGE_PRIVATE_KEY_PATH") return "/fake/path.pem";
        return undefined;
      });

      expect(() => cloudfrontService.createSignedCookies("url", 3600)).toThrow(
        "Signed cookies are incomplete"
      );
    });
  });

  describe("createSignedCookies", () => {
    beforeEach(() => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        switch (key) {
        case "EDGE_KEY_PAIR_ID":
          return "KEYPAIRID";
        case "EDGE_PRIVATE_KEY_PATH":
          return "/fake/path.pem";
        default:
          return undefined;
        }
      });

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
      ).toThrow("Signed cookies are incomplete");
    });

    it("returns empty cookies if env vars missing", () => {
      (configService.get as jest.Mock).mockImplementation(() => undefined);
      expect(cloudfrontService.createSignedCookies("url", 3600)).toEqual({});
    });
  });

  describe("getCDNUrl", () => {
    it("returns correctly encoded CDN URL", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "https://cdn.example.com";
        return undefined;
      });

      const url = cloudfrontService.getCDNUrl("path/to/file.txt");
      expect(url).toBe("https://cdn.example.com/path/to/file.txt");
    });

    it("extracts cookie domain from endpoint", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") {
          return "https://b9f865e8-4b05-48b0-abeb-7e850e58f081.svc.edge.scw.cloud";
        }
        return undefined;
      });

      expect(cloudfrontService.getCookieDomain()).toBe(
        "b9f865e8-4b05-48b0-abeb-7e850e58f081.svc.edge.scw.cloud"
      );
    });
  });
});
