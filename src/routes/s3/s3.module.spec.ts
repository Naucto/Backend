import { Test, TestingModule } from "@nestjs/testing";
import { S3Module } from "./s3.module";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ConfigurationException } from "./s3.error";
import { S3Service } from "./s3.service";
import { BucketService } from "./bucket.service";
import { CloudfrontService } from "./cloudfront.service";

describe("S3Module", () => {
  describe("S3Client Provider Configuration", () => {
    it("should throw S3ConfigurationException when AWS_REGION is missing", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string | undefined> = {
            "AWS_REGION": undefined,
            "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
            "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
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

    it("should throw S3ConfigurationException when AWS_ACCESS_KEY_ID is missing", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string | undefined> = {
            "AWS_REGION": "us-east-1",
            "AWS_ACCESS_KEY_ID": undefined,
            "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
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

    it("should throw S3ConfigurationException when AWS_SECRET_ACCESS_KEY is missing", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string | undefined> = {
            "AWS_REGION": "us-east-1",
            "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
            "AWS_SECRET_ACCESS_KEY": undefined,
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
            "AWS_REGION": undefined,
            "AWS_ACCESS_KEY_ID": undefined,
            "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
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
      expect(error.missingKeys).toEqual(["AWS_REGION", "AWS_ACCESS_KEY_ID"]);
    });

    it("should include all missing keys in S3ConfigurationException", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string | undefined> = {
            "AWS_REGION": undefined,
            "AWS_ACCESS_KEY_ID": undefined,
            "AWS_SECRET_ACCESS_KEY": undefined,
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
      expect(error.missingKeys).toEqual(["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
    });

    it("should compile successfully when all env vars are present", async () => {
      const mockConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const envVars: Record<string, string> = {
            "AWS_REGION": "us-east-1",
            "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
            "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
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
      expect(module.get(CloudfrontService)).toBeInstanceOf(CloudfrontService);
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
