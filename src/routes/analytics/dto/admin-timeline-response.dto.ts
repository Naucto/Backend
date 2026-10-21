import { ApiProperty } from '@nestjs/swagger';

import { TIMELINE_BUCKET_NAMES, TimelineBucket } from '../analytics-timeline';

export class AnalyticsTimelineSeriesDto {
  @ApiProperty() metric!: string;
  @ApiProperty({ enum: ['C', 'C_LINKED', 'A', 'C_AND_A', 'F', 'PRESENCE'] }) population!: string;
  @ApiProperty({
    enum: ['sum', 'distinct', 'max'],
    description: 'How the buckets make up the total: added, counted once, or the highest',
  })
  combine!: string;
  @ApiProperty() definition!: string;
  @ApiProperty({
    type: [String],
    description: 'Filters of the request this metric is not split by, and so did not apply',
  })
  ignoredFilters!: string[];
  @ApiProperty({
    type: 'array',
    items: { type: 'number', nullable: true },
    description:
      'One value per bucket. Null before the raw window, after now, and for a presence bucket without a sample',
  })
  values!: (number | null)[];
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The whole window, combined as `combine` says',
  })
  total!: number | null;
}

export class AnalyticsTimelineDto {
  @ApiProperty({ description: 'Start of the first bucket' }) from!: string;
  @ApiProperty({ description: 'End of the last bucket, excluded' }) to!: string;
  @ApiProperty({ enum: TIMELINE_BUCKET_NAMES }) bucket!: TimelineBucket;
  @ApiProperty() bucketMs!: number;
  @ApiProperty({ description: 'Raw data starts here: buckets before it have no value' })
  rawFrom!: string;
  @ApiProperty({ type: [String], description: 'Start of every bucket' }) buckets!: string[];
  @ApiProperty({ type: [AnalyticsTimelineSeriesDto] }) series!: AnalyticsTimelineSeriesDto[];
}

export class AnalyticsSourceDto {
  @ApiProperty({ description: 'As the timeline takes it: `referrer:itch.io`' }) source!: string;
  @ApiProperty({ enum: ['referrer', 'utmSource', 'utmCampaign'] }) kind!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null for direct visits' })
  value!: string | null;
  @ApiProperty({ description: 'Consenting sessions started in the window' }) sessions!: number;
  @ApiProperty({ description: 'Consenting browsers whose first session it was' })
  visitorsNew!: number;
}

export class AnalyticsSourcesDto {
  @ApiProperty({ type: [AnalyticsSourceDto] }) sources!: AnalyticsSourceDto[];
}

export const ACTIVITY_KINDS = [
  'FIRST_VISIT',
  'FIRST_PLAY',
  'SIGNUP',
  'PROJECT_CREATED',
  'RELEASE_PUBLISHED',
  'RELEASE_UNPUBLISHED',
  'MP_SESSION',
  'ANONYMOUS_PLAYS',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export class AnalyticsActivityItemDto {
  @ApiProperty() at!: string;
  @ApiProperty({ enum: ACTIVITY_KINDS }) kind!: ActivityKind;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'A short code standing for one consenting browser, the same in every answer while the backend runs and never its cookie. Null when no consenting browser is involved',
  })
  journey!: string | null;
  @ApiProperty({ type: Number, nullable: true }) releaseId!: number | null;
  @ApiProperty({ type: String, nullable: true }) game!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Where a first visit came from, as a source the timeline takes',
  })
  source!: string | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty({ type: String, nullable: true }) device!: string | null;
  @ApiProperty({ description: 'Plays a row of anonymous plays stands for, 1 otherwise' })
  count!: number;
  @ApiProperty({ type: Boolean, nullable: true, description: 'Anonymous plays: signed-in tabs' })
  signedIn!: boolean | null;
  @ApiProperty({
    enum: ['DECLINED', 'UNANSWERED', 'UNKNOWN'],
    nullable: true,
    description: 'Anonymous plays: what the tabs answered to analytics',
  })
  consent!: 'DECLINED' | 'UNANSWERED' | 'UNKNOWN' | null;
}

export class AnalyticsActivityDto {
  @ApiProperty({ type: [AnalyticsActivityItemDto], description: 'Newest first' })
  items!: AnalyticsActivityItemDto[];
  @ApiProperty({ description: 'Whether the window held more than the limit' }) truncated!: boolean;
}

export class AnalyticsArrivalGameDto {
  @ApiProperty() releaseId!: number;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ description: 'Browsers of the population that played it' }) players!: number;
  @ApiProperty({ description: 'Plays of the population, until now' }) plays!: number;
  @ApiProperty({
    description: 'Plays started in the window in tabs that declined analytics or never answered',
  })
  anonymousPlays!: number;
}

export class AnalyticsArrivalSummaryDto {
  @ApiProperty({ description: 'Consenting browsers first seen in the window' }) arrived!: number;
  @ApiProperty({ description: 'Of them, browsers that started a play since' }) played!: number;
  @ApiProperty({ description: 'Of them, linked to an account created after their first visit' })
  signedUp!: number;
  @ApiProperty({ description: 'Of them, linked to an account that existed before' })
  existingAccounts!: number;
  @ApiProperty({ description: 'Of them, whose account created a project since' })
  createdProject!: number;
  @ApiProperty({ description: 'Of them, whose account published a game since' }) published!: number;
  @ApiProperty({
    description: 'Plays started in the window in tabs that declined analytics or never answered',
  })
  anonymousPlays!: number;
  @ApiProperty({ description: 'Of them, in tabs that refused analytics' }) declinedPlays!: number;
  @ApiProperty({ description: 'Of them, in tabs that have not answered yet' })
  unansweredPlays!: number;
  @ApiProperty({ description: 'Of them, in signed-in tabs' }) anonymousSignedInPlays!: number;
  @ApiProperty({
    description: 'Accounts created in the window that no consenting browser is linked to',
  })
  unlinkedSignups!: number;
}

export class AnalyticsArrivalDto {
  @ApiProperty() journey!: string;
  @ApiProperty() firstSeenAt!: string;
  @ApiProperty() lastSeenAt!: string;
  @ApiProperty({ type: String, nullable: true }) referrer!: string | null;
  @ApiProperty({ type: String, nullable: true }) utmSource!: string | null;
  @ApiProperty({ type: String, nullable: true }) utmCampaign!: string | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty({ type: String, nullable: true }) device!: string | null;
  @ApiProperty() sessions!: number;
  @ApiProperty() plays!: number;
  @ApiProperty({ type: String, nullable: true }) firstPlayAt!: string | null;
  @ApiProperty({ type: [String], description: 'Names of the games played, most played first' })
  games!: string[];
  @ApiProperty({
    enum: ['NEW', 'EXISTING'],
    nullable: true,
    description: 'Null while no account is linked',
  })
  account!: 'NEW' | 'EXISTING' | null;
  @ApiProperty({ type: String, nullable: true }) signedUpAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) projectCreatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) publishedAt!: string | null;
}

export class AnalyticsArrivalsDto {
  @ApiProperty({ type: AnalyticsArrivalSummaryDto }) summary!: AnalyticsArrivalSummaryDto;
  @ApiProperty({ type: [AnalyticsArrivalGameDto], description: 'The ten most played' })
  games!: AnalyticsArrivalGameDto[];
  @ApiProperty({ type: [AnalyticsArrivalDto], description: 'Newest first, up to the limit' })
  visitors!: AnalyticsArrivalDto[];
}

export class AnalyticsReleaseDto {
  @ApiProperty() releaseId!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a project not published' })
  publishedAt!: string | null;
}

export class AnalyticsReleasesDto {
  @ApiProperty({
    type: [AnalyticsReleaseDto],
    description: 'An id match first, then the latest published, up to the limit',
  })
  releases!: AnalyticsReleaseDto[];
}
