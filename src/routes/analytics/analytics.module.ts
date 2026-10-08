import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { PresenceModule } from '../../presence/presence.module';
import { FeaturesModule } from '../features/features.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AnalyticsCoreModule } from './analytics-core.module';
import { AnalyticsFinalizeService } from './analytics-finalize.service';
import { AnalyticsIngestController } from './analytics-ingest.controller';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsProjectionService } from './analytics-projection.service';
import { AnalyticsPurgeService } from './analytics-purge.service';
import { AnalyticsQueryService } from './analytics-query.service';
import { AnalyticsSamplerService } from './analytics-sampler.service';
import { AnalyticsTallyService } from './analytics-tally.service';
import { ANALYTICS_THROTTLERS } from './analytics-throttler.guard';
import { GeoIpService } from './geo-ip.service';
import { PublishedReleasesService } from './published-releases.service';
import { UserAnalyticsController } from './user-analytics.controller';
import { UserAnalyticsService } from './user-analytics.service';

@Module({
  imports: [
    AnalyticsCoreModule,
    FeaturesModule,
    PresenceModule,
    ThrottlerModule.forRoot({ throttlers: ANALYTICS_THROTTLERS }),
  ],
  controllers: [AnalyticsIngestController, AdminAnalyticsController, UserAnalyticsController],
  providers: [
    AnalyticsFinalizeService,
    AnalyticsIngestService,
    AnalyticsProjectionService,
    AnalyticsPurgeService,
    AnalyticsQueryService,
    AnalyticsSamplerService,
    AnalyticsTallyService,
    GeoIpService,
    PublishedReleasesService,
    UserAnalyticsService,
  ],
})
export class AnalyticsModule {}
