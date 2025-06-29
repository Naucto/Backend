import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { S3Controller } from "./s3.controller";
import { S3Service } from "./s3.service";
import { PrismaService } from "../../prisma/prisma.service";

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  ],
  controllers: [S3Controller],
  providers: [S3Service, PrismaService],
  exports: [S3Service],
})
export class S3Module {}
