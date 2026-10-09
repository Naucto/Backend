import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsGrain, AnalyticsRetentionKind } from '@prisma/client';

export const POINT_STATUSES = ['final', 'provisional', 'unavailable'] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

export class AnalyticsMetricInfoDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['C', 'C_LINKED', 'A', 'C_AND_A', 'F', 'PRESENCE'] }) population!: string;
  @ApiProperty({ enum: ['additive', 'max', 'perGrain'] }) kind!: string;
  @ApiProperty({ enum: ['ACTIVITY', 'SESSION', 'FACT', 'MULTIPLAYER', 'PRESENCE', 'COHORT'] })
  finalization!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [String] }) dimensions!: string[];
  @ApiProperty() definition!: string;
}

export class AnalyticsMetricsResponseDto {
  @ApiProperty({ type: [AnalyticsMetricInfoDto] }) metrics!: AnalyticsMetricInfoDto[];
  @ApiProperty({ type: [String], description: 'Dimensions kept as their top values plus (other)' })
  truncatedDimensions!: string[];
  @ApiProperty() erasureContract!: string;
}

export class AnalyticsPointDto {
  @ApiProperty({ description: 'First day of the period, YYYY-MM-DD' }) periodStart!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Null when unavailable, or when the metric has no value (a peak or median without data)',
  })
  value!: number | null;
  @ApiProperty({
    enum: POINT_STATUSES,
    description:
      '`final`: frozen; `provisional`: computed from raw data, may still change; `unavailable`: raw data gone before it was finalized at this version',
  })
  status!: PointStatus;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Share of the minutes of the period that were sampled: whether we were measuring',
  })
  samplerCoverage!: number | null;
  @ApiProperty({ type: Number, nullable: true }) ingestErrorRate!: number | null;
}

export class AnalyticsSeriesDto {
  @ApiProperty() metric!: string;
  @ApiProperty({ description: "'' for the total" }) dimension!: string;
  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' }) grain!: AnalyticsGrain;
  @ApiProperty() definitionVersion!: number;
  @ApiProperty({ type: [AnalyticsPointDto] }) points!: AnalyticsPointDto[];
}

export class AnalyticsBreakdownValueDto {
  @ApiProperty({
    description: 'The dimension value, `(none)` when unknown, `(other)` for the folded rest',
  })
  key!: string;
  @ApiProperty() value!: number;
}

export class AnalyticsBreakdownDto {
  @ApiProperty() metric!: string;
  @ApiProperty() dimension!: string;
  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' }) grain!: AnalyticsGrain;
  @ApiProperty() periodStart!: string;
  @ApiProperty({ enum: POINT_STATUSES }) status!: PointStatus;
  @ApiProperty({ description: 'Whether the rarest values were folded into (other)' })
  truncated!: boolean;
  @ApiProperty({ type: [AnalyticsBreakdownValueDto] }) values!: AnalyticsBreakdownValueDto[];
}

export class AnalyticsTileDto {
  @ApiProperty() metric!: string;
  @ApiProperty({ type: AnalyticsPointDto }) current!: AnalyticsPointDto;
  @ApiProperty({ type: AnalyticsPointDto }) previous!: AnalyticsPointDto;
}

export class AnalyticsOverviewDto {
  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' }) grain!: AnalyticsGrain;
  @ApiProperty() periodStart!: string;
  @ApiProperty({ type: [AnalyticsTileDto] }) tiles!: AnalyticsTileDto[];
}

export class AnalyticsPresenceSampleDto {
  @ApiProperty() at!: string;
  @ApiProperty() activeBrowsers!: number;
  @ApiProperty() activeBrowsersPlaying!: number;
  @ApiProperty() activeBrowsersBuilding!: number;
  @ApiProperty() activeBrowsersHosting!: number;
  @ApiProperty() anonTabs!: number;
  @ApiProperty() anonTabsPlaying!: number;
  @ApiProperty() anonTabsBuilding!: number;
  @ApiProperty() anonTabsHosting!: number;
  @ApiProperty() accounts!: number;
  @ApiProperty() accountsPlaying!: number;
  @ApiProperty() accountsBuilding!: number;
  @ApiProperty() accountsHosting!: number;
}

export class AnalyticsGameNowDto {
  @ApiProperty() releaseId!: number;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ description: 'Consenting browsers playing it in the last minute' })
  browsers!: number;
  @ApiProperty({ description: 'Anonymous pings from it in the last minute' }) anonTabs!: number;
}

export class AnalyticsLiveDto {
  @ApiProperty({ description: 'Minute-active, not instantaneous; accounts are instantaneous' })
  note!: string;
  @ApiProperty({ type: [AnalyticsPresenceSampleDto], description: 'The last 60 sampled minutes' })
  samples!: AnalyticsPresenceSampleDto[];
  @ApiProperty({
    type: AnalyticsPresenceSampleDto,
    description: 'The current minute so far, provisional',
  })
  current!: AnalyticsPresenceSampleDto;
  @ApiProperty({ type: [AnalyticsGameNowDto] }) gamesNow!: AnalyticsGameNowDto[];
}

export class AnalyticsPresenceDto {
  @ApiProperty({ type: [AnalyticsPresenceSampleDto] }) samples!: AnalyticsPresenceSampleDto[];
}

export class AnalyticsCohortOffsetDto {
  @ApiProperty() offsetDays!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Null until the return day is final' })
  retained!: number | null;
  @ApiProperty({ type: Number, nullable: true }) rate!: number | null;
  @ApiProperty() mature!: boolean;
}

export class AnalyticsCohortDto {
  @ApiProperty() cohortDay!: string;
  @ApiProperty() size!: number;
  @ApiProperty({ type: [AnalyticsCohortOffsetDto] }) offsets!: AnalyticsCohortOffsetDto[];
}

export class AnalyticsRetentionDto {
  @ApiProperty({ enum: AnalyticsRetentionKind, enumName: 'AnalyticsRetentionKind' })
  kind!: AnalyticsRetentionKind;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [AnalyticsCohortDto] }) cohorts!: AnalyticsCohortDto[];
}

export class AnalyticsFunnelStepDto {
  @ApiProperty({ enum: ['visited', 'played', 'signedUp', 'createdProject', 'published'] })
  step!: string;
  @ApiProperty() count!: number;
}

export class AnalyticsFunnelDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({
    description:
      'Consenting browsers first seen in the range, each step counted after the one before',
  })
  population!: string;
  @ApiProperty({ type: [AnalyticsFunnelStepDto] }) steps!: AnalyticsFunnelStepDto[];
}

export class AnalyticsGameDto {
  @ApiProperty() releaseId!: number;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a game since deleted' })
  name!: string | null;
  @ApiProperty() plays!: number;
  @ApiProperty() playtimeMs!: number;
  @ApiProperty() players!: number;
  @ApiProperty() mpSessions!: number;
}

export class AnalyticsGamesDto {
  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' }) grain!: AnalyticsGrain;
  @ApiProperty() periodStart!: string;
  @ApiProperty({ enum: POINT_STATUSES }) status!: PointStatus;
  @ApiProperty({ type: [AnalyticsGameDto] }) items!: AnalyticsGameDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class AnalyticsIngestTotalsDto {
  @ApiProperty() accepted!: number;
  @ApiProperty() rejected!: number;
  @ApiProperty() throttled!: number;
  @ApiProperty() writeErrors!: number;
}

export class AnalyticsClassLagDto {
  @ApiProperty() finalization!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) lastFinalDay!: string | null;
}

export class AnalyticsHealthDto {
  @ApiProperty({ type: AnalyticsIngestTotalsDto, description: 'Over the last 24 hours' })
  ingest!: AnalyticsIngestTotalsDto;
  @ApiProperty({ type: [AnalyticsClassLagDto] }) finalization!: AnalyticsClassLagDto[];
  @ApiProperty() projectionBacklog!: number;
  @ApiProperty({ type: String, nullable: true }) oldestProjectionWork!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Oldest raw day still stored' })
  oldestRawDay!: string | null;
}
