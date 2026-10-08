import { Module } from '@nestjs/common';

import { AnalyticsErasureService } from './analytics-erasure.service';

/** Erasure without the HTTP surface of analytics, so account deletion can import it. */
@Module({
  providers: [AnalyticsErasureService],
  exports: [AnalyticsErasureService],
})
export class AnalyticsIdentityModule {}
