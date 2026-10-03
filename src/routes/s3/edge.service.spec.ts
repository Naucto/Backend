import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MissingEnvVarError } from "@auth/auth.error";
import { EdgeService } from "./edge.service";

describe("EdgeService", () => {
  let edgeService: EdgeService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EdgeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn()
          }
        }
      ]
    }).compile();

    edgeService = module.get<EdgeService>(EdgeService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe("getCDNUrl", () => {
    it("returns the resource URL using EDGE_ENDPOINT", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        return undefined;
      });

      const url = edgeService.getCDNUrl("file.txt");

      expect(url).toBe("https://cdn.example.com/file.txt");
    });

    it("encodes each path segment", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "cdn.example.com";
        return undefined;
      });

      const url = edgeService.getCDNUrl(
        "path with spaces/file #1.txt"
      );

      expect(url).toBe(
        "https://cdn.example.com/path%20with%20spaces/file%20%231.txt"
      );
    });

    it("preserves an explicit protocol", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "http://cdn.example.com";
        return undefined;
      });

      const url = edgeService.getCDNUrl("file.txt");

      expect(url).toBe("http://cdn.example.com/file.txt");
    });

    it("trims whitespace and trailing slashes from EDGE_ENDPOINT", () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EDGE_ENDPOINT") return "  cdn.example.com///  ";
        return undefined;
      });

      const url = edgeService.getCDNUrl("nested/file.txt");

      expect(url).toBe("https://cdn.example.com/nested/file.txt");
    });

    it("throws MissingEnvVarError if EDGE_ENDPOINT is missing", () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      expect(() => edgeService.getCDNUrl("file.txt")).toThrow(
        MissingEnvVarError
      );
    });
  });
});
