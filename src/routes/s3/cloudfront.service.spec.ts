import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadEnvVarError, MissingEnvVarError } from "@auth/auth.error";
import { CloudfrontService } from "./cloudfront.service";

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
    it("returns the resource URL using EDGE_ENDPOINT", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        return undefined;
      });

      const url = cloudfrontService.generateSignedUrl("file.txt");

      expect(url).toBe("https://cdn.example.com/file.txt");
    });

    it("encodes each path segment", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        return undefined;
      });

      const url = cloudfrontService.generateSignedUrl("path with spaces/file #1.txt");

      expect(url).toBe("https://cdn.example.com/path%20with%20spaces/file%20%231.txt");
    });

    it("preserves an explicit protocol", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "http://cdn.example.com";
        return undefined;
      });

      const url = cloudfrontService.generateSignedUrl("file.txt");

      expect(url).toBe("http://cdn.example.com/file.txt");
    });

    it("trims whitespace and trailing slashes from EDGE_ENDPOINT", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "  cdn.example.com///  ";
        return undefined;
      });

      const url = cloudfrontService.generateSignedUrl("nested/file.txt");

      expect(url).toBe("https://cdn.example.com/nested/file.txt");
    });

    it("throws MissingEnvVarError if EDGE_ENDPOINT is missing", () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      expect(() => cloudfrontService.generateSignedUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });
  });

  describe("getCDNUrl", () => {
    it("returns the same encoded resource URL", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        return undefined;
      });

      const url = cloudfrontService.getCDNUrl("path/to/file.txt");

      expect(url).toBe("https://cdn.example.com/path/to/file.txt");
    });
  });

  describe("getCookieDomain", () => {
    it("returns the hostname from EDGE_ENDPOINT", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "https://cdn.example.com";
        return undefined;
      });

      const domain = cloudfrontService.getCookieDomain();

      expect(domain).toBe("cdn.example.com");
    });

    it("adds https before extracting the hostname", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        return undefined;
      });

      const domain = cloudfrontService.getCookieDomain();

      expect(domain).toBe("cdn.example.com");
    });

    it("throws BadEnvVarError if EDGE_ENDPOINT is missing", () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      expect(() => cloudfrontService.getCookieDomain()).toThrow(
        BadEnvVarError
      );
    });
  });
});
