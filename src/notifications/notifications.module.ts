import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { WebRTCModule } from "@webrtc/webrtc.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [AuthModule, PrismaModule, WebRTCModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
