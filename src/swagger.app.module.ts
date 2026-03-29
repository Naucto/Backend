/**
 * A lightweight AppModule used exclusively for Swagger JSON generation.
 * It includes all controllers (for full API documentation) but replaces
 * infrastructure-heavy providers (S3, Prisma, etc.) with no-op stubs so
 * the app can boot without real credentials or a database connection.
 */

import { ProjectController } from "@project/project.controller";
import { MultiplayerController } from "src/routes/multiplayer/multiplayer.controller";
import { ProjectService } from "@project/project.service";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Client } from "@aws-sdk/client-s3";
import { MultiplayerService } from "src/routes/multiplayer/multiplayer.service";
import { UserModule } from "@user/user.module";
import { WorkSessionModule } from "@work-session/work-session.module";

import { WebRTCModule } from "@webrtc/webrtc.module";
import { WebRTCService } from "@webrtc/webrtc.service";

import { GracefulShutdownModule, IGracefulShutdownConfigOptions } from "@tygra/nestjs-graceful-shutdown";

import { Module, InjectionToken, Provider } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";

import { AuthModule } from "@auth/auth.module";

const nullProvider = (token: InjectionToken): Provider => ({
  provide: token,
  useValue: null
});

@Module({
  imports: [
    GracefulShutdownModule.forRootAsync({
      imports: [WebRTCModule],
      inject: [WebRTCService],
      useFactory: async (webrtcService: WebRTCService): Promise<IGracefulShutdownConfigOptions> => {
        return {
          cleanup: async (/* app, signal */): Promise<void> =>
            webrtcService.shutdownAllServers()
        };
      }
    }),
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    WorkSessionModule,
    WebRTCModule
  ],
  controllers: [ProjectController, MultiplayerController],
  providers: [
    nullProvider(PrismaService),
    nullProvider(ProjectService),
    nullProvider(S3Client),
    nullProvider(S3Service),
    nullProvider(CloudfrontService),
    nullProvider(MultiplayerService)
  ]
})
export class SwaggerAppModule {}
