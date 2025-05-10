import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { AwsService } from './aws.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('aws')
export class AwsController {
  constructor(private readonly awsService: AwsService) { }

  @Get('buckets')
  listBuckets() {
    return this.awsService.listBuckets();
  }

  @Get('objects/:bucket')
  listObjects(@Param('bucket') bucket: string) {
    return this.awsService.listObjects(bucket);
  }

  @Post('upload/:bucket')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @Param('bucket') bucket: string,
    @UploadedFile() file: any,
    @Body() body: any,
  ) {
    return this.awsService.uploadFile(bucket, file, body.metadata);
  }
}
