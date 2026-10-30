import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DiscordModule } from '../../discord/discord.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { CrashService } from './crash.service';
import { CrashCaptureFilter } from './crash-capture.filter';
import { CrashIngestController } from './crash-ingest.controller';
import { CrashNotifier } from './crash-notifier';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { StackResolver } from './stack-resolver';

@Module({
  imports: [PrismaModule, S3Module, DiscordModule],
  controllers: [ReportsController, CrashIngestController, AdminReportsController],
  providers: [
    ReportsService,
    AdminReportsService,
    CrashService,
    CrashNotifier,
    StackResolver,
    { provide: APP_FILTER, useClass: CrashCaptureFilter },
  ],
  exports: [CrashService],
})
export class ReportsModule {}
