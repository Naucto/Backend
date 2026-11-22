import { Module } from '@nestjs/common';

import { DiscordModule } from '../../discord/discord.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MultiplayerModule } from '../multiplayer/multiplayer.module';
import { ProjectModule } from '../project/project.module';
import { S3Module } from '../s3/s3.module';
import { UserModule } from '../user/user.module';
import { WorkSessionModule } from '../work-session/work-session.module';
import { AccountModerationService } from './account-moderation.service';
import { AdminCaseController } from './admin-case.controller';
import { AdminModerationAccountController } from './admin-moderation-account.controller';
import { AdminModerationCommentController } from './admin-moderation-comment.controller';
import { AdminModerationLogController } from './admin-moderation-log.controller';
import { AdminModerationProjectController } from './admin-moderation-project.controller';
import { CaseService } from './case.service';
import { ContentModerationService } from './content-moderation.service';
import { FlagNotifier } from './flag-notifier';
import { FlagsService } from './flags.service';
import { ModerationController } from './moderation.controller';
import { ModerationDirectoryService } from './moderation-directory.service';
import { ModerationLogModule } from './moderation-log.module';
import { ModerationTargetService } from './moderation-target.service';
import { StaffPreviewController } from './staff-preview.controller';
import { StaffPreviewService } from './staff-preview.service';
import { StandingService } from './standing.service';

@Module({
  imports: [
    ModerationLogModule,
    NotificationsModule,
    MultiplayerModule,
    WorkSessionModule,
    ProjectModule,
    DiscordModule,
    UserModule,
    S3Module,
  ],
  controllers: [
    ModerationController,
    StaffPreviewController,
    AdminCaseController,
    AdminModerationAccountController,
    AdminModerationProjectController,
    AdminModerationCommentController,
    AdminModerationLogController,
  ],
  providers: [
    FlagsService,
    StandingService,
    StaffPreviewService,
    CaseService,
    AccountModerationService,
    ContentModerationService,
    ModerationDirectoryService,
    ModerationTargetService,
    FlagNotifier,
  ],
})
export class ModerationModule {}
