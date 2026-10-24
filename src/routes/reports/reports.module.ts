import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService, AdminReportsService],
})
export class ReportsModule {}
