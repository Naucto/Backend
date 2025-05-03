import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Readable } from 'stream';
import * as AWS from 'aws-sdk';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3: AWS.S3;

  constructor(private readonly prismaService: PrismaService) {
    // Initialize S3 client - AWS SDK credentials should be configured via environment variables
    this.s3 = new AWS.S3();
  }

  async listBuckets() {
    try {
      const data = await this.s3.listBuckets().promise();
      return data.Buckets || [];
    } catch (error) {
      this.logger.error(`Error listing buckets: ${error.message}`, error.stack);
      throw error;
    }
  }

  async listObjects(bucketName: string) {
    try {
      const data = await this.s3.listObjectsV2({ Bucket: bucketName }).promise();
      return data.Contents || [];
    } catch (error) {
      this.logger.error(`Error listing objects in bucket ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getSignedDownloadUrl(bucketName: string, key: string) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
        Expires: 3600, // URL expires in 1 hour
      };
      
      return this.s3.getSignedUrlPromise('getObject', params);
    } catch (error) {
      this.logger.error(`Error generating signed URL for ${key} in ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async downloadFile(bucketName: string, key: string) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
      };
      
      const { ContentType, ContentLength } = await this.s3.headObject(params).promise();
      const stream = this.s3.getObject(params).createReadStream();
      
      return {
        body: stream,
        contentType: ContentType,
        contentLength: ContentLength,
      };
    } catch (error) {
      this.logger.error(`Error downloading file ${key} from ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async uploadFile(bucketName: string, file: Express.Multer.File, metadata: Record<string, string>) {
    try {
      const params = {
        Bucket: bucketName,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: metadata,
      };
      
      await this.s3.upload(params).promise();
      
      // Optionally, log the upload in database using Prisma
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
      this.logger.error(`Error uploading file to ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteFile(bucketName: string, key: string) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
      };
      
      await this.s3.deleteObject(params).promise();
      
      // Optionally, update database record using Prisma
      // await this.prismaService.s3Upload.deleteMany({
      //   where: {
      //     bucketName,
      //     key,
      //   },
      // });
      
    } catch (error) {
      this.logger.error(`Error deleting file ${key} from ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteFiles(bucketName: string, keys: string[]) {
    try {
      const params = {
        Bucket: bucketName,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: false,
        },
      };
      
      const result = await this.s3.deleteObjects(params).promise();
      
      // Optionally, update database records using Prisma
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
      this.logger.error(`Error deleting multiple files from ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteBucket(bucketName: string) {
    try {
      const params = {
        Bucket: bucketName,
      };
      
      await this.s3.deleteBucket(params).promise();
      
      // Optionally, update database records using Prisma
      // await this.prismaService.s3Upload.deleteMany({
      //   where: {
      //     bucketName,
      //   },
      // });
      
    } catch (error) {
      this.logger.error(`Error deleting bucket ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createBucket(bucketName: string) {
    try {
      const params = {
        Bucket: bucketName,
      };
      
      await this.s3.createBucket(params).promise();
    } catch (error) {
      this.logger.error(`Error creating bucket ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getObjectMetadata(bucketName: string, key: string) {
    try {
      const params = {
        Bucket: bucketName,
        Key: key,
      };
      
      const result = await this.s3.headObject(params).promise();
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata,
        eTag: result.ETag,
      };
    } catch (error) {
      this.logger.error(`Error getting metadata for ${key} in ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }

  generateBucketPolicy(
    bucketName: string,
    actions: string[] = ['s3:GetObject'],
    effect: string = 'Allow',
    principal: string = '*',
    prefix: string = '*',
  ) {
    const policy = {
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
    
    return policy;
  }

  async applyBucketPolicy(bucketName: string, policy: any) {
    try {
      const params = {
        Bucket: bucketName,
        Policy: typeof policy === 'string' ? policy : JSON.stringify(policy),
      };
      
      await this.s3.putBucketPolicy(params).promise();
    } catch (error) {
      this.logger.error(`Error applying policy to bucket ${bucketName}: ${error.message}`, error.stack);
      throw error;
    }
  }
}