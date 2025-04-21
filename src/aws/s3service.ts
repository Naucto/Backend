// src/aws/s3service.ts

import s3Client from '@aws/s3';
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

export const listBuckets = async (): Promise<Bucket[] | undefined> => {
  const response = await s3Client.send(new ListBucketsCommand({}));
  return response.Buckets;
};

export const listObjects = async (bucketName: string): Promise<_Object[] | undefined> => {
  const response = await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName }));
  return response.Contents;
};

export const generateDownloadUrl = async (bucketName: string, key: string): Promise<string> => {
  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

export const getObject = async (bucketName: string, key: string) => {
  return s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
};

export const uploadObject = async ({ bucketName, fileName, buffer, contentType, metadata }: S3UploadParams) => {
  return s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
    })
  );
};

export const deleteObject = async (bucketName: string, key: string) => {
  return s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
};

export const deleteObjects = async (bucketName: string, keys: string[]) => {
  if (keys.length === 0) return;

  const chunkSize = 1000;
  const chunks = Array.from({ length: Math.ceil(keys.length / chunkSize) }, (_, i) =>
    keys.slice(i * chunkSize, i * chunkSize + chunkSize)
  );

  const results = [];

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
};

export const createBucket = async (bucketName: string) => {
  return s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
};

export const deleteBucket = async (bucketName: string) => {
  return s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
};

export const getMetadata = async (bucketName: string, key: string) => {
  return s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
};

export const generatePolicy = (bucketName: string, { actions = ['s3:GetObject'], effect = 'Allow', principal = '*', prefix = '*' }: S3PolicyParams) => {
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
};

export const getSignedDownloadUrl = generateDownloadUrl;

export const downloadFile = async (bucketName: string, key: string) => {
  const response = await getObject(bucketName, key);
  const body = response.Body as Readable;

  return {
    body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
};

export const uploadFile = async (bucketName: string, file: Express.Multer.File, metadata?: Record<string, string>) => {
  return uploadObject({
    bucketName,
    fileName: file.originalname,
    buffer: file.buffer,
    contentType: file.mimetype,
    metadata,
  });
};

export const deleteFile = async (bucketName: string, key: string) => {
  return deleteObject(bucketName, key);
};

export const deleteFiles = async (bucketName: string, keys: string[]) => {
  return deleteObjects(bucketName, keys);
};

export const getObjectMetadata = async (bucketName: string, key: string) => {
  const metadata = await getMetadata(bucketName, key);
  return metadata.Metadata;
};

export const generateBucketPolicy = (bucketName: string, actions?: string[], effect?: 'Allow' | 'Deny', principal?: string, prefix?: string) => {
  return generatePolicy(bucketName, {
    actions,
    effect,
    principal,
    prefix,
  });
};

export const applyBucketPolicy = async (bucketName: string, policy: object) => {
  const policyString = JSON.stringify(policy);

  return s3Client.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: policyString,
    })
  );
};
