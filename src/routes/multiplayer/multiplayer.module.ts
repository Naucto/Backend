import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebRTCModule } from '../../webrtc/webrtc.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { FriendsModule } from '../friends/friends.module';
import { ProjectModule } from '../project/project.module';
import { MultiplayerController } from './multiplayer.controller';
import { MultiplayerService } from './multiplayer.service';
import { MultiplayerAccountingService } from './multiplayer-accounting.service';

@Module({
  imports: [
    ProjectModule,
    PrismaModule,
    WebRTCModule,
    AuthModule,
    FriendsModule,
    NotificationsModule,
    FeedbackModule,
  ],
  controllers: [MultiplayerController],
  providers: [MultiplayerService, MultiplayerAccountingService],
  exports: [MultiplayerService],
})
export class MultiplayerModule {}
