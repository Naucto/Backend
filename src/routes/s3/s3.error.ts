export class S3ConfigurationException extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`S3 storage is not properly configured. Missing keys: ${missingKeys.join(', ')}`);
    this.name = this.constructor.name;
  }
}

export class BucketResolutionException extends Error {
  constructor(message?: string) {
    super(message || 'Failed to resolve S3 bucket name.');
    this.name = this.constructor.name;
  }
}

export class S3ListObjectsException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error while listing objects in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3UploadException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly fileName: string,
    public readonly cause?: unknown,
  ) {
    super(`Error while uploading file "${fileName}" to bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3DownloadException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Error downloading file "${key}" from bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3ObjectNotFoundException extends S3DownloadException {}

export class S3DeleteFileException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(`Error deleting file "${key}" in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3DeleteFilesException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly keys: string[],
    public readonly cause?: unknown,
  ) {
    super(`Error deleting multiple files in bucket ${bucketName}: ${cause}`);
    this.name = this.constructor.name;
  }
}

export class S3MissingMetadataException extends Error {
  constructor(
    public readonly bucketName: string,
    public readonly key: string,
    public readonly missingFields: string[],
  ) {
    super(
      `Missing required metadata fields [${missingFields.join(', ')}] for file "${key}" in bucket ${bucketName}`,
    );
    this.name = this.constructor.name;
  }
}
