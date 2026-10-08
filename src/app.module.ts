import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AccessGuard } from './auth/access/access.guard';
import { AuthModule } from './auth/auth.module';
import { gracefulShutdownModule } from './graceful-shutdown.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { PrismaModule } from './prisma/prisma.module';
import { FeaturesModule } from './routes/features/features.module';
import { FriendsModule } from './routes/friends/friends.module';
import { MultiplayerModule } from './routes/multiplayer/multiplayer.module';
import { ProjectModule } from './routes/project/project.module';
import { ProjectCommentModule } from './routes/project-comment/project-comment.module';
import { RecommendationsModule } from './routes/recommendations/recommendations.module';
import { S3Module } from './routes/s3/s3.module';
import { UserModule } from './routes/user/user.module';
import { WorkSessionModule } from './routes/work-session/work-session.module';
import { TasksModule } from './tasks/tasks.module';
import { WebRTCModule } from './webrtc/webrtc.module';

@Module({
  imports: [
    gracefulShutdownModule(),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    S3Module,
    UserModule,
    ProjectModule,
    WorkSessionModule,
    TasksModule,
    WebRTCModule,
    MultiplayerModule,
    ProjectCommentModule,
    NotificationsModule,
    FriendsModule,
    PresenceModule,
    RecommendationsModule,
    FeaturesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }],
})
export class AppModule {}
