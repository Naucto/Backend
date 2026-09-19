import { Module, OnModuleInit } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { FriendsModule } from "@friends/friends.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { NotificationsService } from "src/notifications/notifications.service";
import { PresenceController, UserPresenceController } from "./presence.controller";
import { PresenceService } from "./presence.service";

@Module({
  imports: [AuthModule, PrismaModule, FriendsModule, NotificationsModule],
  controllers: [PresenceController, UserPresenceController],
  providers: [PresenceService],
  exports: [PresenceService]
})
export class PresenceModule implements OnModuleInit {
  constructor(
    private readonly presenceService: PresenceService,
    private readonly notificationsService: NotificationsService
  ) {}

  // Presence rides the notifications websocket: the server drives socket
  // open/close/presence:set into the service, and the service fans changes
  // back out to friends' sockets.
  onModuleInit(): void {
    this.notificationsService.attachPresence(this.presenceService);
    this.presenceService.setFanOut((userId, message) =>
      this.notificationsService.sendRawToUser(userId, message)
    );
  }
}
