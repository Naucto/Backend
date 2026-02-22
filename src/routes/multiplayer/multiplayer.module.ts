import { UserModule } from "@user/user.module";
import { MultiplayerController } from "./multiplayer.controller";
import { MultiplayerService } from "./multiplayer.service";
import { Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ProjectModule } from "@project/project.module";
import { WebRTCModule } from "@webrtc/webrtc.module";

@Module({
  imports: [UserModule, ProjectModule, PrismaModule, WebRTCModule],
  controllers: [MultiplayerController],
  providers: [MultiplayerService],
  exports: [MultiplayerService]
})
export class MultiplayerModule {}
