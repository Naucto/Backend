import { Readable } from "stream";

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
  Principal: "*" | { AWS: string };
  Action: string[];
  Resource: string;
};

export interface BucketPolicy {
  Version: string;
  Statement: BucketPolicyStatement[];
}
