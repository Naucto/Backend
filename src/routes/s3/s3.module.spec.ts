import { Test, TestingModule } from "@nestjs/testing";
import { S3Module } from "./s3.module";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ConfigurationException } from "./s3.error";
import { S3Service } from "./s3.service";
import { BucketService } from "./bucket.service";

describe("S3Module", () => {
  describe("S3Client Provider Configuration", () => {
    
    it("should throw S3ConfigurationException when S3_ENDPOINT is missing", async () => {
        const mockConfigService = {
          get: jest.fn().mockImplementation((key: string) => {
            const envVars: Record<string, string | undefined> = {
              "S3_ENDPOINT": undefined,
              "S3_REGION": "fr-par",
              "S3_ACCESS_KEY_ID": "SCW...",
              "S3_SECRET_ACCESS_KEY": "xxx...",
            };
            return envVars[key];
          }),
        };
  
        await expect(
          Test.createTestingModule({
            imports: [S3Module],
          }).overrideProvider(ConfigService)
            .useValue(mockConfigService)
            .compile()
        ).rejects.toThrow(S3ConfigurationException);
      });

    it("should throw S3ConfigurationException when S3_REGION is missing", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string | undefined> = {
            "S3_ENDPOINT": "https://s3.fr-par.scw.cloud",
            "S3_REGION": undefined,
            "S3_ACCESS_KEY_ID": "SCW...",
            "S3_SECRET_ACCESS_KEY": "xxx...",
          };
          return envVars[key];
        }),
      };

      await expect(
        Test.createTestingModule({
          imports: [S3Module],
        }).overrideProvider(ConfigService)
          .useValue(mockConfigService)
          .compile()
      ).rejects.toThrow(S3ConfigurationException);
    });

    it("should throw S3ConfigurationException with correct missing keys", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string | undefined> = {
            "S3_ENDPOINT": undefined,
            "S3_REGION": undefined,
            "S3_ACCESS_KEY_ID": undefined,
            "S3_SECRET_ACCESS_KEY": "xxx...",
          };
          return envVars[key];
        }),
      };

      const error = await Test.createTestingModule({
        imports: [S3Module],
      }).overrideProvider(ConfigService)
        .useValue(mockConfigService)
        .compile()
        .catch(e => e);

      expect(error).toBeInstanceOf(S3ConfigurationException);
      expect(error.missingKeys).toContain("S3_ENDPOINT");
      expect(error.missingKeys).toContain("S3_REGION");
      expect(error.missingKeys).toContain("S3_ACCESS_KEY_ID");
    });

    it("should compile successfully when all env vars are present", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string> = {
            "S3_ENDPOINT": "https://s3.fr-par.scw.cloud",
            "S3_REGION": "fr-par",
            "S3_ACCESS_KEY_ID": "SCW...",
            "S3_SECRET_ACCESS_KEY": "xxx...",
          };
          return envVars[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [S3Module],
      }).overrideProvider(ConfigService)
        .useValue(mockConfigService)
        .compile();

      expect(module).toBeDefined();
      expect(module.get(S3Service)).toBeInstanceOf(S3Service);
      expect(module.get(BucketService)).toBeInstanceOf(BucketService);
      expect(module.get(S3Client)).toBeInstanceOf(S3Client);
    });
  });

  describe("Conditional Controller Registration", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it("should exclude S3Controller in production mode", () => {
        process.env["NODE_ENV"] = "production";
        const { S3Module } = require("./s3.module");
        const controllers = Reflect.getMetadata("controllers", S3Module);
        expect(controllers).toEqual([]);
    });

    it("should include S3Controller in development mode", () => {
        process.env["NODE_ENV"] = "development";
        const { S3Module } = require("./s3.module");
        const controllers = Reflect.getMetadata("controllers", S3Module);
        expect(controllers).toHaveLength(1);
    });
  });
});
