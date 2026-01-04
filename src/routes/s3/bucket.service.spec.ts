import { BucketService } from "./bucket.service";
import { BucketPolicy } from "./s3.interface";
import {
  S3Client,
  ListBucketsCommand,
  DeleteBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand
} from "@aws-sdk/client-s3";
import {
  S3ListBucketsException,
  S3DeleteBucketException,
  S3CreateBucketException,
  S3ApplyPolicyException,
  BucketResolutionException
} from "./s3.error";
import { ConfigService } from "@nestjs/config";

describe("BucketService", () => {
  let bucketService: BucketService;
  let mockS3: S3Client & { send: jest.Mock };
  let mockConfigService: ConfigService;

  beforeEach(() => {
    mockS3 = {
      send: jest.fn(),
    } as unknown as S3Client & { send: jest.Mock };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "S3_BUCKET_NAME") return undefined;
        return undefined;
      }),
    } as unknown as ConfigService;

    bucketService = new BucketService(mockS3, mockConfigService);
  });

  describe("resolveBucket", () => {
    it("returns provided bucket name", () => {
      const result = (bucketService as unknown as { resolveBucket: (bucket: string) => string }).resolveBucket("my-bucket");
      expect(result).toBe("my-bucket");
    });

    it("throws when no bucket provided and no default bucket", () => {
      expect(() => (bucketService as unknown as { resolveBucket: () => void }).resolveBucket()).toThrow(BucketResolutionException);
    });
  });

  describe("listBuckets", () => {
    it("returns buckets", async () => {
      mockS3.send.mockResolvedValueOnce({ Buckets: [{ Name: "bucket1" }] });

      const result = await bucketService.listBuckets();

      expect(result).toEqual([{ Name: "bucket1" }]);
      expect(mockS3.send).toHaveBeenCalledWith(expect.any(ListBucketsCommand));
    });

    it("returns empty array when no buckets", async () => {
      mockS3.send.mockResolvedValueOnce({});

      const result = await bucketService.listBuckets();

      expect(result).toEqual([]);
    });

    it("throws S3ListBucketsException on error", async () => {
      const err = new Error("Access denied");
      mockS3.send.mockRejectedValueOnce(err);

      await expect(bucketService.listBuckets()).rejects.toThrow(S3ListBucketsException);
    });

    it("throws S3ListBucketsException on unknown error", async () => {
      mockS3.send.mockRejectedValueOnce("something bad" as unknown);

      await expect(bucketService.listBuckets()).rejects.toThrow(
        "An unknown error occurred while listing buckets."
      );
    });
  });

  describe("deleteBucket", () => {
    it("deletes a bucket", async () => {
      mockS3.send.mockResolvedValueOnce({});
      await bucketService.deleteBucket("my-bucket");
      expect(mockS3.send).toHaveBeenCalledWith(expect.any(DeleteBucketCommand));
    });

    it("throws S3DeleteBucketException on error", async () => {
      mockS3.send.mockRejectedValueOnce(new Error("fail"));
      await expect(bucketService.deleteBucket("my-bucket")).rejects.toThrow(S3DeleteBucketException);
    });
  });

  describe("createBucket", () => {
    it("creates a bucket", async () => {
      mockS3.send.mockResolvedValueOnce({});
      await bucketService.createBucket("my-bucket");
      expect(mockS3.send).toHaveBeenCalledWith(expect.any(CreateBucketCommand));
    });

    it("throws S3CreateBucketException on error", async () => {
      mockS3.send.mockRejectedValueOnce(new Error("fail"));
      await expect(bucketService.createBucket("my-bucket")).rejects.toThrow(S3CreateBucketException);
    });
  });

  describe("generateBucketPolicy", () => {
    it("generates default policy", () => {
      const [statement] = bucketService.generateBucketPolicy("my-bucket").Statement;
      if (!statement) throw new Error("Statement is undefined");

      expect(statement.Resource).toBe("arn:aws:s3:::my-bucket/*");
      expect(statement.Effect).toBe("Allow");
      expect(statement.Principal).toBe("*");
      expect(statement.Action).toEqual(["s3:GetObject"]);
    });

    it("generates policy with custom values", () => {
      const [statement] = bucketService.generateBucketPolicy(
        "my-bucket",
        ["s3:PutObject"],
        "Deny",
        "123",
        "prefix/*"
      ).Statement;

      if (!statement) throw new Error("Statement is undefined");
      expect(statement.Effect).toBe("Deny");
      expect(statement.Principal).toEqual({ AWS: "123" });
      expect(statement.Resource).toBe("arn:aws:s3:::my-bucket/prefix/*");
      expect(statement.Action).toEqual(["s3:PutObject"]);
    });
  });
  
  describe("applyBucketPolicy", () => {
    it("applies a bucket policy (object)", async () => {
      mockS3.send.mockResolvedValueOnce({});
      const policy = bucketService.generateBucketPolicy("my-bucket");

      await bucketService.applyBucketPolicy(policy, "my-bucket");

      expect(mockS3.send).toHaveBeenCalledWith(expect.any(PutBucketPolicyCommand));
    });

    it("throws S3ApplyPolicyException on error", async () => {
      mockS3.send.mockRejectedValueOnce(new Error("fail"));
      const policy = bucketService.generateBucketPolicy("my-bucket");

      await expect(
        bucketService.applyBucketPolicy(policy, "my-bucket")
      ).rejects.toThrow(S3ApplyPolicyException);
    });

    it("applies a bucket policy passed as a string", async () => {
      mockS3.send.mockResolvedValueOnce({});

      const policyString = JSON.stringify(bucketService.generateBucketPolicy("my-bucket"));

      await bucketService.applyBucketPolicy(policyString as unknown as BucketPolicy, "my-bucket");

      expect(mockS3.send).toHaveBeenCalledWith(expect.any(PutBucketPolicyCommand));
    });
  });
});
