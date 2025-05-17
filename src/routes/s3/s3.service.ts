import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  S3Client,
  ListBucketsCommand,
  ListBucketsCommandInput,
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
  CreateBucketCommand,
  CreateBucketCommandInput,
  DeleteBucketCommand,
  DeleteBucketCommandInput,
  HeadObjectCommand,
  HeadObjectCommandInput,
  PutBucketPolicyCommand,
  PutBucketPolicyCommandInput,
  Bucket,
  _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { DownloadedFile, S3ObjectMetadata, BucketPolicy } from './s3.interface';
import {
  S3ListBucketsException,
  S3ListObjectsException,
  S3SignedUrlException,
  S3DownloadException,
  S3UploadException,
  S3DeleteFileException,
  S3DeleteFilesException,
  S3DeleteBucketException,
  S3CreateBucketException,
  S3GetMetadataException,
  S3ApplyPolicyException,
} from './s3.error';

@Injectable()
export class S3Service {
  private readonly s3: S3Client;

  constructor(private readonly prismaService: PrismaService) {
    this.s3 = new S3Client({});
  }

  async listBuckets(): Promise<Bucket[]> {
    try {
      const input: ListBucketsCommandInput = {};
      const command = new ListBucketsCommand(input);
      const result = await this.s3.send(command);
      return result.Buckets || [];
    } catch (error) {
      throw new S3ListBucketsException(error.message);
    }
  }

  async listObjects(bucketName: string): Promise<_Object[] | []> {
    try {
      const input: ListObjectsV2CommandInput = {
        Bucket: bucketName,
      };
      const command = new ListObjectsV2Command(input);
      const result = await this.s3.send(command);

      return result.Contents || [];
    } catch (error) {
      throw new S3ListObjectsException(bucketName, error);
    }
  }

  async getSignedDownloadUrl(bucketName: string, key: string): Promise<string> {
    try {
      const input: GetObjectCommandInput = {
        Bucket: bucketName,
        Key: key,
      };
      const command = new GetObjectCommand(input);
      return await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    } catch (error) {
      throw new S3SignedUrlException(bucketName, key, error);
    }
  }

  async downloadFile(bucketName: string, key: string): Promise<DownloadedFile> {
    try {
      const headInput: HeadObjectCommandInput = {
        Bucket: bucketName,
        Key: key,
      };
      const headCommand = new HeadObjectCommand(headInput);
      const head = await this.s3.send(headCommand);

      const getObjectInput: GetObjectCommandInput = {
        Bucket: bucketName,
        Key: key,
      };
      const getObjectCommand = new GetObjectCommand(getObjectInput);
      const response = await this.s3.send(getObjectCommand);
      const stream = response.Body as Readable;

      const downloadedFile: DownloadedFile = {
        body: stream,
        contentType: head.ContentType,
        contentLength: head.ContentLength,
      };

      return downloadedFile;
    } catch (error) {
      throw new S3DownloadException(bucketName, key, error);
    }
  }

  async uploadFile(bucketName: string, file: Express.Multer.File, metadata: Record<string, string>): Promise<void> {
    try {
      const input: PutObjectCommandInput = {
        Bucket: bucketName,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: metadata
      };
      const command = new PutObjectCommand(input);

      await this.s3.send(command);
    } catch (error) {
      throw new S3UploadException(bucketName, file.originalname, error);
    }
  }

  async deleteFile(bucketName: string, key: string): Promise<void> {
    try {
      const input: DeleteObjectCommandInput = {
        Bucket: bucketName,
        Key: key
      };
      const command = new DeleteObjectCommand(input);

      await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteFileException(bucketName, key, error);
    }
  }

  async deleteFiles(bucketName: string, keys: string[]): Promise<_Object[]> {
    try {
      const input: DeleteObjectsCommandInput = {
        Bucket: bucketName,
        Delete: {
          Objects: keys.map((key) => ({ Key: key })),
          Quiet: false
        }
      };
      const command = new DeleteObjectsCommand(input);
      const result = await this.s3.send(command);

      return result.Deleted ?? [];
    } catch (error) {
      throw new S3DeleteFilesException(bucketName, keys, error);
    }
  }

  async deleteBucket(bucketName: string): Promise<void> {
    try {
      const input: DeleteBucketCommandInput = { Bucket: bucketName };
      const command = new DeleteBucketCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteBucketException(bucketName, error);
    }
  }

  async createBucket(bucketName: string): Promise<void> {
    try {
      const input: CreateBucketCommandInput = {
        Bucket: bucketName
      };
      const command = new CreateBucketCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3CreateBucketException(bucketName, error);
    }
  }

  async getObjectMetadata(bucketName: string, key: string): Promise<S3ObjectMetadata> {
    try {

      const input: HeadObjectCommandInput = {
        Bucket: bucketName,
        Key: key,
      };
      const command = new HeadObjectCommand(input);
      const result = await this.s3.send(command);
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata,
        eTag: result.ETag,
      };
    } catch (error) {
      throw new S3GetMetadataException(bucketName, key, error);
    }
  }

  generateBucketPolicy(bucketName: string, actions: string[] = ['s3:GetObject'], effect = 'Allow', principal = '*', prefix = '*'): BucketPolicy {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'BucketPolicy',
          Effect: effect,
          Principal: principal === '*' ? '*' : { AWS: principal },
          Action: actions,
          Resource:
            prefix === '*'
              ? `arn:aws:s3:::${bucketName}/*`
              : `arn:aws:s3:::${bucketName}/${prefix}`
        }
      ]
    };
  }

  async applyBucketPolicy(bucketName: string, policy: any): Promise<void> {
    try {
      const input: PutBucketPolicyCommandInput = {
        Bucket: bucketName,
        Policy: typeof policy === 'string' ? policy : JSON.stringify(policy)
      };

      const command = new PutBucketPolicyCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3ApplyPolicyException(bucketName, error);
    }
  }
}
