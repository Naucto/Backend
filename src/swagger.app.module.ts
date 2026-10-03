/**
 * A lightweight AppModule used exclusively for Swagger JSON generation.
 * It includes all controllers (for full API documentation) but replaces
 * infrastructure-heavy providers (S3, Prisma, etc.) with no-op stubs so
 * the app can boot without real credentials or a database connection.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { InjectionToken, Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AccessGuard } from './auth/access/access.guard';
import { AuthModule } from './auth/auth.module';
import { gracefulShutdownModule } from './graceful-shutdown.module';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PresenceController, UserPresenceController } from './presence/presence.controller';
import { PresenceService } from './presence/presence.service';
import { PrismaService } from './prisma/prisma.service';
import { FeaturesModule } from './routes/features/features.module';
import { FriendsController, UserFriendshipController } from './routes/friends/friends.controller';
import { FriendsService } from './routes/friends/friends.service';
import { MultiplayerController } from './routes/multiplayer/multiplayer.controller';
import { MultiplayerService } from './routes/multiplayer/multiplayer.service';
import { HubController } from './routes/project/hub.controller';
import { HubService } from './routes/project/hub.service';
import { ProjectController } from './routes/project/project.controller';
import { ProjectService } from './routes/project/project.service';
import { ProjectContentController } from './routes/project/project-content.controller';
import { ProjectContentService } from './routes/project/project-content.service';
import { ProjectCommentController } from './routes/project-comment/project-comment.controller';
import { ProjectCommentService } from './routes/project-comment/project-comment.service';
import { AdminFeaturedReleaseController } from './routes/recommendations/admin-featured-release.controller';
import { FeaturedReleaseController } from './routes/recommendations/featured-release.controller';
import { RecommendationsService } from './routes/recommendations/recommendations.service';
import { EdgeService } from './routes/s3/edge.service';
import { S3Service } from './routes/s3/s3.service';
import { UserModule } from './routes/user/user.module';
import { WorkSessionModule } from './routes/work-session/work-session.module';
import { WebRTCModule } from './webrtc/webrtc.module';

const nullProvider = (token: InjectionToken): Provider => ({
  provide: token,
  useValue: null,
});

@Module({
  imports: [
    gracefulShutdownModule(),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    WorkSessionModule,
    WebRTCModule,
    FeaturesModule,
  ],
  controllers: [
    HubController,
    ProjectContentController,
    ProjectController,
    MultiplayerController,
    ProjectCommentController,
    NotificationsController,
    FriendsController,
    UserFriendshipController,
    PresenceController,
    UserPresenceController,
    FeaturedReleaseController,
    AdminFeaturedReleaseController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    nullProvider(PrismaService),
    nullProvider(ProjectService),
    nullProvider(ProjectContentService),
    nullProvider(HubService),
    nullProvider(S3Client),
    nullProvider(S3Service),
    nullProvider(EdgeService),
    nullProvider(MultiplayerService),
    nullProvider(ProjectCommentService),
    nullProvider(NotificationsService),
    nullProvider(FriendsService),
    nullProvider(PresenceService),
    nullProvider(RecommendationsService),
  ],
})
export class SwaggerAppModule {}
