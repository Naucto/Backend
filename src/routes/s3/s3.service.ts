import {
  _Object,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  DeleteObjectsCommand,
  DeleteObjectsCommandInput,
  DeleteObjectsCommandOutput,
  GetObjectCommand,
  GetObjectCommandInput,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  PutObjectAclCommand,
  PutObjectAclCommandInput,
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';

import { getOptionalEnv } from '../../config/env';
import {
  BucketResolutionException,
  S3ConfigurationException,
  S3DeleteFileException,
  S3DeleteFilesException,
  S3DownloadException,
  S3ListObjectsException,
  S3MissingMetadataException,
  S3ObjectNotFoundException,
  S3UploadException,
} from './s3.error';
import { DownloadedFile } from './s3.interface';

/** True for the `NotImplemented` an S3-compatible store returns for a feature it does not have. */
function isNotImplemented(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'NotImplemented'
  );
}

/** S3 names a missing object `NotFound` on a HEAD and `NoSuchKey` on a GET. */
function isNotFound(error: unknown): boolean {
  const s3Error = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    s3Error.name === 'NotFound' ||
    s3Error.name === 'NoSuchKey' ||
    s3Error.$metadata?.httpStatusCode === 404
  );
}

@Injectable()
export class S3Service {
  private readonly s3: S3Client;

  constructor() {
    const endpoint = getOptionalEnv('S3_ENDPOINT');
    const region = getOptionalEnv('S3_REGION');
    const accessKeyId = getOptionalEnv('S3_ACCESS_KEY_ID');
    const secretAccessKey = getOptionalEnv('S3_SECRET_ACCESS_KEY');
    if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
      const missingKeys = Object.entries({
        S3_ENDPOINT: endpoint,
        S3_REGION: region,
        S3_ACCESS_KEY_ID: accessKeyId,
        S3_SECRET_ACCESS_KEY: secretAccessKey,
      })
        .filter(([, value]) => !value)
        .map(([key]) => key);
      throw new S3ConfigurationException(missingKeys);
    }

    this.s3 = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  private resolveBucket(): string {
    const bucket = getOptionalEnv('S3_BUCKET_NAME');
    if (!bucket) {
      throw new BucketResolutionException('No bucket configured.');
    }
    return bucket;
  }

  private async headFile(key: string): Promise<HeadObjectCommandOutput> {
    const command = new HeadObjectCommand({
      Bucket: this.resolveBucket(),
      Key: key,
    });
    return this.s3.send(command);
  }

  async getFileMetadataOrNull(key: string): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.headFile(key);
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    return (await this.getFileMetadataOrNull(key)) !== null;
  }

  async listObjects({ prefix }: { prefix?: string } = {}): Promise<_Object[]> {
    const resolvedBucketName = this.resolveBucket();
    try {
      const input: ListObjectsV2CommandInput = {
        Bucket: resolvedBucketName,
        Prefix: prefix,
      };
      const command = new ListObjectsV2Command(input);
      const result = await this.s3.send(command);

      return result.Contents || [];
    } catch (error) {
      throw new S3ListObjectsException(resolvedBucketName, error);
    }
  }

  async downloadFile({ key }: { key: string }): Promise<DownloadedFile> {
    const resolvedBucketName = this.resolveBucket();
    try {
      const head = await this.headFile(key);

      const getObjectInput: GetObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key,
      };
      const getObjectCommand = new GetObjectCommand(getObjectInput);
      const response = await this.s3.send(getObjectCommand);
      const stream = response.Body as Readable;

      const contentType = head.ContentType;
      const contentLength = head.ContentLength;

      const missingFields = [];
      if (!contentType) {
        missingFields.push('ContentType');
      }
      if (contentLength === undefined) {
        missingFields.push('ContentLength');
      }

      if (missingFields.length > 0) {
        throw new S3MissingMetadataException(resolvedBucketName, key, missingFields);
      }

      const downloadedFile: DownloadedFile = {
        body: stream,
        contentType: contentType!,
        contentLength: contentLength!,
      };

      return downloadedFile;
    } catch (error) {
      if (isNotFound(error)) {
        throw new S3ObjectNotFoundException(resolvedBucketName, key, error);
      }
      throw new S3DownloadException(resolvedBucketName, key, error);
    }
  }

  async uploadFile({
    file,
    metadata,
    keyName,
    cacheControl,
  }: {
    file: Express.Multer.File | DownloadedFile;
    metadata?: Record<string, string>;
    keyName: string;
    cacheControl?: string;
  }): Promise<void> {
    const resolvedBucketName = this.resolveBucket();

    if ('originalname' in file) {
      try {
        const input: PutObjectCommandInput = {
          Bucket: resolvedBucketName,
          Key: keyName,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: metadata,
          CacheControl: cacheControl,
        };
        const command = new PutObjectCommand(input);

        await this.s3.send(command);
      } catch (error) {
        throw new S3UploadException(resolvedBucketName, keyName, error);
      }
    } else {
      try {
        const parallelUpload = new Upload({
          client: this.s3,
          params: {
            Bucket: resolvedBucketName,
            Key: keyName,
            Body: file.body,
            ContentType: file.contentType,
            Metadata: metadata,
            CacheControl: cacheControl,
          },
        });

        await parallelUpload.done();
      } catch (error) {
        throw new S3UploadException(resolvedBucketName, keyName, error);
      }
    }
  }

  async deleteFile({ key }: { key: string }): Promise<void> {
    const resolvedBucketName = this.resolveBucket();
    try {
      const input: DeleteObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key,
      };
      const command = new DeleteObjectCommand(input);

      await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteFileException(resolvedBucketName, key, error);
    }
  }

  async deleteFiles({ keys }: { keys: string[] }): Promise<_Object[]> {
    const resolvedBucketName = this.resolveBucket();
    let result: DeleteObjectsCommandOutput;
    try {
      const input: DeleteObjectsCommandInput = {
        Bucket: resolvedBucketName,
        Delete: {
          Objects: keys.map((key) => ({ Key: key })),
          Quiet: false,
        },
      };
      const command = new DeleteObjectsCommand(input);
      result = await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteFilesException(resolvedBucketName, keys, error);
    }

    const refused = result.Errors ?? [];
    if (refused.length > 0) {
      throw new S3DeleteFilesException(
        resolvedBucketName,
        refused.map((entry) => entry.Key ?? '<unknown>'),
        refused.map((entry) => `${entry.Key}: ${entry.Code}`).join(', '),
      );
    }

    return result.Deleted ?? [];
  }

  /**
   * Makes an object readable without credentials, except on a store without per-object ACLs, where
   * the bucket policy has to grant the read.
   */
  async setObjectPublicRead(key: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket();

    const input: PutObjectAclCommandInput = {
      Bucket: resolvedBucketName,
      Key: key,
      ACL: 'public-read',
    };
    try {
      await this.s3.send(new PutObjectAclCommand(input));
    } catch (error) {
      if (!isNotImplemented(error)) {
        throw error;
      }
    }
  }
}
