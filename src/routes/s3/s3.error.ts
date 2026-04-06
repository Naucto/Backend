export class S3ConfigurationException extends Error {
  constructor(public readonly missingKeys: string[] = []) {
    super(
      `AWS credentials are not properly configured.${missingKeys.length > 0 ? " Missing keys: " + missingKeys.join(", ") : ""}`
    );
    this.name = this.constructor.name;
  }
}

export class BucketResolutionException extends Error {
  constructor(message?: string) {
    super(message || "Failed to resolve S3 bucket name.");
    this.name = this.constructor.name;
  }
}

export class S3ListBucketsException extends Error {
  cause?: unknown;

  constructor(message?: string, options?: { cause?: unknown }) {
    super(message || "Error while listing buckets");
    this.name = this.constructor.name;
    this.cause = options?.cause;
  }
}

export class S3ListObjectsException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown
  ) {
    super(`Error while listing objects in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3UploadException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly fileName: string,
    public readonly cause?: unknown
  ) {
    super(`Error while uploading file "${fileName}" to bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3DownloadException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown
  ) {
    super(`Error downloading file "${key}" from bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3SignedUrlException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown
  ) {
    super(
      `Error generating signed URL for file "${key}" in bucket ${bucketName}: ${cause}`
    );
    this.name = this.constructor.name;
  }
}

export class S3DeleteFileException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown
  ) {
    super(`Error deleting file "${key}" in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3DeleteFilesException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly keys: string[],
    public readonly cause?: unknown
  ) {
    super(`Error deleting multiple files in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3DeleteBucketException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown
  ) {
    super(`Error deleting bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3CreateBucketException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown
  ) {
    super(`Error creating bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3GetMetadataException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown
  ) {
    super(`Error fetching metadata for file "${key}" in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3MissingMetadataException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly missingFields: string[]
  ) {
    super(
      `Missing required metadata fields [${missingFields.join(", ")}] for file "${key}" in bucket ${bucketName}`
    );
    this.name = this.constructor.name;
  }
}

export class S3ApplyPolicyException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown
  ) {
    super(`Error applying policy to bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class CloudFrontPrivateKeyException extends Error {
  constructor(
    public readonly path: string,
    public readonly cause?: unknown
  ) {
    super(`Failed to read CloudFront private key at path "${path}": ${cause}`);
    this.name = this.constructor.name;
  }
}
