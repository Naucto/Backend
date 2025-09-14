import { S3Service } from "./s3.service";
import { S3ConfigurationException, BucketResolutionException, S3ListBucketsException } from "./s3.error";
import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { ListBucketsCommand } from "@aws-sdk/client-s3";

// Mock S3Client
jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    ListBucketsCommand: jest.fn(),
  };
});

describe("S3Service", () => {
  let s3Service: S3Service;
  let mockConfigService: Partial<ConfigService>;
  let mockS3Client: { send: jest.Mock };

  beforeEach(() => {
    mockConfigService = {
      get: (key: string) => {
        switch (key) {
        case "AWS_REGION":
          return "us-east-1";
        case "AWS_ACCESS_KEY_ID":
          return "fake-access-key";
        case "AWS_SECRET_ACCESS_KEY":
          return "fake-secret-key";
        case "S3_BUCKET_NAME":
          return "my-default-bucket";
        default:
          return undefined;
        }
      },
    };

    mockS3Client = {
      send: jest.fn(),
    };

    (S3Client as jest.Mock).mockImplementation(() => mockS3Client);

    s3Service = new S3Service(mockConfigService as ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("resolveBucket", () => {
    it("should return provided bucket name when bucketName is provided", () => {
      const result = s3Service["resolveBucket"]("custom-bucket");
      expect(result).toBe("custom-bucket");
    });

    it("should return default bucket name when bucketName is not provided", () => {
      const result = s3Service["resolveBucket"]();
      expect(result).toBe("my-default-bucket");
    });

    it("should throw BucketResolutionException when no bucket name provided and no default bucket configured", () => {
      const configWithoutBucket: Partial<ConfigService> = {
        get: (key: string) => {
          switch (key) {
          case "AWS_REGION":
            return "us-east-1";
          case "AWS_ACCESS_KEY_ID":
            return "fake-access-key";
          case "AWS_SECRET_ACCESS_KEY":
            return "fake-secret-key";
          case "S3_BUCKET_NAME":
            return undefined;
          default:
            return undefined;
          }
        },
      };

      const serviceWithoutBucket = new S3Service(configWithoutBucket as ConfigService);

      expect(() => serviceWithoutBucket["resolveBucket"]()).toThrow(BucketResolutionException);
      expect(() => serviceWithoutBucket["resolveBucket"]()).toThrow(
        "No bucket name provided and no default bucket configured."
      );
    });

    it("should throw BucketResolutionException when bucketName is undefined and no default bucket", () => {
      const configWithoutBucket: Partial<ConfigService> = {
        get: (key: string) => {
          switch (key) {
          case "AWS_REGION":
            return "us-east-1";
          case "AWS_ACCESS_KEY_ID":
            return "fake-access-key";
          case "AWS_SECRET_ACCESS_KEY":
            return "fake-secret-key";
          case "S3_BUCKET_NAME":
            return undefined;
          default:
            return undefined;
          }
        },
      };

      const serviceWithoutBucket = new S3Service(configWithoutBucket as ConfigService);

      expect(() => serviceWithoutBucket["resolveBucket"](undefined)).toThrow(BucketResolutionException);
    });
  });

  describe("listBuckets", () => {
    it("should return list of buckets when S3 call is successful", async () => {
      const mockBuckets = [{ Name: "bucket1" }, { Name: "bucket2" }];
      mockS3Client.send.mockResolvedValueOnce({ Buckets: mockBuckets });

      const result = await s3Service.listBuckets();

      expect(result).toEqual(mockBuckets);
      expect(ListBucketsCommand).toHaveBeenCalledWith({});
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it("should return empty array when S3 returns no buckets", async () => {
      mockS3Client.send.mockResolvedValueOnce({ Buckets: undefined });

      const result = await s3Service.listBuckets();

      expect(result).toEqual([]);
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });

    it("should throw S3ListBucketsException with original error message when known error occurs", async () => {
      const originalError = new Error("AWS S3 error: Access Denied");
      mockS3Client.send.mockRejectedValueOnce(originalError);

      try {
        await s3Service.listBuckets();
        fail("Expected an error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ListBucketsException);
        const s3Error = error as S3ListBucketsException;
        expect(s3Error.message).toBe("AWS S3 error: Access Denied");
        expect(s3Error.cause).toBe(originalError);
      }
    });

    it("should throw S3ListBucketsException with generic message when unknown error occurs", async () => {
      const unknownError = { some: "weird error object" };
      mockS3Client.send.mockRejectedValueOnce(unknownError);

      try {
        await s3Service.listBuckets();
        fail("Expected an error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ListBucketsException);
        const s3Error = error as S3ListBucketsException;
        expect(s3Error.message).toBe("An unknown error occurred while listing buckets.");
      }
    });

    it("should handle null error object gracefully", async () => {
      mockS3Client.send.mockRejectedValueOnce(null);

      try {
        await s3Service.listBuckets();
        fail("Expected an error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ListBucketsException);
        const s3Error = error as S3ListBucketsException;
        expect(s3Error.message).toBe("An unknown error occurred while listing buckets.");
      }
    });
  });

  describe("S3Service (constructor) - Additional tests", () => {
    let mockConfigService: Partial<ConfigService>;

    it("should throw S3ConfigurationException with multiple missing env vars", () => {
      mockConfigService = {
        get: () => {
          return undefined;
        },
      };

      expect(() => new S3Service(mockConfigService as ConfigService))
        .toThrow(S3ConfigurationException);
    
      try {
        new S3Service(mockConfigService as ConfigService);
      } catch (error) {
        expect(error).toBeInstanceOf(S3ConfigurationException);
      }
    });

    it("should create S3Client with correct credentials when all env vars are provided", () => {
      mockConfigService = {
        get: (key: string) => {
          switch (key) {
          case "AWS_REGION":
            return "us-east-1";
          case "AWS_ACCESS_KEY_ID":
            return "fake-access-key";
          case "AWS_SECRET_ACCESS_KEY":
            return "fake-secret-key";
          case "S3_BUCKET_NAME":
            return "my-bucket";
          default:
            return undefined;
          }
        },
      };

      const s3Service = new S3Service(mockConfigService as ConfigService);
    
      expect(s3Service).toBeDefined();
    });

    it("should set defaultBucket when S3_BUCKET_NAME is provided", () => {
      mockConfigService = {
        get: (key: string) => {
          switch (key) {
          case "AWS_REGION":
            return "us-east-1";
          case "AWS_ACCESS_KEY_ID":
            return "fake-access-key";
          case "AWS_SECRET_ACCESS_KEY":
            return "fake-secret-key";
          case "S3_BUCKET_NAME":
            return "my-default-bucket";
          default:
            return undefined;
          }
        },
      };

      const s3Service = new S3Service(mockConfigService as ConfigService);
    
      expect(s3Service["defaultBucket"]).toBe("my-default-bucket");
    });

    it("should not set defaultBucket when S3_BUCKET_NAME is not provided", () => {
      mockConfigService = {
        get: (key: string) => {
          switch (key) {
          case "AWS_REGION":
            return "us-east-1";
          case "AWS_ACCESS_KEY_ID":
            return "fake-access-key";
          case "AWS_SECRET_ACCESS_KEY":
            return "fake-secret-key";
          case "S3_BUCKET_NAME":
            return undefined;
          default:
            return undefined;
          }
        },
      };

      const s3Service = new S3Service(mockConfigService as ConfigService);
    
      expect(s3Service["defaultBucket"]).toBeUndefined();
    });
  });

  describe("S3Service (constructor) - Specific missing env vars", () => {
    it("should throw S3ConfigurationException with specific missing AWS_REGION", () => {
      const mockConfigService: Partial<ConfigService> = {
        get: (key: string) => {
          if (key === "AWS_REGION") return undefined;
          if (key === "AWS_ACCESS_KEY_ID") return "fake-access-key";
          if (key === "AWS_SECRET_ACCESS_KEY") return "fake-secret-key";
          return undefined;
        },
      };

      try {
        new S3Service(mockConfigService as ConfigService);
        fail("Should have thrown S3ConfigurationException");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ConfigurationException);
        const s3Error = error as S3ConfigurationException;
        expect(s3Error.missingKeys).toContain("AWS_REGION");
        expect(s3Error.message).toContain("Missing keys: AWS_REGION");
      }
    });

    it("should throw S3ConfigurationException with specific missing AWS_ACCESS_KEY_ID", () => {
      const mockConfigService: Partial<ConfigService> = {
        get: (key: string) => {
          if (key === "AWS_REGION") return "us-east-1";
          if (key === "AWS_ACCESS_KEY_ID") return undefined;
          if (key === "AWS_SECRET_ACCESS_KEY") return "fake-secret-key";
          return undefined;
        },
      };

      try {
        new S3Service(mockConfigService as ConfigService);
        fail("Should have thrown S3ConfigurationException");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ConfigurationException);
        const s3Error = error as S3ConfigurationException;
        expect(s3Error.missingKeys).toContain("AWS_ACCESS_KEY_ID");
        expect(s3Error.message).toContain("Missing keys: AWS_ACCESS_KEY_ID");
      }
    });

    it("should throw S3ConfigurationException with specific missing AWS_SECRET_ACCESS_KEY", () => {
      const mockConfigService: Partial<ConfigService> = {
        get: (key: string) => {
          if (key === "AWS_REGION") return "us-east-1";
          if (key === "AWS_ACCESS_KEY_ID") return "fake-access-key";
          if (key === "AWS_SECRET_ACCESS_KEY") return undefined;
          return undefined;
        },
      };

      try {
        new S3Service(mockConfigService as ConfigService);
        fail("Should have thrown S3ConfigurationException");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ConfigurationException);
        const s3Error = error as S3ConfigurationException;
        expect(s3Error.missingKeys).toContain("AWS_SECRET_ACCESS_KEY");
        expect(s3Error.message).toContain("Missing keys: AWS_SECRET_ACCESS_KEY");
      }
    });

    it("should include all missing keys in the exception when multiple are missing", () => {
      const mockConfigService: Partial<ConfigService> = {
        get: () => undefined,
      };

      try {
        new S3Service(mockConfigService as ConfigService);
        fail("Should have thrown S3ConfigurationException");
      } catch (error) {
        expect(error).toBeInstanceOf(S3ConfigurationException);
        const s3Error = error as S3ConfigurationException;
        expect(s3Error.missingKeys).toEqual([
          "AWS_REGION",
          "AWS_ACCESS_KEY_ID", 
          "AWS_SECRET_ACCESS_KEY"
        ]);
        expect(s3Error.message).toContain("Missing keys: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
      }
    });

    it("should create S3Client with correct configuration when all env vars are present", () => {
      const mockConfigService: Partial<ConfigService> = {
        get: (key: string) => {
          switch (key) {
          case "AWS_REGION":
            return "us-east-1";
          case "AWS_ACCESS_KEY_ID":
            return "fake-access-key";
          case "AWS_SECRET_ACCESS_KEY":
            return "fake-secret-key";
          case "S3_BUCKET_NAME":
            return "test-bucket";
          default:
            return undefined;
          }
        },
      };

      const s3Service = new S3Service(mockConfigService as ConfigService);
    
      expect(S3Client).toHaveBeenCalled();
      expect(S3Client).toHaveBeenCalledWith({
        region: "us-east-1",
        credentials: {
          accessKeyId: "fake-access-key",
          secretAccessKey: "fake-secret-key",
        },
      });
    
      expect(s3Service).toBeDefined();
    });
  });});
