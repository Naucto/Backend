import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PresenceModule } from '../../presence/presence.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { FriendsModule } from '../friends/friends.module';
import { ProjectModule } from '../project/project.module';
import { AdminFeaturedReleaseController } from './admin-featured-release.controller';
import { FeaturedReleaseController } from './featured-release.controller';
import { HubFeedController } from './hub-feed.controller';
import { HubFeedService } from './hub-feed.service';
import { HubSnapshotService } from './hub-snapshot.service';
import { RecommendationsService } from './recommendations.service';

/** What the hub puts forward, as opposed to what a listing sorts: its shelves, hero and game of the week. */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ProjectModule,
    NotificationsModule,
    FriendsModule,
    PresenceModule,
  ],
  controllers: [FeaturedReleaseController, AdminFeaturedReleaseController, HubFeedController],
  providers: [RecommendationsService, HubSnapshotService, HubFeedService],
})
export class RecommendationsModule {}
