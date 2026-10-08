import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectModule } from '../project/project.module';
import { AdminFeaturedReleaseController } from './admin-featured-release.controller';
import { FeaturedReleaseController } from './featured-release.controller';
import { RecommendationsService } from './recommendations.service';

/** The releases admins put forward on the hub, as opposed to ones a listing sorts. */
@Module({
  imports: [AuthModule, PrismaModule, ProjectModule, NotificationsModule],
  controllers: [FeaturedReleaseController, AdminFeaturedReleaseController],
  providers: [RecommendationsService],
})
export class RecommendationsModule {}
