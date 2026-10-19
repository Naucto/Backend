import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { PrismaModule } from '../../prisma/prisma.module';
import { FeaturesModule } from '../features/features.module';
import { S3Module } from '../s3/s3.module';
import { AdminCrashController } from './admin-crash.controller';
import { AdminFeedbackController } from './admin-feedback.controller';
import { AdminFeedbackService } from './admin-feedback.service';
import { CrashService } from './crash.service';
import { CrashCaptureFilter } from './crash-capture.filter';
import { CrashIngestController } from './crash-ingest.controller';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [PrismaModule, S3Module, FeaturesModule],
  controllers: [
    FeedbackController,
    CrashIngestController,
    AdminFeedbackController,
    AdminCrashController,
  ],
  providers: [
    FeedbackService,
    CrashService,
    AdminFeedbackService,
    { provide: APP_FILTER, useClass: CrashCaptureFilter },
  ],
  exports: [CrashService],
})
export class FeedbackModule {}
