import { Module } from '@nestjs/common';

import { AnalyticsCoreModule } from '../analytics/analytics-core.module';
import { ModerationLogModule } from '../moderation/moderation-log.module';
import { ProjectModule } from '../project/project.module';
import { S3Module } from '../s3/s3.module';
import { AccountDeletionService } from './account-deletion.service';
import { ProfileAssetService } from './profile-asset.service';
import { UserController } from './user.controller';
import { UserPublicController } from './user.public.controller';
import { UserService } from './user.service';

@Module({
  imports: [S3Module, ProjectModule, AnalyticsCoreModule, ModerationLogModule],
  controllers: [UserController, UserPublicController],
  providers: [UserService, AccountDeletionService, ProfileAssetService],
  exports: [UserService, AccountDeletionService, ProfileAssetService],
})
export class UserModule {}
