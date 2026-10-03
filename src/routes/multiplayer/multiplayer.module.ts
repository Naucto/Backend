import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebRTCModule } from '../../webrtc/webrtc.module';
import { FriendsModule } from '../friends/friends.module';
import { ProjectModule } from '../project/project.module';
import { MultiplayerController } from './multiplayer.controller';
import { MultiplayerService } from './multiplayer.service';

@Module({
  imports: [
    ProjectModule,
    PrismaModule,
    WebRTCModule,
    AuthModule,
    FriendsModule,
    NotificationsModule,
  ],
  controllers: [MultiplayerController],
  providers: [MultiplayerService],
  exports: [MultiplayerService],
})
export class MultiplayerModule {}
