import { Readable } from "stream";
import { _Object } from "@aws-sdk/client-s3";

export interface StorageService {
  listObjects(bucketName?: string): Promise<_Object[]>;
  uploadFile(
    file: Express.Multer.File,
    metadata: Record<string, string>,
    bucketName?: string,
    keyName?: string
  ): Promise<void>;
  deleteFile(key: string, bucketName?: string): Promise<void>;
  getSignedDownloadUrl(key: string, bucketName?: string): Promise<string>;
}

export interface DownloadedFile {
  body: Readable;
  contentType?: string;
  contentLength?: number;
}

export interface S3ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  metadata?: Record<string, string>;
  eTag?: string;
}

export type BucketPolicyStatement = {
  Sid: string;
  Effect: string;
  Principal: "*" | { AWS: string } | { SCW: string };
  Action: string[];
  Resource: string;
};

export interface BucketPolicy {
  Version: string;
  Statement: BucketPolicyStatement[];
}
