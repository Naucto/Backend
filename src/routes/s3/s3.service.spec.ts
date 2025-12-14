import { S3Service } from "./s3.service";
import { BucketResolutionException, S3ListObjectsException } from "./s3.error";
import { ConfigService } from "@nestjs/config";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  ListObjectsV2Command: jest.fn(),
}));

describe("S3Service", () => {
  let s3Service: S3Service;
  let mockConfig: Pick<ConfigService, "get">;
  let mockS3: S3Client & { send: jest.Mock };

  beforeEach(() => {
    mockConfig = {
      get: (key: string) =>
        key === "S3_BUCKET_NAME" ? "my-default-bucket" : "us-east-1",
    };
    mockS3 = { send: jest.fn() } as unknown as S3Client & { send: jest.Mock };
    s3Service = new S3Service(mockS3, mockConfig as ConfigService);
  });

  describe("resolveBucket", () => {
    it("returns provided bucket", () => {
      expect(s3Service["resolveBucket"]("custom")).toBe("custom");
    });

    it("returns default bucket", () => {
      expect(s3Service["resolveBucket"]()).toBe("my-default-bucket");
    });

    it("throws when no bucket", () => {
      const emptyConfig: Pick<ConfigService, "get"> = { get: () => undefined };
      const service = new S3Service(mockS3, emptyConfig as ConfigService);
      expect(() => service["resolveBucket"]()).toThrow(BucketResolutionException);
    });
  });

  describe("listObjects", () => {
    it("returns objects", async () => {
      mockS3.send.mockResolvedValueOnce({ Contents: [{ Key: "file.txt" }] });
      const result = await s3Service.listObjects();
      expect(result).toEqual([{ Key: "file.txt" }]);
      expect(ListObjectsV2Command).toHaveBeenCalledWith({ Bucket: "my-default-bucket" });
    });

    it("returns empty array when no contents", async () => {
      mockS3.send.mockResolvedValueOnce({});
      const result = await s3Service.listObjects();
      expect(result).toEqual([]);
    });

    it("throws S3ListObjectsException on error", async () => {
      const err = new Error("Access Denied");
      mockS3.send.mockRejectedValueOnce(err);
      await expect(s3Service.listObjects("bucket")).rejects.toThrow(S3ListObjectsException);
    });
  });
});
