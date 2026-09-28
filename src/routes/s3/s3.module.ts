import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Service } from "./s3.service";
import { CloudfrontService } from "./edge.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3ConfigurationException } from "./s3.error";

@Module({
  imports: [
    ConfigModule,
    MulterModule.register({
      limits: { fileSize: 10 * 1024 * 1024 } // 10MB
    })
  ],
  providers: [
    {
      provide: S3Client,
      useFactory: (configService: ConfigService) => {
        const region = configService.get<string>("S3_REGION");
        const accessKeyId = configService.get<string>("S3_ACCESS_KEY_ID");
        const secretAccessKey = configService.get<string>(
          "S3_SECRET_ACCESS_KEY"
        );
        const envVars = {
          S3_REGION: region,
          S3_ACCESS_KEY_ID: accessKeyId,
          S3_SECRET_ACCESS_KEY: secretAccessKey
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
            secretAccessKey: secretAccessKey!
          },
          // Deadlines, as in S3Service. A hung request here would hold a project's save lock and
          // queue every later save behind it.
          requestHandler: new NodeHttpHandler({
            connectionTimeout: Number(configService.get<string>("S3_CONNECTION_TIMEOUT_MS") ?? 5000),
            requestTimeout: Number(configService.get<string>("S3_REQUEST_TIMEOUT_MS") ?? 30000)
          })
        });
      },
      inject: [ConfigService]
    },
    S3Service,
    CloudfrontService,
    PrismaService
  ],
  exports: [S3Service, CloudfrontService]
})
export class S3Module {}
