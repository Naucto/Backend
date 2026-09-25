import { AuthModule } from "@auth/auth.module";
import { MultiplayerController } from "./multiplayer.controller";
import { MultiplayerService } from "./multiplayer.service";
import { Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ProjectModule } from "@project/project.module";
import { WebRTCModule } from "@webrtc/webrtc.module";
import { AnalyticsModule } from "src/analytics/analytics.module";
import { UserModule } from "../user/user.module";

@Module({
  imports: [UserModule, ProjectModule, PrismaModule, WebRTCModule, AnalyticsModule, AuthModule],
  controllers: [MultiplayerController],
  providers: [MultiplayerService],
  exports: [MultiplayerService]
})
export class MultiplayerModule {}
