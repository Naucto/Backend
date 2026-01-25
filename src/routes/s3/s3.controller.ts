import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpStatus,
  Logger
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from "@nestjs/swagger";
import { S3Service } from "./s3.service";
import { BucketService } from "./bucket.service";
import { CloudfrontService } from "./cloudfront.service";
import { DeleteS3FilesDto } from "./dto/delete-files.dto";
import { UploadFileDto } from "./dto/upload-file.dto";

import { Bucket, _Object } from "@aws-sdk/client-s3";
import { CloudfrontSignedCookiesOutput } from "@aws-sdk/cloudfront-signer";

import { S3ObjectMetadata } from "./s3.interface";
import { MissingEnvVarError } from "@auth/auth.error";

@ApiTags("s3")
@Controller("s3")
export class S3Controller {
  private readonly sessionCookieTimeout = 600;
  private readonly logger = new Logger(S3Controller.name);
  constructor(
    private readonly s3Service: S3Service,
    private readonly bucketService: BucketService,
    private readonly cloudfrontService: CloudfrontService,
    private readonly configService: ConfigService
  ) {}

  @Get("list")
  @ApiOperation({ summary: "List all S3 buckets" })
  @ApiResponse({ status: 200, description: "Returns a list of all buckets" })
  @ApiResponse({ status: 500, description: "Server error" })
  async listBuckets(): Promise<{ buckets: Bucket[] }> {
    const buckets = await this.bucketService.listBuckets();
    return { buckets };
  }

  @Get("list/:bucketName")
  @ApiOperation({ summary: "List objects in a bucket" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({
    status: 200,
    description: "Returns a list of objects in the bucket",
  })
  @ApiResponse({ status: 500, description: "Server error" })
  async listObjects(@Param("bucketName") bucketName?: string): Promise<{ contents: _Object[] | [] }> {
    const contents = await this.s3Service.listObjects({ bucketName: bucketName! });
    return { contents };
  }

  @Get("download-url/:bucketName/:key")
  @ApiOperation({ summary: "Generate a signed download URL" })
  @ApiParam({ name: "key", description: "Object key" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 200, description: "Returns a signed URL for downloading the file" })
  @ApiResponse({ status: 500, description: "Server error" })
  async getSignedDownloadUrl(@Param("key") key: string, @Param("bucketName") bucketName?: string): Promise<{url: string}> {
    const url = await this.s3Service.getSignedDownloadUrl(
      decodeURIComponent(key),
      bucketName,
    );
    return { url };
  }

  @Get("download/:bucketName/:key")
  @ApiOperation({ summary: "Download a file directly" })
  @ApiParam({ name: "key", description: "Object key" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 200, description: "File stream" })
  @ApiResponse({ status: 500, description: "Server error" })
  async downloadFile(@Param("key") key: string, @Res() res: Response, @Param("bucketName") bucketName?: string): Promise<void> {
    const decodedKey = decodeURIComponent(key);
    try {
      const { body, contentType, contentLength } =
        await this.s3Service.downloadFile({ key: decodedKey, bucketName: bucketName! });

      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${decodedKey.split("/").pop()}"`);

      if (contentLength) {
        res.setHeader("Content-Length", contentLength.toString());
      }

      body.pipe(res);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(`Error downloading project's content ${decodedKey} from bucket ${bucketName}: ${error.message}`, error.stack);
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ error: "Server error while downloading file", message: error.message });
      } else {
        this.logger.error(`Unknown error downloading content ${decodedKey} from bucket ${bucketName}`);
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ error: "Server error while downloading file", message: "Unknown error occurred" });
      }
      return;
    }
  }

  @Post("upload/:bucketName")
  @ApiOperation({ summary: "Upload a file to S3" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ type: UploadFileDto })
  @UseInterceptors(FileInterceptor("file"))
  @ApiResponse({ status: 200, description: "File uploaded successfully" })
  @ApiResponse({ status: 400, description: "No file provided" })
  @ApiResponse({ status: 500, description: "Server error" })
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body() uploadFileDto: UploadFileDto, @Param("bucketName") bucketName?: string): Promise<{ message: string } | { statusCode: number; error: string }> {
    if (!file) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: "No file provided",
      };
    }

    await this.s3Service.uploadFile({
      file: file,
      metadata: uploadFileDto.metadata || {},
      bucketName: bucketName!
    });
    return { message: "File uploaded successfully" };
  }

  @Delete("delete/:bucketName/:key")
  @ApiOperation({ summary: "Delete a file from S3" })
  @ApiParam({ name: "key", description: "Object key" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 200, description: "File deleted successfully" })
  @ApiResponse({ status: 500, description: "Server error" })
  async deleteFile(@Param("key") key: string, @Param("bucketName") bucketName?: string): Promise<{ message: string }> {
    await this.s3Service.deleteFile({
      key: decodeURIComponent(key),
      bucketName: bucketName!
    });
    return { message: "File deleted successfully" };
  }

  @Delete("delete-multiple/:bucketName")
  @ApiOperation({ summary: "Delete multiple files from S3" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 200, description: "Files deleted successfully" })
  @ApiResponse({ status: 500, description: "Server error" })
  async deleteFiles(@Body() deleteFilesDto: DeleteS3FilesDto, @Param("bucketName") bucketName?: string): Promise<{ message: string; deleted: _Object[] }> {
    const result = await this.s3Service.deleteFiles({
      keys: deleteFilesDto.keys.map(key => decodeURIComponent(key)),
      bucketName: bucketName!,
    });
    return { message: "Files deleted successfully", deleted: result };
  }

  @Delete("bucket/:bucketName")
  @ApiOperation({ summary: "Delete a bucket" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 200, description: "Bucket deleted successfully" })
  @ApiResponse({ status: 500, description: "Server error" })
  async deleteBucket(@Param("bucketName") bucketName?: string): Promise<{ message: string }> {
    await this.bucketService.deleteBucket(bucketName);
    return { message: "Bucket deleted successfully" };
  }

  @Post("bucket/:bucketName")
  @ApiOperation({ summary: "Create a new bucket" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 201, description: "Bucket created successfully" })
  @ApiResponse({ status: 500, description: "Server error" })
  async createBucket(@Param("bucketName") bucketName?: string): Promise<{ message: string }> {
    await this.bucketService.createBucket(bucketName);
    return { message: "Bucket created successfully" };
  }

  @Get("metadata/:bucketName/:key")
  @ApiOperation({ summary: "Get object metadata" })
  @ApiParam({ name: "key", description: "Object key" })
  @ApiParam({ name: "bucketName", description: "Name of the bucket" })
  @ApiResponse({ status: 200, description: "Returns object metadata" })
  @ApiResponse({ status: 500, description: "Server error" })
  async getObjectMetadata(@Param("key") key: string, @Param("bucketName") bucketName?: string): Promise<{metadata: S3ObjectMetadata}> {
    const metadata = await this.s3Service.getObjectMetadata({
      key: decodeURIComponent(key),
      bucketName: bucketName!
    });
    return { metadata };
  }

  @Get("cdn-url/:key")
  @ApiOperation({ summary: "Get the CDN URL for a file" })
  @ApiParam({ name: "key", description: "Object key" })
  @ApiResponse({ status: 200, description: "Returns the CDN URL" })
  @ApiResponse({ status: 500, description: "Server error" })
  async getCdnUrl(@Param("key") key: string): Promise<{ url: string }> {
    const url = this.cloudfrontService.generateSignedUrl(decodeURIComponent(key));
    return { url };
  }

  @Get("signed-cookies/:key")
  @ApiOperation({ summary: "Generate CloudFront signed cookies for a resource" })
  @ApiParam({ name: "key", description: "Object key (relative path in CDN)" })
  @ApiResponse({ status: 200, description: "Returns signed cookies" })
  @ApiResponse({ status: 500, description: "Server error" })
  async getSignedCookies(@Param("key") key: string, @Res() res: Response): Promise<void> {
    try {
      const cdnUrl = this.configService.get<string>("CDN_URL");
      if (!cdnUrl) {
        throw new MissingEnvVarError("CDN_URL");
      }
      const resourceUrl = `https://${cdnUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;

      const cookies = this.cloudfrontService.createSignedCookies(
        resourceUrl,
        this.sessionCookieTimeout,
      );

      const cookieOptions = {
        httpOnly: true,
        secure: true,
        path: "/",
        domain: `.${cdnUrl}`,
        sameSite: "lax" as const,
        maxAge: 60 * 60 * 1000,
      };

      res.cookie("CloudFront-Expires", cookies["CloudFront-Expires"], cookieOptions);
      res.cookie("CloudFront-Signature", cookies["CloudFront-Signature"], cookieOptions);
      res.cookie("CloudFront-Key-Pair-Id", cookies["CloudFront-Key-Pair-Id"], cookieOptions);

      const response = {
        message: "Signed cookies set successfully",
        resourceUrl,
        cookies: {
          "CloudFront-Expires": cookies["CloudFront-Expires"],
          "CloudFront-Signature": cookies["CloudFront-Signature"],
          "CloudFront-Key-Pair-Id": cookies["CloudFront-Key-Pair-Id"],
        },
      };
      this.logger.debug("Response JSON:", JSON.stringify(response));
      res.status(HttpStatus.OK).json(response);
    } catch (error) {
      this.logger.error("Error generating signed cookies:", error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: "Could not generate signed cookies",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  @Get("/signed-cookies")
  async setSignedCookies(@Res({ passthrough: true }) res: Response): Promise<{ success: boolean, cookies: CloudfrontSignedCookiesOutput}> {
    const cookies = this.cloudfrontService.generateSignedCookies();

    Object.entries(cookies).forEach(([name, value]) => {
      res.cookie(name, value, {
        // domain: "d3puh88kxjv1qg.cloudfront.net",
        httpOnly: true,
        secure: false,
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 1000,
      });
    });

    return { success: true, cookies };
  }
}
