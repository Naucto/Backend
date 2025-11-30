export class S3ConfigurationException extends Error {
  constructor(public readonly missingKeys: string[] = []) {
    super(`AWS credentials are not properly configured.${missingKeys.length > 0 ? " Missing keys: " + missingKeys.join(", ") : ""}`);
    this.name = "S3ConfigurationException";
  }
}

export class BucketResolutionException extends Error {
  constructor(message?: string) {
    super(message || "Failed to resolve S3 bucket name.");
    this.name = "BucketResolutionException";
  }
}

export class S3ListBucketsException extends Error {
  cause?: unknown;

  constructor(message?: string, options?: { cause?: unknown }) {
    super(message || "Error while listing buckets");
    this.name = "S3ListBucketsException";
    this.cause = options?.cause;
  }
}

export class S3ListObjectsException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error while listing objects in bucket: ${bucketName}`);
    this.name = "S3ListObjectsException";
  }
}

export class S3UploadException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly fileName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error while uploading file "${fileName}" to bucket: ${bucketName}`);
    this.name = "S3UploadException";
  }
}

export class S3DownloadException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Error downloading file "${key}" from bucket: ${bucketName}`);
    this.name = "S3DownloadException";
  }
}

export class S3SignedUrlException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Error generating signed URL for file "${key}" in bucket: ${bucketName}`);
    this.name = "S3SignedUrlException";
  }
}

export class S3DeleteFileException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Error deleting file "${key}" in bucket: ${bucketName}`);
    this.name = "S3DeleteFileException";
  }
}

export class S3DeleteFilesException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly keys: string[],
    public readonly cause?: unknown,
  ) {
    super(`Error deleting multiple files in bucket: ${bucketName}`);
    this.name = "S3DeleteFilesException";
  }
}

export class S3DeleteBucketException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error deleting bucket: ${bucketName}`);
    this.name = "S3DeleteBucketException";
  }
}

export class S3CreateBucketException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error creating bucket: ${bucketName}`);
    this.name = "S3CreateBucketException";
  }
}

export class S3GetMetadataException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Error fetching metadata for file "${key}" in bucket: ${bucketName}`);
    this.name = "S3GetMetadataException";
  }
}

export class S3MissingMetadataException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly missingFields: string[],
  ) {
    super(
      `Missing required metadata fields [${missingFields.join(", ")}] for file "${key}" in bucket: ${bucketName}`,
    );
    this.name = "S3MissingMetadataException";
  }
}

export class S3ApplyPolicyException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error applying policy to bucket: ${bucketName}`);
    this.name = "S3ApplyPolicyException";
  }
}

export class CloudFrontPrivateKeyException extends Error {
  constructor(
    public readonly path: string,
    public readonly cause?: unknown,
  ) {
    super(`Failed to read CloudFront private key at path: "${path}"`);
    this.name = "CloudFrontPrivateKeyException";
  }
}
