import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { UserModule } from "@user/user.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { FriendsController, UserFriendshipController } from "./friends.controller";
import { FriendsService } from "./friends.service";

@Module({
  imports: [AuthModule, PrismaModule, UserModule, NotificationsModule],
  controllers: [FriendsController, UserFriendshipController],
  providers: [FriendsService],
  exports: [FriendsService]
})
export class FriendsModule {}
