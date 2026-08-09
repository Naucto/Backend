import { Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { S3Module } from "@s3/s3.module";
import { NotificationsModule } from "src/notifications/notifications.module";
import { FriendController } from "./friend.controller";
import { FriendService } from "./friend.service";

@Module({
  imports: [PrismaModule, S3Module, NotificationsModule],
  controllers: [FriendController],
  providers: [FriendService],
  exports: [FriendService],
})
export class FriendModule {}
