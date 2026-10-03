import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { S3Service } from "./s3.service";
import { EdgeService } from "./edge.service";

@Module({
  imports: [ConfigModule],
  providers: [S3Service, EdgeService],
  exports: [S3Service, EdgeService]
})
export class S3Module {}
