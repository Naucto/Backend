import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { FeaturesModule } from '../features/features.module';
import { AnalyticsCoreModule } from './analytics-core.module';
import { AnalyticsIngestController } from './analytics-ingest.controller';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsTallyService } from './analytics-tally.service';
import { ANALYTICS_THROTTLERS } from './analytics-throttler.guard';
import { GeoIpService } from './geo-ip.service';
import { PublishedReleasesService } from './published-releases.service';

@Module({
  imports: [
    AnalyticsCoreModule,
    FeaturesModule,
    ThrottlerModule.forRoot({ throttlers: ANALYTICS_THROTTLERS }),
  ],
  controllers: [AnalyticsIngestController],
  providers: [
    AnalyticsIngestService,
    AnalyticsTallyService,
    GeoIpService,
    PublishedReleasesService,
  ],
})
export class AnalyticsModule {}
