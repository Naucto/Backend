import { Injectable } from '@nestjs/common';
import s3Client from './s3';
import {
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  _Object,
  Bucket,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { DeleteObjectsCommandOutput } from '@aws-sdk/client-s3';

export interface S3UploadParams {
  bucketName: string;
  fileName: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface S3PolicyParams {
  actions?: string[];
  effect?: 'Allow' | 'Deny';
  principal?: string | { AWS: string };
  prefix?: string;
}

@Injectable()
export class AwsService {
  async listBuckets(): Promise<Bucket[] | undefined> {
    const response = await s3Client.send(new ListBucketsCommand({}));
    return response.Buckets;
  }

  async listObjects(bucketName: string): Promise<_Object[] | undefined> {
    const response = await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName }));
    return response.Contents;
  }

  async generateDownloadUrl(bucketName: string, key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  }

  async getObject(bucketName: string, key: string) {
    return s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  }

  async uploadObject({ bucketName, fileName, buffer, contentType, metadata }: S3UploadParams) {
    return s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
      })
    );
  }

  async deleteObject(bucketName: string, key: string) {
    return s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  }

  async deleteObjects(bucketName: string, keys: string[]): Promise<DeleteObjectsCommandOutput[]> {
    if (keys.length === 0) return [];
  
    const chunkSize = 1000;
    const chunks = Array.from({ length: Math.ceil(keys.length / chunkSize) }, (_, i) =>
      keys.slice(i * chunkSize, i * chunkSize + chunkSize)
    );
  
    const results: DeleteObjectsCommandOutput[] = [];
  
    for (const chunk of chunks) {
      const objects = chunk.map((key) => ({ Key: key }));
  
      const result = await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: objects,
            Quiet: false,
          },
        })
      );
  
      results.push(result);
    }
  
    return results;
  }

  async createBucket(bucketName: string) {
    return s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }

  async deleteBucket(bucketName: string) {
    return s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
  }

  async getMetadata(bucketName: string, key: string) {
    return s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  }

  generatePolicy(
    bucketName: string,
    { actions = ['s3:GetObject'], effect = 'Allow', principal = '*', prefix = '*' }: S3PolicyParams
  ) {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'CustomPolicy',
          Effect: effect,
          Principal: principal === '*' ? '*' : { AWS: principal },
          Action: actions,
          Resource: `arn:aws:s3:::${bucketName}/${prefix}`,
        },
      ],
    };
  }

  async applyBucketPolicy(bucketName: string, policy: object) {
    return s3Client.send(
      new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: JSON.stringify(policy),
      })
    );
  }

  async downloadFile(bucketName: string, key: string) {
    const response = await this.getObject(bucketName, key);
    const body = response.Body as Readable;

    return {
      body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  async uploadFile(bucketName: string, file: any, metadata?: Record<string, string>) {
    return this.uploadObject({
      bucketName,
      fileName: file.originalname,
      buffer: file.buffer,
      contentType: file.mimetype,
      metadata,
    });
  }

  async deleteFile(bucketName: string, key: string) {
    return this.deleteObject(bucketName, key);
  }

  async deleteFiles(bucketName: string, keys: string[]) {
    return this.deleteObjects(bucketName, keys);
  }

  async getObjectMetadata(bucketName: string, key: string) {
    const metadata = await this.getMetadata(bucketName, key);
    return metadata.Metadata;
  }

  generateBucketPolicy(bucketName: string, actions?: string[], effect?: 'Allow' | 'Deny', principal?: string, prefix?: string) {
    return this.generatePolicy(bucketName, { actions, effect, principal, prefix });
  }
}
