import { S3Service } from "./s3.service";
import { S3ConfigurationException } from "./s3.error";
import { ConfigService } from "@nestjs/config";

describe("S3Service (constructor)", () => {
  let mockConfigService: Partial<ConfigService>;

  it("should throw S3ConfigurationException if AWS_REGION is missing", () => {
    mockConfigService = {
      get: (key: string) => {
        if (key === "AWS_REGION") return undefined;
        if (key === "AWS_ACCESS_KEY_ID") return "fake-access-key";
        if (key === "AWS_SECRET_ACCESS_KEY") return "fake-secret-key";
        if (key === "S3_BUCKET_NAME") return "my-bucket";
        return undefined;
      },
    };

    expect(() => new S3Service(mockConfigService as ConfigService))
      .toThrow(S3ConfigurationException);
  });

  it("should throw S3ConfigurationException if AWS_ACCESS_KEY_ID is missing", () => {
    mockConfigService = {
      get: (key: string) => {
        if (key === "AWS_REGION") return "us-east-1";
        if (key === "AWS_ACCESS_KEY_ID") return undefined;
        if (key === "AWS_SECRET_ACCESS_KEY") return "fake-secret-key";
        if (key === "S3_BUCKET_NAME") return "my-bucket";
        return undefined;
      },
    };

    expect(() => new S3Service(mockConfigService as ConfigService))
      .toThrow(S3ConfigurationException);
  });

  it("should throw S3ConfigurationException if AWS_SECRET_ACCESS_KEY is missing", () => {
    mockConfigService = {
      get: (key: string) => {
        if (key === "AWS_REGION") return "us-east-1";
        if (key === "AWS_ACCESS_KEY_ID") return "fake-access-key";
        if (key === "AWS_SECRET_ACCESS_KEY") return undefined;
        if (key === "S3_BUCKET_NAME") return "my-bucket";
        return undefined;
      },
    };

    expect(() => new S3Service(mockConfigService as ConfigService))
      .toThrow(S3ConfigurationException);
  });

  it("should construct successfully if all env vars are provided", () => {
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

    expect(() => new S3Service(mockConfigService as ConfigService)).not.toThrow();
  });
});
