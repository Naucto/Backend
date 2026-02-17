import { S3Service } from "./s3.service";
import {
    BucketResolutionException,
    S3ListObjectsException,
    S3SignedUrlException,
    S3DownloadException,
    S3UploadException,
    S3DeleteFileException,
    S3DeleteFilesException,
    S3GetMetadataException,
    S3MissingMetadataException
} from "./s3.error";
import { ConfigService } from "@nestjs/config";
import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    HeadObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

jest.mock("@aws-sdk/client-s3", () => ({
    S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
    ListObjectsV2Command: jest.fn(),
    GetObjectCommand: jest.fn(),
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    HeadObjectCommand: jest.fn(),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: jest.fn(),
}));

describe("S3Service", () => {
    let s3Service: S3Service;
    let mockConfig: Pick<ConfigService, "get">;
    let mockS3: S3Client & { send: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfig = {
            get: (key: string) =>
                key === "S3_BUCKET_NAME" ? "my-default-bucket" : "us-east-1",
        };
        mockS3 = { send: jest.fn() } as unknown as S3Client & { send: jest.Mock };
        s3Service = new S3Service(mockS3, mockConfig as ConfigService);
    });

    describe("resolveBucket", () => {
        it("returns provided bucket", () => {
            expect(s3Service["resolveBucket"]("custom")).toBe("custom");
        });

        it("returns default bucket", () => {
            expect(s3Service["resolveBucket"]()).toBe("my-default-bucket");
        });

        it("throws when no bucket", () => {
            const emptyConfig: Pick<ConfigService, "get"> = { get: () => undefined };
            const service = new S3Service(mockS3, emptyConfig as ConfigService);
            expect(() => service["resolveBucket"]()).toThrow(BucketResolutionException);
        });
    });

    describe("headFile", () => {
        it("should call S3 headObject with correct parameters", async () => {
            const mockResult = { ContentType: "text/plain" };
            mockS3.send.mockResolvedValue(mockResult);

            const result = await s3Service.headFile("test-key", "custom-bucket");

            expect(HeadObjectCommand).toHaveBeenCalledWith({
                Bucket: "custom-bucket",
                Key: "test-key"
            });
            expect(result).toBe(mockResult);
        });

        it("should use default bucket when not provided", async () => {
            const mockResult = { ContentType: "text/plain" };
            mockS3.send.mockResolvedValue(mockResult);

            await s3Service.headFile("test-key");

            expect(HeadObjectCommand).toHaveBeenCalledWith({
                Bucket: "my-default-bucket",
                Key: "test-key"
            });
        });
    });

    describe("fileExists", () => {
        it("should return true when file exists", async () => {
            mockS3.send.mockResolvedValue({});
            const result = await s3Service.fileExists("existing-key");
            expect(result).toBe(true);
        });

        it("should return false when file does not exist", async () => {
            const notFoundError = {
                name: "NotFound",
                $metadata: { httpStatusCode: 404 }
            };
            mockS3.send.mockRejectedValue(notFoundError);
            const result = await s3Service.fileExists("non-existing-key");
            expect(result).toBe(false);
        });

        it("should throw error when other than NotFound", async () => {
            const otherError = new Error("Some other error");
            mockS3.send.mockRejectedValue(otherError);
            await expect(s3Service.fileExists("error-key")).rejects.toThrow(otherError);
        });
    });

    describe("listObjects", () => {
        it("returns objects", async () => {
            mockS3.send.mockResolvedValueOnce({ Contents: [{ Key: "file.txt" }] });
            const result = await s3Service.listObjects();
            expect(result).toEqual([{ Key: "file.txt" }]);
            expect(ListObjectsV2Command).toHaveBeenCalledWith({ Bucket: "my-default-bucket" });
        });

        it("returns empty array when no contents", async () => {
            mockS3.send.mockResolvedValueOnce({});
            const result = await s3Service.listObjects();
            expect(result).toEqual([]);
        });

        it("throws S3ListObjectsException on error", async () => {
            const err = new Error("Access Denied");
            mockS3.send.mockRejectedValueOnce(err);
            await expect(s3Service.listObjects("bucket")).rejects.toThrow(S3ListObjectsException);
        });
    });

    describe("getSignedDownloadUrl", () => {
        it("should return signed URL", async () => {
            (getSignedUrl as jest.Mock).mockResolvedValue("https://signed-url.com");

            const result = await s3Service.getSignedDownloadUrl("test-key", "custom-bucket");

            expect(GetObjectCommand).toHaveBeenCalledWith({
                Bucket: "custom-bucket",
                Key: "test-key"
            });
            expect(getSignedUrl).toHaveBeenCalledWith(mockS3, expect.any(GetObjectCommand), { expiresIn: 3600 });
            expect(result).toBe("https://signed-url.com");
        });

        it("should throw S3SignedUrlException on error", async () => {
            const err = new Error("Signing failed");
            (getSignedUrl as jest.Mock).mockRejectedValue(err);

            await expect(s3Service.getSignedDownloadUrl("test-key")).rejects.toThrow(S3SignedUrlException);
        });
    });

    describe("downloadFile", () => {
        it("should download file successfully", async () => {
            const mockStream = new Readable();
            const mockHeadResult = {
                ContentType: "text/plain",
                ContentLength: 1024,
            };
            const mockGetResult = {
                Body: mockStream
            };

            mockS3.send
                .mockResolvedValueOnce(mockHeadResult)
                .mockResolvedValueOnce(mockGetResult);

            const result = await s3Service.downloadFile("test-key");

            expect(result).toEqual({
                body: mockStream,
                contentType: "text/plain",
                contentLength: 1024,
            });
        });

        it("should throw S3DownloadException when metadata is missing", async () => {
            const mockHeadResult = {
                ContentType: undefined,
                ContentLength: undefined,
            };

            const mockGetResult = {
                Body: {} as Readable,
            };

            mockS3.send
                .mockResolvedValueOnce(mockHeadResult)
                .mockResolvedValueOnce(mockGetResult);

            const error = await s3Service.downloadFile("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3DownloadException);
            expect(error.message).toContain("Error downloading file");
            expect(error.message).toContain("test-key");
            expect(error.message).toContain("my-default-bucket");
        });

        it("should throw S3DownloadException when only ContentType is missing", async () => {
            const mockHeadResult = {
                ContentType: undefined,
                ContentLength: 1024,
            };

            const mockGetResult = {
                Body: {} as Readable,
            };

            mockS3.send
                .mockResolvedValueOnce(mockHeadResult)
                .mockResolvedValueOnce(mockGetResult);

            const error = await s3Service.downloadFile("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3DownloadException);
            expect(error.message).toContain("test-key");
        });

        it("should throw S3DownloadException when only ContentLength is missing", async () => {
            const mockHeadResult = {
                ContentType: "text/plain",
                ContentLength: undefined,
            };

            const mockGetResult = {
                Body: {} as Readable,
            };

            mockS3.send
                .mockResolvedValueOnce(mockHeadResult)
                .mockResolvedValueOnce(mockGetResult);

            const error = await s3Service.downloadFile("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3DownloadException);
            expect(error.message).toContain("test-key");
        });

        it("should throw S3DownloadException on error", async () => {
            const err = new Error("Download failed");
            mockS3.send.mockRejectedValueOnce(err);

            await expect(s3Service.downloadFile("test-key")).rejects.toThrow(S3DownloadException);
        });
    });

    describe("uploadFile", () => {
        it("should upload file successfully", async () => {
            const mockFile = {
                fieldname: "file",
                originalname: "test.txt",
                encoding: "7bit",
                mimetype: "text/plain",
                size: 1024,
                buffer: Buffer.from("test content"),
                stream: null,
                destination: "",
                filename: "",
                path: ""
            } as any;
            const metadata = { key: "value" };

            mockS3.send.mockResolvedValue({});

            await s3Service.uploadFile(mockFile, metadata, "custom-bucket", "custom-key");

            expect(PutObjectCommand).toHaveBeenCalledWith({
                Bucket: "custom-bucket",
                Key: "custom-key",
                Body: mockFile.buffer,
                ContentType: mockFile.mimetype,
                Metadata: metadata
            });
        });

        it("should use file originalname when keyName not provided", async () => {
            const mockFile = {
                fieldname: "file",
                originalname: "test.txt",
                encoding: "7bit",
                mimetype: "text/plain",
                size: 1024,
                buffer: Buffer.from("test content"),
                stream: null,
                destination: "",
                filename: "",
                path: ""
            } as any;

            mockS3.send.mockResolvedValue({});

            await s3Service.uploadFile(mockFile, {}, "custom-bucket");

            expect(PutObjectCommand).toHaveBeenCalledWith({
                Bucket: "custom-bucket",
                Key: "test.txt",
                Body: mockFile.buffer,
                ContentType: mockFile.mimetype,
                Metadata: {}
            });
        });

        it("should throw S3UploadException on error", async () => {
            const mockFile = {
                fieldname: "file",
                originalname: "test.txt",
                encoding: "7bit",
                mimetype: "text/plain",
                size: 1024,
                buffer: Buffer.from("test content"),
                stream: null,
                destination: "",
                filename: "",
                path: ""
            } as any;
            const err = new Error("Upload failed");
            mockS3.send.mockRejectedValue(err);

            await expect(s3Service.uploadFile(mockFile, {})).rejects.toThrow(S3UploadException);
        });
    });

    describe("deleteFile", () => {
        it("should delete file successfully", async () => {
            mockS3.send.mockResolvedValue({});

            await s3Service.deleteFile("test-key", "custom-bucket");

            expect(DeleteObjectCommand).toHaveBeenCalledWith({
                Bucket: "custom-bucket",
                Key: "test-key"
            });
        });

        it("should throw S3DeleteFileException on error", async () => {
            const err = new Error("Delete failed");
            mockS3.send.mockRejectedValue(err);

            await expect(s3Service.deleteFile("test-key")).rejects.toThrow(S3DeleteFileException);
        });
    });

    describe("deleteFiles", () => {
        it("should delete multiple files successfully", async () => {
            const mockResult = {
                Deleted: [{ Key: "file1.txt" }, { Key: "file2.txt" }]
            };
            mockS3.send.mockResolvedValue(mockResult);

            const result = await s3Service.deleteFiles(["file1.txt", "file2.txt"], "custom-bucket");

            expect(DeleteObjectsCommand).toHaveBeenCalledWith({
                Bucket: "custom-bucket",
                Delete: {
                    Objects: [
                        { Key: "file1.txt" },
                        { Key: "file2.txt" }
                    ],
                    Quiet: false
                }
            });
            expect(result).toEqual(mockResult.Deleted);
        });

        it("should return empty array when no files deleted", async () => {
            const mockResult = {};
            mockS3.send.mockResolvedValue(mockResult);

            const result = await s3Service.deleteFiles(["file1.txt"], "custom-bucket");

            expect(result).toEqual([]);
        });

        it("should throw S3DeleteFilesException on error", async () => {
            const err = new Error("Delete failed");
            mockS3.send.mockRejectedValue(err);

            await expect(s3Service.deleteFiles(["file1.txt"])).rejects.toThrow(S3DeleteFilesException);
        });
    });

    describe("getObjectMetadata", () => {
        it("should return metadata successfully", async () => {
            const mockResult = {
                ContentType: "text/plain",
                ContentLength: 1024,
                LastModified: new Date(),
                ETag: "abc123",
                Metadata: { key: "value" }
            };

            mockS3.send.mockResolvedValue(mockResult);

            const result = await s3Service.getObjectMetadata("test-key");

            expect(result).toEqual({
                contentType: "text/plain",
                contentLength: 1024,
                lastModified: mockResult.LastModified,
                metadata: { key: "value" },
                eTag: "abc123"
            });
        });

        it("should throw S3GetMetadataException when required fields are missing", async () => {
            const mockResult = {
                ContentType: undefined,
                ContentLength: undefined,
                LastModified: undefined,
                ETag: undefined,
                Metadata: {}
            };

            mockS3.send.mockResolvedValue(mockResult);

            const error = await s3Service.getObjectMetadata("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3GetMetadataException);
            expect(error.cause).toBeInstanceOf(S3MissingMetadataException);
            expect(error.cause.missingFields).toEqual(["ContentType", "ContentLength", "LastModified", "ETag"]);
        });

        it("should throw S3GetMetadataException when only ContentType is missing", async () => {
            const mockResult = {
                ContentType: undefined,
                ContentLength: 1024,
                LastModified: new Date(),
                ETag: "abc123",
                Metadata: {}
            };

            mockS3.send.mockResolvedValue(mockResult);

            const error = await s3Service.getObjectMetadata("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3GetMetadataException);
            expect(error.cause).toBeInstanceOf(S3MissingMetadataException);
            expect(error.cause.missingFields).toEqual(["ContentType"]);
        });

        it("should throw S3GetMetadataException when only ContentLength is missing", async () => {
            const mockResult = {
                ContentType: "text/plain",
                ContentLength: undefined,
                LastModified: new Date(),
                ETag: "abc123",
                Metadata: {}
            };

            mockS3.send.mockResolvedValue(mockResult);

            const error = await s3Service.getObjectMetadata("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3GetMetadataException);
            expect(error.cause).toBeInstanceOf(S3MissingMetadataException);
            expect(error.cause.missingFields).toEqual(["ContentLength"]);
        });

        it("should throw S3GetMetadataException when only LastModified is missing", async () => {
            const mockResult = {
                ContentType: "text/plain",
                ContentLength: 1024,
                LastModified: undefined,
                ETag: "abc123",
                Metadata: {}
            };

            mockS3.send.mockResolvedValue(mockResult);

            const error = await s3Service.getObjectMetadata("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3GetMetadataException);
            expect(error.cause).toBeInstanceOf(S3MissingMetadataException);
            expect(error.cause.missingFields).toEqual(["LastModified"]);
        });

        it("should throw S3GetMetadataException when only ETag is missing", async () => {
            const mockResult = {
                ContentType: "text/plain",
                ContentLength: 1024,
                LastModified: new Date(),
                ETag: undefined,
                Metadata: {}
            };

            mockS3.send.mockResolvedValue(mockResult);

            const error = await s3Service.getObjectMetadata("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3GetMetadataException);
            expect(error.cause).toBeInstanceOf(S3MissingMetadataException);
            expect(error.cause.missingFields).toEqual(["ETag"]);
        });

        it("should throw S3GetMetadataException when multiple fields are missing", async () => {
            const mockResult = {
                ContentType: undefined,
                ContentLength: undefined,
                LastModified: new Date(),
                ETag: "abc123",
                Metadata: {}
            };

            mockS3.send.mockResolvedValue(mockResult);

            const error = await s3Service.getObjectMetadata("test-key").catch(e => e);

            expect(error).toBeInstanceOf(S3GetMetadataException);
            expect(error.cause).toBeInstanceOf(S3MissingMetadataException);
            expect(error.cause.missingFields).toEqual(["ContentType", "ContentLength"]);
        });

        it("should throw S3GetMetadataException on error", async () => {
            const err = new Error("Metadata failed");
            mockS3.send.mockRejectedValue(err);

            await expect(s3Service.getObjectMetadata("test-key")).rejects.toThrow(S3GetMetadataException);
        });
    });

    it("should default metadata to empty object when undefined from S3", async () => {
        const mockResult = {
            ContentType: "text/plain",
            ContentLength: 1024,
            LastModified: new Date(),
            ETag: "abc123",
            Metadata: undefined
        };

        mockS3.send.mockResolvedValue(mockResult);

        const result = await s3Service.getObjectMetadata("test-key");

        expect(result).toEqual({
            contentType: "text/plain",
            contentLength: 1024,
            lastModified: mockResult.LastModified,
            metadata: {},
            eTag: "abc123"
        });
    });
});
