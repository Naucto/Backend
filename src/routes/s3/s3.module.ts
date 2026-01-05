import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Controller } from "./s3.controller";
import { S3Service } from "./s3.service";
import { BucketService } from "./bucket.service";
import { CloudfrontService } from "./cloudfront.service";
import { PrismaService } from "@prisma/prisma.service";
import { S3ConfigurationException } from "./s3.error";

const controllers = process.env["NODE_ENV"] === "production" ? [] : [S3Controller];

@Module({
  imports: [
    ConfigModule,
    MulterModule.register({
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  ],
  controllers,
  providers: [
    {
      provide: S3Client,
      useFactory: (configService: ConfigService) => {
        const region = configService.get<string>("AWS_REGION");
        const accessKeyId = configService.get<string>("AWS_ACCESS_KEY_ID");
        const secretAccessKey = configService.get<string>("AWS_SECRET_ACCESS_KEY");
        const envVars = {
          AWS_REGION: region,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey,
        };

        const missingKeys = Object.entries(envVars)
          .filter(([, value]) => !value)
          .map(([key]) => key);

        if (missingKeys.length > 0) {
          throw new S3ConfigurationException(missingKeys);
        }

        return new S3Client({
          region: region!,
          credentials: {
            accessKeyId: accessKeyId!,
            secretAccessKey: secretAccessKey!,
          },
        });
      },
      inject: [ConfigService],
    },
    S3Service,
    BucketService,
    CloudfrontService,
    PrismaService,
  ],
  exports: [S3Service, BucketService, CloudfrontService],
})
export class S3Module {}
