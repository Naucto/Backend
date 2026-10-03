import { Module } from '@nestjs/common';

import { ProjectModule } from '../project/project.module';
import { S3Module } from '../s3/s3.module';
import { AccountDeletionService } from './account-deletion.service';
import { ProfileAssetService } from './profile-asset.service';
import { UserController } from './user.controller';
import { UserPublicController } from './user.public.controller';
import { UserService } from './user.service';

@Module({
  imports: [S3Module, ProjectModule],
  controllers: [UserController, UserPublicController],
  providers: [UserService, AccountDeletionService, ProfileAssetService],
  exports: [UserService],
})
export class UserModule {}
