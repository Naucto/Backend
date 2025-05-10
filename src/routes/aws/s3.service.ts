import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  S3Client,
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
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3: S3Client;

  constructor(private readonly prismaService: PrismaService) {
    this.s3 = new S3Client({});
  }

  async listBuckets() {
    try {
      const result = await this.s3.send(new ListBucketsCommand({}));
      return result.Buckets || [];
    } catch (error) {
      this.logger.error(`Error listing buckets: ${error.message}`, error.stack);
      throw error;
    }
  }

  async listObjects(bucketName: string) {
    try {
      const result = await this.s3.send(new ListObjectsV2Command({ Bucket: bucketName }));
      return result.Contents || [];
    } catch (error) {
      this.logger.error(`Error listing objects in ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getSignedDownloadUrl(bucketName: string, key: string) {
    try {
      const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
      return await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    } catch (error) {
      this.logger.error(`Error generating signed URL: ${error.message}`, error.stack);
      throw error;
    }
  }

  async downloadFile(bucketName: string, key: string) {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      const getObjectCommand = new GetObjectCommand({ Bucket: bucketName, Key: key });
      const response = await this.s3.send(getObjectCommand);
      const stream = response.Body as Readable;

      return {
        body: stream,
        contentType: head.ContentType,
        contentLength: head.ContentLength,
      };
    } catch (error) {
      this.logger.error(`Error downloading ${key}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async uploadFile(bucketName: string, file: Express.Multer.File, metadata: Record<string, string>) {
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: metadata,
      }));

      // await this.prismaService.s3Upload.create({
      //   data: {
      //     bucketName,
      //     key: file.originalname,
      //     contentType: file.mimetype,
      //     size: file.size,
      //     metadata: metadata,
      //   },
      // });

    } catch (error) {
      this.logger.error(`Error uploading file: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteFile(bucketName: string, key: string) {
    try {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }));

      // await this.prismaService.s3Upload.deleteMany({
      //   where: {
      //     bucketName,
      //     key,
      //   },
      // });

    } catch (error) {
      this.logger.error(`Error deleting file: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteFiles(bucketName: string, keys: string[]) {
    try {
      const result = await this.s3.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: false,
        },
      }));

      // await this.prismaService.s3Upload.deleteMany({
      //   where: {
      //     bucketName,
      //     key: {
      //       in: keys,
      //     },
      //   },
      // });

      return result.Deleted;
    } catch (error) {
      this.logger.error(`Error deleting multiple files: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteBucket(bucketName: string) {
    try {
      await this.s3.send(new DeleteBucketCommand({
        Bucket: bucketName,
      }));

      // await this.prismaService.s3Upload.deleteMany({
      //   where: {
      //     bucketName,
      //   },
      // });

    } catch (error) {
      this.logger.error(`Error deleting bucket: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createBucket(bucketName: string) {
    try {
      await this.s3.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch (error) {
      this.logger.error(`Error creating bucket: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getObjectMetadata(bucketName: string, key: string) {
    try {
      const result = await this.s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata,
        eTag: result.ETag,
      };
    } catch (error) {
      this.logger.error(`Error fetching metadata: ${error.message}`, error.stack);
      throw error;
    }
  }

  generateBucketPolicy(
    bucketName: string,
    actions: string[] = ['s3:GetObject'],
    effect = 'Allow',
    principal = '*',
    prefix = '*',
  ) {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'BucketPolicy',
          Effect: effect,
          Principal: principal === '*' ? '*' : { AWS: principal },
          Action: actions,
          Resource: prefix === '*'
            ? `arn:aws:s3:::${bucketName}/*`
            : `arn:aws:s3:::${bucketName}/${prefix}`,
        },
      ],
    };
  }

  async applyBucketPolicy(bucketName: string, policy: any) {
    try {
      await this.s3.send(new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: typeof policy === 'string' ? policy : JSON.stringify(policy),
      }));
    } catch (error) {
      this.logger.error(`Error applying policy: ${error.message}`, error.stack);
      throw error;
    }
  }
}
