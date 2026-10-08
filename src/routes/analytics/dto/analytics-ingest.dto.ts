import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsLiveState } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { DAY_MS } from '../analytics-time';

/** A route template as the app's router declares it, without a leading slash: `play/:id`. */
export const ROUTE_PATTERN = /^(?:not-found|[a-z0-9_-]+(?:\/(?::[a-zA-Z]+|[a-z0-9_-]+))*)$/;
export const ROUTE_MAX_LENGTH = 80;
export const MAX_EVENTS_PER_BATCH = 50;
/** The most running time one anonymous ping may carry: one interval and its slack. */
export const MAX_PING_PLAY_MS = 65_000;

export const PLAY_END_REASONS = [
  'stopped',
  'halted',
  'leave',
  'pagehide',
  'release-change',
  'rotated',
] as const;
export type PlayEndReason = (typeof PLAY_END_REASONS)[number];

export const PING_KINDS = ['BEAT', 'PLAY_START', 'FLUSH'] as const;
export type PingKind = (typeof PING_KINDS)[number];

/** Where a consenting visit came from, sent with the first batch of a session. */
export class AnalyticsContextDto {
  @ApiPropertyOptional({ description: 'document.referrer of the landing page', maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmSource?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmMedium?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmCampaign?: string;

  @ApiPropertyOptional({ description: 'Viewport width in CSS pixels; stored only as a bucket' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20_000)
  viewportWidth?: number;
}

export class AnalyticsPageViewDto {
  @ApiProperty({
    description: 'Client-minted id, so a retried batch is stored once',
    format: 'uuid',
  })
  @IsUUID('4')
  eventId!: string;

  @ApiProperty({ enum: ['PAGE_VIEW'] })
  @IsIn(['PAGE_VIEW'])
  type!: 'PAGE_VIEW';

  @ApiProperty({ description: 'Milliseconds since the navigation finished, by the client clock' })
  @IsInt()
  @Min(0)
  @Max(DAY_MS)
  ageMs!: number;

  @ApiProperty({ description: 'Route template, as `play/:id`', maxLength: ROUTE_MAX_LENGTH })
  @IsString()
  @MaxLength(ROUTE_MAX_LENGTH)
  @Matches(ROUTE_PATTERN)
  route!: string;
}

/** A consenting browser's identity, carried by every consented request. */
export class AnalyticsIdentityDto {
  @ApiProperty({ description: 'The visitor cookie', format: 'uuid' })
  @IsUUID('4')
  visitorId!: string;

  @ApiProperty({ description: 'The session cookie', format: 'uuid' })
  @IsUUID('4')
  sessionId!: string;
}

export class AnalyticsEventsDto extends AnalyticsIdentityDto {
  @ApiPropertyOptional({ type: AnalyticsContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyticsContextDto)
  context?: AnalyticsContextDto;

  @ApiProperty({ type: [AnalyticsPageViewDto], maxItems: MAX_EVENTS_PER_BATCH })
  @IsArray()
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsPageViewDto)
  events!: AnalyticsPageViewDto[];
}

/** What every report about a play carries, so any of them can create it if the others were lost. */
export class AnalyticsPlayReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  playId!: string;

  @ApiProperty({ description: 'The published project being played' })
  @IsInt()
  @Min(1)
  releaseId!: number;

  @ApiProperty({
    description: 'Reopened after a consent, identity or session change: never counted as a play',
  })
  @IsBoolean()
  continued!: boolean;

  @ApiProperty({ description: 'Cumulative running time the client measured for this play' })
  @IsInt()
  @Min(0)
  @Max(DAY_MS)
  activeMs!: number;

  @ApiPropertyOptional({ description: 'Milliseconds since the play started, by the client clock' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DAY_MS)
  startAgeMs?: number;
}

export class AnalyticsPlayDto extends AnalyticsIdentityDto {
  @ApiProperty({ type: AnalyticsPlayReportDto })
  @ValidateNested()
  @Type(() => AnalyticsPlayReportDto)
  play!: AnalyticsPlayReportDto;

  @ApiProperty({ enum: ['START', 'END'] })
  @IsIn(['START', 'END'])
  phase!: 'START' | 'END';

  @ApiPropertyOptional({ enum: PLAY_END_REASONS })
  @IsOptional()
  @IsIn(PLAY_END_REASONS)
  endReason?: PlayEndReason;
}

export class AnalyticsBeatDto extends AnalyticsIdentityDto {
  @ApiProperty({ enum: AnalyticsLiveState, enumName: 'AnalyticsLiveState' })
  @IsEnum(AnalyticsLiveState)
  state!: AnalyticsLiveState;

  @ApiPropertyOptional({ description: 'The published project on screen, if any' })
  @IsOptional()
  @IsInt()
  @Min(1)
  releaseId?: number;

  @ApiPropertyOptional({ type: AnalyticsPlayReportDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyticsPlayReportDto)
  play?: AnalyticsPlayReportDto;
}

/** An identifier-free ping of a tab that declined or never answered. */
export class AnalyticsPingDto {
  @ApiProperty({ enum: PING_KINDS })
  @IsIn(PING_KINDS)
  kind!: PingKind;

  @ApiProperty({ enum: AnalyticsLiveState, enumName: 'AnalyticsLiveState' })
  @IsEnum(AnalyticsLiveState)
  state!: AnalyticsLiveState;

  @ApiProperty({ description: 'Whether the tab is signed in; never which account' })
  @IsBoolean()
  signedIn!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  releaseId?: number;

  @ApiPropertyOptional({
    description: 'Running time since the previous ping of this tab, sent once and never retried',
    maximum: MAX_PING_PLAY_MS,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PING_PLAY_MS)
  playMs?: number;
}

export class AnalyticsLinkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  visitorId!: string;
}
