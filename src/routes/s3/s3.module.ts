import { Module } from '@nestjs/common';

import { EdgeService } from './edge.service';
import { S3Service } from './s3.service';

@Module({
  providers: [S3Service, EdgeService],
  exports: [S3Service, EdgeService],
})
export class S3Module {}
