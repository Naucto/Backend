import { Module } from '@nestjs/common';

import { AnalyticsErasureService } from './analytics-erasure.service';
import { AnalyticsFactService } from './analytics-fact.service';

/** The analytics services other features call, without the HTTP surface of analytics. */
@Module({
  providers: [AnalyticsErasureService, AnalyticsFactService],
  exports: [AnalyticsErasureService, AnalyticsFactService],
})
export class AnalyticsCoreModule {}
