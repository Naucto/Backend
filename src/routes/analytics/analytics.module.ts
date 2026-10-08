import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { PresenceModule } from '../../presence/presence.module';
import { FeaturesModule } from '../features/features.module';
import { AnalyticsCoreModule } from './analytics-core.module';
import { AnalyticsIngestController } from './analytics-ingest.controller';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsSamplerService } from './analytics-sampler.service';
import { AnalyticsTallyService } from './analytics-tally.service';
import { ANALYTICS_THROTTLERS } from './analytics-throttler.guard';
import { GeoIpService } from './geo-ip.service';
import { PublishedReleasesService } from './published-releases.service';

@Module({
  imports: [
    AnalyticsCoreModule,
    FeaturesModule,
    PresenceModule,
    ThrottlerModule.forRoot({ throttlers: ANALYTICS_THROTTLERS }),
  ],
  controllers: [AnalyticsIngestController],
  providers: [
    AnalyticsIngestService,
    AnalyticsSamplerService,
    AnalyticsTallyService,
    GeoIpService,
    PublishedReleasesService,
  ],
})
export class AnalyticsModule {}
