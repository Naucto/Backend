import { NodeHttpHandler } from "@smithy/node-http-handler";
import { positiveNumber } from "./s3-numbers";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  GetObjectCommand,
  GetObjectCommandInput,
  PutObjectCommand,
  PutObjectCommandInput,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  DeleteObjectsCommand,
  DeleteObjectsCommandInput,
  HeadObjectCommand,
  HeadObjectCommandInput,
  PutObjectAclCommand,
  PutObjectAclCommandInput,
  _Object,
  HeadObjectCommandOutput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { DownloadedFile, S3ObjectMetadata } from "./s3.interface";
import {
  S3ConfigurationException,
  BucketResolutionException,
  S3ListObjectsException,
  S3SignedUrlException,
  S3DownloadException,
  S3UploadException,
  S3DeleteFileException,
  S3DeleteFilesException,
  S3GetMetadataException,
  S3MissingMetadataException
} from "./s3.error";
import { Upload } from "@aws-sdk/lib-storage";

@Injectable()
export class S3Service {
  private readonly s3: S3Client;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {
    const errors = [];
    const endpoint = this.configService.get<string>("S3_ENDPOINT");
    if (!endpoint) {
      errors.push("S3_ENDPOINT");
    }
    const region = this.configService.get<string>("S3_REGION");
    if (!region) {
      errors.push("S3_REGION");
    }
    const accessKeyId = this.configService.get<string>("S3_ACCESS_KEY_ID");
    if (!accessKeyId) {
      errors.push("S3_ACCESS_KEY_ID");
    }
    const secretAccessKey = this.configService.get<string>(
      "S3_SECRET_ACCESS_KEY"
    );
    if (!secretAccessKey) {
      errors.push("S3_SECRET_ACCESS_KEY");
    }

    if (errors.length > 0) {
      throw new S3ConfigurationException(errors);
    }

    const envVars = {
      AWS_REGION: region,
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey
    };

    const missingKeys = Object.entries(envVars)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missingKeys.length > 0) {
      throw new S3ConfigurationException(missingKeys);
    }

    this.s3 = new S3Client({
      region: region!,
      endpoint: endpoint!,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!
      },
      forcePathStyle: true,
      // A hung request has to end. Saves are serialised per project, so one call that never returns
      // holds that project's lock and every later save queues behind it forever; the editor has no
      // idea, and keeps asking.
      requestHandler: s3RequestHandler(configService)
    });
  }

  private resolveBucket(bucketName?: string): string {
    const defaultBucket = this.configService.get<string>("S3_BUCKET_NAME");
    const resolved = bucketName || defaultBucket;
    if (!resolved)
      throw new BucketResolutionException(
        "No bucket provided and no default bucket configured."
      );
    return resolved;
  }

  async headFile(
    key: string,
    bucketName?: string
  ): Promise<HeadObjectCommandOutput> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    const command = new HeadObjectCommand({
      Bucket: resolvedBucketName,
      Key: key
    });
    return this.s3.send(command);
  }

  async fileExists(key: string, bucketName?: string): Promise<boolean> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const command = new HeadObjectCommand({
        Bucket: resolvedBucketName,
        Key: key
      });
      await this.s3.send(command);
      return true;
    } catch (error: unknown) {
      const s3Error = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        s3Error.name === "NotFound" ||
        s3Error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw error;
    }
  }

  async listObjects({
    bucketName,
    prefix,
    delimiter
  }: {
    bucketName?: string;
    prefix?: string;
    delimiter?: string;
  } = {}): Promise<_Object[]> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: ListObjectsV2CommandInput = {
        Bucket: resolvedBucketName,
        Prefix: prefix,
        Delimiter: delimiter
      };
      const command = new ListObjectsV2Command(input);
      const result = await this.s3.send(command);

      return result.Contents || [];
    } catch (error) {
      throw new S3ListObjectsException(resolvedBucketName, error);
    }
  }

  async getSignedDownloadUrl(
    key: string,
    bucketName?: string
  ): Promise<string> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: GetObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key
      };
      const command = new GetObjectCommand(input);
      return await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    } catch (error) {
      throw new S3SignedUrlException(resolvedBucketName, key, error);
    }
  }

  async downloadFile({
    key,
    bucketName
  }: {
    key: string;
    bucketName?: string;
  }): Promise<DownloadedFile> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const headInput: HeadObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key
      };
      const headCommand = new HeadObjectCommand(headInput);
      const head = await this.s3.send(headCommand);

      const getObjectInput: GetObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key
      };
      const getObjectCommand = new GetObjectCommand(getObjectInput);
      const response = await this.s3.send(getObjectCommand);
      const stream = response.Body as Readable;

      const contentType = head.ContentType;
      const contentLength = head.ContentLength;

      const missingFields = [];
      // Undefined, not falsy: a zero-length object is a real thing to have stored, and treating 0
      // as missing made every save against it fail, for as long as the slot stayed open.
      if (contentType === undefined) missingFields.push("ContentType");
      if (contentLength === undefined) missingFields.push("ContentLength");

      if (missingFields.length > 0) {
        throw new S3MissingMetadataException(
          resolvedBucketName,
          key,
          missingFields
        );
      }

      const downloadedFile: DownloadedFile = {
        body: stream,
        contentType: contentType!,
        contentLength: contentLength!
      };

      return downloadedFile;
    } catch (error) {
      throw new S3DownloadException(resolvedBucketName, key, error);
    }
  }

  async getFileMetadataOrNull(
    key: string,
    bucketName?: string
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.headFile(key, bucketName);
    } catch (error: unknown) {
      const s3Error = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        s3Error.name === "NotFound" ||
        s3Error.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async uploadFile({
    file,
    metadata,
    bucketName,
    keyName,
    cacheControl,
    ifMatch
  }: {
    file: Express.Multer.File | DownloadedFile;
    metadata?: Record<string, string>;
    bucketName?: string;
    keyName?: string;
    cacheControl?: string;
    /**
     * The ETag the caller read before deciding what to write, as an upload precondition.
     *
     * Without it a read-merge-write is only safe against other writers in the same process, which is
     * a much smaller claim than it sounds: two Backend instances, or a save racing a colleague's save
     * that took a different path, both read the same stored state, both merge only their own view
     * into it, and the write that lands second drops the other's work. The object store can refuse
     * that write, because it still holds the ETag that was read — so the loss becomes a conflict the
     * caller retries rather than a document that quietly lost a change.
     */
    ifMatch?: string;
  }): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);

    if ("originalname" in file) {
      file = <Express.Multer.File>file;
      try {
        if (!keyName) keyName = file.originalname;

        const input: PutObjectCommandInput = {
          Bucket: resolvedBucketName,
          Key: keyName ?? file.originalname,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: metadata,
          CacheControl: cacheControl,
          IfMatch: ifMatch
        };
        const command = new PutObjectCommand(input);

        await this.s3.send(command);
      } catch (error) {
        throw new S3UploadException(
          resolvedBucketName,
          file.originalname,
          error
        );
      }
    } else {
      try {
        file = <DownloadedFile>file;

        const parallelUpload = new Upload({
          client: this.s3,
          params: {
            Bucket: resolvedBucketName,
            Key: keyName,
            Body: file.body,
            ContentType: file.contentType,
            Metadata: metadata,
            CacheControl: cacheControl
          }
        });

        await parallelUpload.done();
      } catch (error) {
        throw new S3UploadException(
          resolvedBucketName,
          keyName ?? "<undefined>",
          error
        );
      }
    }
  }

  async deleteFile({
    key,
    bucketName
  }: {
    key: string;
    bucketName?: string;
  }): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: DeleteObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key
      };
      const command = new DeleteObjectCommand(input);

      await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteFileException(resolvedBucketName, key, error);
    }
  }

  async deleteFiles({
    keys,
    bucketName
  }: {
    keys: string[];
    bucketName?: string;
  }): Promise<_Object[]> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: DeleteObjectsCommandInput = {
        Bucket: resolvedBucketName,
        Delete: {
          Objects: keys.map((key) => ({ Key: key })),
          Quiet: false
        }
      };
      const command = new DeleteObjectsCommand(input);
      const result = await this.s3.send(command);

      return result.Deleted ?? [];
    } catch (error) {
      throw new S3DeleteFilesException(resolvedBucketName, keys, error);
    }
  }

  async getObjectMetadata({
    key,
    bucketName
  }: {
    key: string;
    bucketName?: string;
  }): Promise<S3ObjectMetadata> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: HeadObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key
      };
      const command = new HeadObjectCommand(input);
      const result = await this.s3.send(command);

      if (
        !result.ContentType ||
        !result.ContentLength ||
        !result.LastModified ||
        !result.ETag
      ) {
        const missingFields = [];
        if (!result.ContentType) missingFields.push("ContentType");
        if (!result.ContentLength) missingFields.push("ContentLength");
        if (!result.LastModified) missingFields.push("LastModified");
        if (!result.ETag) missingFields.push("ETag");

        throw new S3MissingMetadataException(
          resolvedBucketName,
          key,
          missingFields
        );
      }

      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata ?? {},
        eTag: result.ETag
      };
    } catch (error) {
      throw new S3GetMetadataException(resolvedBucketName, key, error);
    }
  }

  /**
   * Marks a release object readable without credentials, because the browser fetches it straight
   * from the edge endpoint.
   *
   * Per-object ACLs are an S3 feature, not an S3-API feature: MinIO — what the dev stack runs —
   * answers `NotImplemented`, and there the bucket policy grants the same read (see the
   * `minio-init` service in `docker-compose.dev.yml`). Swallowing exactly that one code keeps
   * publish working against both, while any real failure still surfaces.
   */
  async setObjectPublicRead(key: string, bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);

    const input: PutObjectAclCommandInput = {
      Bucket: resolvedBucketName,
      Key: key,
      ACL: "public-read"
    };
    try {
      await this.s3.send(new PutObjectAclCommand(input));
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
    }
  }
}

/** True for the `NotImplemented` an S3-compatible store returns for a feature it does not have. */
function isNotImplemented(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "NotImplemented"
  );
}

/**
 * An HTTP handler with deadlines on both connecting and answering, so a request to the object store
 * that never completes fails instead of waiting. Configuring it here rather than at each call site
 * is the point: every operation on the store goes through the client, so this covers the listing,
 * the existence check, the upload and the deletes, not just the body read that has its own deadline.
 */
function s3RequestHandler(configService: ConfigService): NodeHttpHandler {
  const connectionTimeout = positiveNumber(configService.get<string>("S3_CONNECTION_TIMEOUT_MS"), 5000);
  const requestTimeout = positiveNumber(configService.get<string>("S3_REQUEST_TIMEOUT_MS"), 30000);
  // throwOnRequestTimeout, because without it `requestTimeout` only logs. A deadline that warns is
  // not a deadline: the request stays pending, so a stalled store still held the project's save lock
  // and every later save queued behind it. Verified against a server that accepts and never answers.
  return new NodeHttpHandler({ connectionTimeout, requestTimeout, throwOnRequestTimeout: true });
}
