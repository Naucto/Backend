import { Module } from '@nestjs/common';

import { AccountModerationService } from './account-moderation.service';
import { AdminCaseController } from './admin-case.controller';
import { AdminModerationAccountController } from './admin-moderation-account.controller';
import { AdminModerationCommentController } from './admin-moderation-comment.controller';
import { AdminModerationLogController } from './admin-moderation-log.controller';
import { AdminModerationProjectController } from './admin-moderation-project.controller';
import { CaseService } from './case.service';
import { ContentModerationService } from './content-moderation.service';
import { FlagsService } from './flags.service';
import { ModerationController } from './moderation.controller';
import { ModerationDirectoryService } from './moderation-directory.service';
import { ModerationLogService } from './moderation-log.service';
import { StaffPreviewController } from './staff-preview.controller';
import { StaffPreviewService } from './staff-preview.service';
import { StandingService } from './standing.service';

@Module({
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
    ModerationLogService,
  ],
})
export class ModerationModule {}
