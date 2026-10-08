import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { FriendsController, UserFriendshipController } from './friends.controller';
import { FriendsService } from './friends.service';

@Module({
  imports: [AuthModule, PrismaModule, UserModule, NotificationsModule],
  controllers: [FriendsController, UserFriendshipController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
