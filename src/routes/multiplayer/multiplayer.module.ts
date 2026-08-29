import { AuthModule } from "@auth/auth.module";
import { MultiplayerController } from "./multiplayer.controller";
import { MultiplayerService } from "./multiplayer.service";
import { Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { ProjectModule } from "@project/project.module";
import { WebRTCModule } from "@webrtc/webrtc.module";
import { FriendsModule } from "@friends/friends.module";

@Module({
  imports: [ProjectModule, PrismaModule, WebRTCModule, AuthModule, FriendsModule],
  controllers: [MultiplayerController],
  providers: [MultiplayerService],
  exports: [MultiplayerService]
})
export class MultiplayerModule {}
