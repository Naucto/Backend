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
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { S3Service } from './s3.service';
import { CreateBucketDto } from './dto/create-bucket.dto';
import { DeleteFilesDto } from './dto/delete-files.dto';
import { ApplyPolicyDto } from './dto/apply-policy.dto';
import { GeneratePolicyDto } from './dto/generate-policy.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { Readable } from 'stream';

@ApiTags('s3')
@Controller('s3')
export class S3Controller {
  constructor(private readonly s3Service: S3Service) {}

  @Get('list')
  @ApiOperation({ summary: 'List all S3 buckets' })
  @ApiResponse({ status: 200, description: 'Returns a list of all buckets' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async listBuckets() {
    const buckets = await this.s3Service.listBuckets();
    return { buckets };
  }

  @Get('list/:bucketName')
  @ApiOperation({ summary: 'List objects in a bucket' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiResponse({
    status: 200,
    description: 'Returns a list of objects in the bucket',
  })
  @ApiResponse({ status: 500, description: 'Server error' })
  async listObjects(@Param('bucketName') bucketName: string) {
    const contents = await this.s3Service.listObjects(bucketName);
    return { contents };
  }

  @Get('download-url/:bucketName/:key')
  @ApiOperation({ summary: 'Generate a signed download URL' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiParam({ name: 'key', description: 'Object key' })
  @ApiResponse({
    status: 200,
    description: 'Returns a signed URL for downloading the file',
  })
  @ApiResponse({ status: 500, description: 'Server error' })
  async getSignedDownloadUrl(
    @Param('bucketName') bucketName: string,
    @Param('key') key: string,
  ) {
    const url = await this.s3Service.getSignedDownloadUrl(
      bucketName,
      decodeURIComponent(key),
    );
    return { url };
  }

  @Get('download/:bucketName/:key')
  @ApiOperation({ summary: 'Download a file directly' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiParam({ name: 'key', description: 'Object key' })
  @ApiResponse({ status: 200, description: 'File stream' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async downloadFile(
    @Param('bucketName') bucketName: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    try {
      const { body, contentType, contentLength } =
        await this.s3Service.downloadFile(bucketName, decodeURIComponent(key));

      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${key.split('/').pop()}"`,
      );

      if (contentLength) {
        res.setHeader('Content-Length', contentLength.toString());
      }

      if (body instanceof Readable) {
        body.pipe(res);
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({ error: 'File not readable' });
      }
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Server error while downloading file',
        message: error.message,
      });
    }
  }

  @Post('upload/:bucketName')
  @ApiOperation({ summary: 'Upload a file to S3' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadFileDto })
  @UseInterceptors(FileInterceptor('file'))
  @ApiResponse({ status: 200, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'No file provided' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async uploadFile(
    @Param('bucketName') bucketName: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadFileDto: UploadFileDto,
  ) {
    if (!file) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'No file provided',
      };
    }

    await this.s3Service.uploadFile(
      bucketName,
      file,
      uploadFileDto.metadata || {},
    );
    return { message: 'File uploaded successfully' };
  }

  @Delete('delete/:bucketName/:key')
  @ApiOperation({ summary: 'Delete a file from S3' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiParam({ name: 'key', description: 'Object key' })
  @ApiResponse({ status: 200, description: 'File deleted successfully' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async deleteFile(
    @Param('bucketName') bucketName: string,
    @Param('key') key: string,
  ) {
    await this.s3Service.deleteFile(bucketName, decodeURIComponent(key));
    return { message: 'File deleted successfully' };
  }

  @Delete('delete-multiple/:bucketName')
  @ApiOperation({ summary: 'Delete multiple files from S3' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiResponse({ status: 200, description: 'Files deleted successfully' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async deleteFiles(
    @Param('bucketName') bucketName: string,
    @Body() deleteFilesDto: DeleteFilesDto,
  ) {
    const result = await this.s3Service.deleteFiles(
      bucketName,
      deleteFilesDto.keys,
    );
    return { message: 'Files deleted successfully', deleted: result };
  }

  @Delete('bucket/:bucketName')
  @ApiOperation({ summary: 'Delete a bucket' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiResponse({ status: 200, description: 'Bucket deleted successfully' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async deleteBucket(@Param('bucketName') bucketName: string) {
    await this.s3Service.deleteBucket(bucketName);
    return { message: 'Bucket deleted successfully' };
  }

  @Post('bucket/:bucketName')
  @ApiOperation({ summary: 'Create a new bucket' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiResponse({ status: 201, description: 'Bucket created successfully' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async createBucket(
    @Param('bucketName') bucketName: string,
    @Body() createBucketDto: CreateBucketDto,
  ) {
    await this.s3Service.createBucket(bucketName);
    return { message: 'Bucket created successfully' };
  }

  @Get('metadata/:bucketName/:key')
  @ApiOperation({ summary: 'Get object metadata' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiParam({ name: 'key', description: 'Object key' })
  @ApiResponse({ status: 200, description: 'Returns object metadata' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async getObjectMetadata(
    @Param('bucketName') bucketName: string,
    @Param('key') key: string,
  ) {
    const metadata = await this.s3Service.getObjectMetadata(
      bucketName,
      decodeURIComponent(key),
    );
    return { metadata };
  }

  @Post('policy/:bucketName')
  @ApiOperation({ summary: 'Generate a bucket policy' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiResponse({ status: 200, description: 'Policy generated successfully' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async generateBucketPolicy(
    @Param('bucketName') bucketName: string,
    @Body() generatePolicyDto: GeneratePolicyDto,
  ) {
    const { actions, effect, principal, prefix } = generatePolicyDto;
    const policy = this.s3Service.generateBucketPolicy(
      bucketName,
      actions || ['s3:GetObject'],
      effect || 'Allow',
      principal || '*',
      prefix || '*',
    );
    return { message: 'Policy generated successfully', policy };
  }

  @Post('apply-policy/:bucketName')
  @ApiOperation({ summary: 'Apply a policy to a bucket' })
  @ApiParam({ name: 'bucketName', description: 'Name of the bucket' })
  @ApiResponse({ status: 200, description: 'Policy applied successfully' })
  @ApiResponse({ status: 400, description: 'No policy provided' })
  @ApiResponse({ status: 500, description: 'Server error' })
  async applyBucketPolicy(
    @Param('bucketName') bucketName: string,
    @Body() applyPolicyDto: ApplyPolicyDto,
  ) {
    if (!applyPolicyDto.policy) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'No policy provided',
      };
    }
    await this.s3Service.applyBucketPolicy(bucketName, applyPolicyDto.policy);
    return { message: 'Policy applied successfully' };
  }
}
