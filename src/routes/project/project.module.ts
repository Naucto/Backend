import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsCoreModule } from '../analytics/analytics-core.module';
import { S3Module } from '../s3/s3.module';
import { HubController } from './hub.controller';
import { HubService } from './hub.service';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { ProjectContentController } from './project-content.controller';
import { ProjectContentService } from './project-content.service';

@Module({
  imports: [PrismaModule, S3Module, AnalyticsCoreModule],
  // Express tries routes in registration order, controller by controller as listed here, and
  // `projects/:id` takes any first segment. The controllers holding literal routes (`releases…`,
  // `limits`, `count`) therefore come before the one holding `:id`, and inside a controller every
  // literal route is declared above the first `:id` one; a literal route registered below would be
  // caught by `:id` and answer 400 for a non-numeric id.
  controllers: [HubController, ProjectContentController, ProjectController],
  providers: [ProjectService, ProjectContentService, HubService],
  exports: [ProjectService, ProjectContentService, HubService],
})
export class ProjectModule {}
