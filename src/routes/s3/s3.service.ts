import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  S3ConfigurationException,
  BucketResolutionException,
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
  S3ApplyPolicyException
} from './s3.error';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class S3Service {
  private readonly s3: S3Client;
  private readonly defaultBucket: string | undefined;

  constructor(private readonly configService: ConfigService,) {
    const region = this.configService.get<string>('AWS_REGION');
    if (!region) {
      throw new S3ConfigurationException(['AWS_REGION']);
    }
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    if (!accessKeyId) {
      throw new S3ConfigurationException(['AWS_ACCESS_KEY_ID']);
    }
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    if (!secretAccessKey) {
      throw new S3ConfigurationException(['AWS_SECRET_ACCESS_KEY']);
    }

    const envVars = {
      AWS_REGION: region,
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey,
    };

    const missingKeys = Object.entries(envVars)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingKeys.length > 0) {
      throw new S3ConfigurationException(missingKeys);
    }

    this.s3 = new S3Client({
      region: region,
      credentials: {
        accessKeyId: accessKeyId as string,
        secretAccessKey: secretAccessKey as string,
      },
    });
    this.defaultBucket = this.configService.get<string>('S3_BUCKET_NAME');
  }

  private resolveBucket(bucketName?: string): string {
    const resolved = bucketName || this.defaultBucket;
    if (!resolved) {
      throw new BucketResolutionException('No bucket name provided and no default bucket configured.');
    }
    return resolved;
  }

  async listBuckets(): Promise<Bucket[]> {
    try {
      const input: ListBucketsCommandInput = {};
      const command = new ListBucketsCommand(input);
      const result = await this.s3.send(command);
      return result.Buckets || [];
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new S3ListBucketsException(error.message);
      } else {
        throw new S3ListBucketsException('An unknown error occurred while listing buckets.');
      }
    }
  }

  async listObjects(bucketName?: string): Promise<_Object[] | []> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: ListObjectsV2CommandInput = {
        Bucket: resolvedBucketName,
      };
      const command = new ListObjectsV2Command(input);
      const result = await this.s3.send(command);

      return result.Contents || [];
    } catch (error) {
      throw new S3ListObjectsException(resolvedBucketName, error);
    }
  }

  async getSignedDownloadUrl(key: string, bucketName?: string): Promise<string> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: GetObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key,
      };
      const command = new GetObjectCommand(input);
      return await getSignedUrl(this.s3 as any, command, { expiresIn: 3600 });
    } catch (error) {
      throw new S3SignedUrlException(resolvedBucketName, key, error);
    }
  }

  base64UrlEncode(input: string | Buffer): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  createPolicy(resourceUrl: string, expires: number): string {
    return JSON.stringify({
      Statement: [{
        Resource: resourceUrl,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expires },
        },
      }],
    });
  }

  rsaSha256Sign(privateKey: string, policy: string): Buffer {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(policy);
    signer.end();
    return signer.sign(privateKey);
  }

  createSignedCookies(keyPairId: string, privateKeyPath: string, resourceUrl: string, expiresInSeconds: number) {
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const policy = this.createPolicy(resourceUrl, expires);
    const signature = this.rsaSha256Sign(privateKey, policy);

    return {
      'CloudFront-Policy': this.base64UrlEncode(policy),
      'CloudFront-Signature': this.base64UrlEncode(signature),
      'CloudFront-Key-Pair-Id': keyPairId,
    };
  }

  getSignedCloudfrontUrl(fileKey: string): string {
    const cdnUrl = process.env['CDN_URL']!.replace(/\/$/, '');
    const keyPairId = process.env['CLOUDFRONT_KEY_PAIR_ID']!;
    const privateKeyPath = path.resolve(__dirname, '../../../cloudfront-private-key.pem');
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

    const url = `https://${cdnUrl}/${encodeURIComponent(fileKey)}`;
    const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const policy = this.createPolicy(url, expires);
    const signature = this.rsaSha256Sign(privateKey, policy);

    const signedUrl = `${url}?Policy=${this.base64UrlEncode(policy)}&Signature=${this.base64UrlEncode(signature)}&Key-Pair-Id=${keyPairId}`;

    console.log('Generated signed URL (SHA256):', signedUrl);
    return signedUrl;
  }

  getCDNUrl(key: string): string {
    const cdnUrl = process.env['CDN_URL']?.replace(/\/$/, '');
    return `https://${cdnUrl}/${encodeURIComponent(key)}`;
  }

  async downloadFile(key:string, bucketName?: string): Promise<DownloadedFile> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const headInput: HeadObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key,
      };
      const headCommand = new HeadObjectCommand(headInput);
      const head = await this.s3.send(headCommand);

      const getObjectInput: GetObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key,
      };
      const getObjectCommand = new GetObjectCommand(getObjectInput);
      const response = await this.s3.send(getObjectCommand);
      const stream = response.Body as Readable;

      const contentType = head.ContentType;
      const contentLength = head.ContentLength;

      if (!contentType || !contentLength) {
        throw new Error('Missing required metadata in S3 head response');
      }

      const downloadedFile: DownloadedFile = {
        body: stream,
        contentType: contentType,
        contentLength: contentLength,
      };

      return downloadedFile;
    } catch (error) {
      throw new S3DownloadException(resolvedBucketName, key, error);
    }
  }

  async uploadFile(file: Express.Multer.File, metadata: Record<string, string>, bucketName?: string, keyName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: PutObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: keyName ?? file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: metadata
      };
      const command = new PutObjectCommand(input);

      await this.s3.send(command);
    } catch (error) {
      throw new S3UploadException(resolvedBucketName, file.originalname, error);
    }
  }

  async deleteFile(key: string, bucketName?: string): Promise<void> {
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

  async deleteFiles(keys: string[], bucketName?: string): Promise<_Object[]> {
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

  async deleteBucket(bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: DeleteBucketCommandInput = { Bucket: resolvedBucketName };
      const command = new DeleteBucketCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3DeleteBucketException(resolvedBucketName, error);
    }
  }

  async createBucket(bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: CreateBucketCommandInput = {
        Bucket: resolvedBucketName
      };
      const command = new CreateBucketCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3CreateBucketException(resolvedBucketName, error);
    }
  }

  async getObjectMetadata(key:string, bucketName?: string): Promise<S3ObjectMetadata> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: HeadObjectCommandInput = {
        Bucket: resolvedBucketName,
        Key: key,
      };
      const command = new HeadObjectCommand(input);
      const result = await this.s3.send(command);

      if (!result.ContentType || !result.ContentLength || !result.LastModified || !result.ETag) {
        throw new Error('Missing required metadata in S3 head response');
      }

      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        lastModified: result.LastModified,
        metadata: result.Metadata ?? {},
        eTag: result.ETag,
      };
    } catch (error) {
      throw new S3GetMetadataException(resolvedBucketName, key, error);
    }
  }

  generateBucketPolicy(bucketName?: string, actions: string[] = ['s3:GetObject'], effect = 'Allow', principal = '*', prefix = '*'): BucketPolicy {
    const resolvedBucketName = this.resolveBucket(bucketName);
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
              ? `arn:aws:s3:::${resolvedBucketName}/*`
              : `arn:aws:s3:::${resolvedBucketName}/${prefix}`
        }
      ]
    };
  }

  async applyBucketPolicy(policy: BucketPolicy, bucketName?: string): Promise<void> {
    const resolvedBucketName = this.resolveBucket(bucketName);
    try {
      const input: PutBucketPolicyCommandInput = {
        Bucket: resolvedBucketName,
        Policy: typeof policy === 'string' ? policy : JSON.stringify(policy)
      };

      const command = new PutBucketPolicyCommand(input);
      await this.s3.send(command);
    } catch (error) {
      throw new S3ApplyPolicyException(resolvedBucketName, error);
    }
  }
}
