import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectModule } from '../project/project.module';
import { AdminFeaturedReleaseController } from './admin-featured-release.controller';
import { FeaturedReleaseController } from './featured-release.controller';
import { HubSnapshotService } from './hub-snapshot.service';
import { RecommendationsService } from './recommendations.service';

/** What the hub puts forward, as opposed to what a listing sorts: its shelves, hero and game of the week. */
@Module({
  imports: [AuthModule, PrismaModule, ProjectModule, NotificationsModule],
  controllers: [FeaturedReleaseController, AdminFeaturedReleaseController],
  providers: [RecommendationsService, HubSnapshotService],
})
export class RecommendationsModule {}
