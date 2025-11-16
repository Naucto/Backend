import { Injectable } from "@nestjs/common";
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
    HeadObjectCommandOutput,
    _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { DownloadedFile, S3ObjectMetadata, StorageService } from "./s3.interface";
import {
    S3ListObjectsException,
    S3SignedUrlException,
    S3DownloadException,
    S3UploadException,
    S3DeleteFileException,
    S3DeleteFilesException,
    S3GetMetadataException,
    S3MissingMetadataException,
    BucketResolutionException,
} from "./s3.error";

@Injectable()
export class S3Service implements StorageService {
    constructor(private readonly s3: S3Client, private readonly configService: ConfigService) {}

    private resolveBucket(bucketName?: string): string {
        const defaultBucket = this.configService.get<string>("S3_BUCKET_NAME");
        const resolved = bucketName || defaultBucket;
        if (!resolved) throw new BucketResolutionException("No bucket provided and no default bucket configured.");
        return resolved;
    }

    async headFile(key: string, bucketName?: string): Promise<HeadObjectCommandOutput> {
        const resolvedBucketName = this.resolveBucket(bucketName);
        const command = new HeadObjectCommand({ Bucket: resolvedBucketName, Key: key });
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
        } catch (error: any) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    }

    async listObjects(bucketName?: string): Promise<_Object[]> {
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
            return await getSignedUrl(this.s3, command, { expiresIn: 3600 });
        } catch (error) {
            throw new S3SignedUrlException(resolvedBucketName, key, error);
        }
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

            const missingFields = [];
            if (!contentType) missingFields.push("ContentType");
            if (!contentLength) missingFields.push("ContentLength");

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
                const missingFields = [];
                if (!result.ContentType) missingFields.push("ContentType");
                if (!result.ContentLength) missingFields.push("ContentLength");
                if (!result.LastModified) missingFields.push("LastModified");
                if (!result.ETag) missingFields.push("ETag");

                throw new S3MissingMetadataException(resolvedBucketName, key, missingFields);
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
}
