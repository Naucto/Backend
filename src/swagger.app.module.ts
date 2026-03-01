/**
 * A lightweight AppModule used exclusively for Swagger JSON generation.
 * It includes all controllers (for full API documentation) but replaces
 * infrastructure-heavy providers (S3, Prisma, etc.) with no-op stubs so
 * the app can boot without real credentials or a database connection.
 */

import { Module, InjectionToken, Provider } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";

import { AuthModule } from "@auth/auth.module";

import { ProjectController } from "@project/project.controller";
import { S3Controller } from "@s3/s3.controller";
import { MultiplayerController } from "src/routes/multiplayer/multiplayer.controller";

import { ProjectService } from "@project/project.service";
import { S3Service } from "@s3/s3.service";
import { BucketService } from "@s3/bucket.service";
import { CloudfrontService } from "@s3/cloudfront.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Client } from "@aws-sdk/client-s3";
import { MultiplayerService } from "src/routes/multiplayer/multiplayer.service";

import { UserModule } from "@user/user.module";
import { WorkSessionModule } from "@work-session/work-session.module";
import { WebRTCModule } from "@webrtc/webrtc.module";

const nullProvider = (token: InjectionToken): Provider => ({
  provide: token,
  useValue: null
});

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    WorkSessionModule,
    WebRTCModule
  ],
  controllers: [ProjectController, S3Controller, MultiplayerController],
  providers: [
    nullProvider(PrismaService),
    nullProvider(ProjectService),
    nullProvider(S3Client),
    nullProvider(S3Service),
    nullProvider(BucketService),
    nullProvider(CloudfrontService),
    nullProvider(MultiplayerService)
  ]
})
export class SwaggerAppModule {}
