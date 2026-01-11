import {
  S3ConfigurationException,
  BucketResolutionException,
  S3ListBucketsException,
  S3ListObjectsException,
  S3SignedUrlException,
  S3DownloadException,
  S3UploadException,
  S3DeleteFileException,
  S3DeleteFilesException,
  S3GetMetadataException,
  S3MissingMetadataException
} from "./s3.error";

describe("S3 Error Classes", () => {
  describe("S3ConfigurationException", () => {
    it("should create exception with missing keys", () => {
      const error = new S3ConfigurationException(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
      
      expect(error).toBeInstanceOf(S3ConfigurationException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3ConfigurationException");
      expect(error.message).toContain("AWS credentials are not properly configured");
      expect(error.message).toContain("AWS_ACCESS_KEY_ID");
      expect(error.message).toContain("AWS_SECRET_ACCESS_KEY");
      expect(error.missingKeys).toEqual(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
    });

    it("should create exception with no missing keys", () => {
      const error = new S3ConfigurationException();
      
      expect(error).toBeInstanceOf(S3ConfigurationException);
      expect(error.message).toBe("AWS credentials are not properly configured.");
      expect(error.missingKeys).toEqual([]);
    });
  });

  describe("BucketResolutionException", () => {
    it("should create exception with custom message", () => {
      const error = new BucketResolutionException("Custom bucket error");
      
      expect(error).toBeInstanceOf(BucketResolutionException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("BucketResolutionException");
      expect(error.message).toBe("Custom bucket error");
    });

    it("should create exception with default message", () => {
      const error = new BucketResolutionException();
      
      expect(error).toBeInstanceOf(BucketResolutionException);
      expect(error.message).toBe("Failed to resolve S3 bucket name.");
    });
  });

  describe("S3ListBucketsException", () => {
    it("should create exception with custom message", () => {
      const error = new S3ListBucketsException("Custom list error");
      
      expect(error).toBeInstanceOf(S3ListBucketsException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3ListBucketsException");
      expect(error.message).toBe("Custom list error");
    });

    it("should create exception with default message", () => {
      const error = new S3ListBucketsException();
      
      expect(error).toBeInstanceOf(S3ListBucketsException);
      expect(error.message).toBe("Error while listing buckets");
    });

    it("should create exception with cause", () => {
      const cause = new Error("Original error");
      const error = new S3ListBucketsException("List failed", { cause });
      
      expect(error).toBeInstanceOf(S3ListBucketsException);
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3ListObjectsException", () => {
    it("should create exception with bucket and key", () => {
      const cause = new Error("List objects failed");
      const error = new S3ListObjectsException("test-bucket", cause);
      
      expect(error).toBeInstanceOf(S3ListObjectsException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3ListObjectsException");
      expect(error.message).toContain("test-bucket");
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3SignedUrlException", () => {
    it("should create exception with bucket, key, and cause", () => {
      const cause = new Error("Signing failed");
      const error = new S3SignedUrlException("test-bucket", "test-key", cause);
      
      expect(error).toBeInstanceOf(S3SignedUrlException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3SignedUrlException");
      expect(error.message).toContain("test-bucket");
      expect(error.message).toContain("test-key");
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3DownloadException", () => {
    it("should create exception with bucket, key, and cause", () => {
      const cause = new Error("Download failed");
      const error = new S3DownloadException("test-bucket", "test-key", cause);
      
      expect(error).toBeInstanceOf(S3DownloadException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3DownloadException");
      expect(error.message).toContain("test-bucket");
      expect(error.message).toContain("test-key");
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3UploadException", () => {
    it("should create exception with bucket, filename, and cause", () => {
      const cause = new Error("Upload failed");
      const error = new S3UploadException("test-bucket", "test-file.txt", cause);
      
      expect(error).toBeInstanceOf(S3UploadException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3UploadException");
      expect(error.message).toContain("test-bucket");
      expect(error.message).toContain("test-file.txt");
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3DeleteFileException", () => {
    it("should create exception with bucket, key, and cause", () => {
      const cause = new Error("Delete failed");
      const error = new S3DeleteFileException("test-bucket", "test-key", cause);
      
      expect(error).toBeInstanceOf(S3DeleteFileException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3DeleteFileException");
      expect(error.message).toContain("test-bucket");
      expect(error.message).toContain("test-key");
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3DeleteFilesException", () => {
    it("should create exception with bucket, keys, and cause", () => {
      const cause = new Error("Delete multiple failed");
      const error = new S3DeleteFilesException("test-bucket", ["key1", "key2"], cause);
      
      expect(error).toBeInstanceOf(S3DeleteFilesException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3DeleteFilesException");
      expect(error.message).toContain("test-bucket");
      expect(error.keys).toEqual(["key1", "key2"]);
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3GetMetadataException", () => {
    it("should create exception with bucket, key, and cause", () => {
      const cause = new Error("Metadata failed");
      const error = new S3GetMetadataException("test-bucket", "test-key", cause);
      
      expect(error).toBeInstanceOf(S3GetMetadataException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3GetMetadataException");
      expect(error.message).toContain("test-bucket");
      expect(error.message).toContain("test-key");
      expect(error.cause).toBe(cause);
    });
  });

  describe("S3MissingMetadataException", () => {
    it("should create exception with bucket, key, and missing fields", () => {
      const error = new S3MissingMetadataException("test-bucket", "test-key", ["ContentType", "ContentLength"]);
      
      expect(error).toBeInstanceOf(S3MissingMetadataException);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("S3MissingMetadataException");
      expect(error.message).toContain("test-bucket");
      expect(error.message).toContain("test-key");
      expect(error.message).toContain("ContentType");
      expect(error.message).toContain("ContentLength");
      expect(error.missingFields).toEqual(["ContentType", "ContentLength"]);
    });

    it("should create exception with single missing field", () => {
      const error = new S3MissingMetadataException("test-bucket", "test-key", ["ETag"]);
      
      expect(error).toBeInstanceOf(S3MissingMetadataException);
      expect(error.missingFields).toEqual(["ETag"]);
    });
  });
});