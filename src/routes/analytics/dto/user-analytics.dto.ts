import { ApiProperty } from '@nestjs/swagger';

export class UserAnalyticsTotalsDto {
  @ApiProperty({ description: 'Games started, a restart counting as a new play' }) plays!: number;
  @ApiProperty({ description: 'Time games ran in a visible tab' }) playtimeMs!: number;
}

export class UserAnalyticsGameDto {
  @ApiProperty() releaseId!: number;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a game since deleted' })
  name!: string | null;
  @ApiProperty() plays!: number;
  @ApiProperty() playtimeMs!: number;
}

export class UserAnalyticsSummaryDto {
  @ApiProperty({
    description: 'Whether any browser that consented to analytics is linked to the account',
  })
  tracked!: boolean;
  @ApiProperty() linkedBrowsers!: number;
  @ApiProperty({ type: UserAnalyticsTotalsDto }) lifetime!: UserAnalyticsTotalsDto;
  @ApiProperty({ type: UserAnalyticsTotalsDto, description: 'The current UTC calendar month' })
  thisMonth!: UserAnalyticsTotalsDto;
  @ApiProperty() gamesPlayed!: number;
  @ApiProperty({ type: [UserAnalyticsGameDto], description: 'The five games played longest' })
  topGames!: UserAnalyticsGameDto[];
  @ApiProperty({ type: String, nullable: true }) lastActiveAt!: string | null;
  @ApiProperty({
    description: 'Whether lastActiveAt is exact, or only the day once the raw data is gone',
  })
  lastActiveIsExact!: boolean;
}

export class UserAnalyticsEraseResponseDto {
  @ApiProperty({ description: 'Browsers whose analytics were erased; they will start afresh' })
  erasedBrowsers!: number;
}

export class ExportVisitorDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstSeenAt!: string;
  @ApiProperty() lastSeenAt!: string;
  @ApiProperty({ type: String, nullable: true }) linkedAt!: string | null;
}

export class ExportSessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() visitorId!: string;
  @ApiProperty() startedAt!: string;
  @ApiProperty() lastSeenAt!: string;
  @ApiProperty({ type: String, nullable: true }) closedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) referrerDomain!: string | null;
  @ApiProperty({ type: String, nullable: true }) utmSource!: string | null;
  @ApiProperty({ type: String, nullable: true }) utmMedium!: string | null;
  @ApiProperty({ type: String, nullable: true }) utmCampaign!: string | null;
  @ApiProperty() device!: string;
  @ApiProperty({ type: String, nullable: true }) browser!: string | null;
  @ApiProperty({ type: String, nullable: true }) os!: string | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty({ type: String, nullable: true }) screen!: string | null;
  @ApiProperty({ type: String, nullable: true }) language!: string | null;
}

export class ExportSessionDayDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty() day!: string;
  @ApiProperty() pageViews!: number;
  @ApiProperty() activeMinutes!: number;
  @ApiProperty() buildMinutes!: number;
  @ApiProperty() playMs!: number;
}

export class ExportPageViewDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty() occurredAt!: string;
  @ApiProperty() route!: string;
}

export class ExportPlayDto {
  @ApiProperty() id!: string;
  @ApiProperty() sessionId!: string;
  @ApiProperty() releaseId!: number;
  @ApiProperty() continued!: boolean;
  @ApiProperty() startedAt!: string;
  @ApiProperty() activeMs!: number;
  @ApiProperty({ type: String, nullable: true }) endedAt!: string | null;
}

export class ExportHistoryDayDto {
  @ApiProperty() day!: string;
  @ApiProperty() releaseId!: number;
  @ApiProperty() plays!: number;
  @ApiProperty() activeMs!: number;
  @ApiProperty() activeMinutes!: number;
}

export class ExportFactDto {
  @ApiProperty() type!: string;
  @ApiProperty() at!: string;
  @ApiProperty({ type: Number, nullable: true }) projectId!: number | null;
}

export class ExportReleaseViewDto {
  @ApiProperty() projectId!: number;
  @ApiProperty() day!: string;
}

export class UserAnalyticsExportDto {
  @ApiProperty() exportedAt!: string;
  @ApiProperty({
    description:
      'What the export holds: raw activity is kept 90 days; the history by day is kept while the account exists',
  })
  note!: string;
  @ApiProperty({ type: [ExportVisitorDto] }) browsers!: ExportVisitorDto[];
  @ApiProperty({ type: [ExportSessionDto] }) sessions!: ExportSessionDto[];
  @ApiProperty({ type: [ExportSessionDayDto] }) sessionDays!: ExportSessionDayDto[];
  @ApiProperty({ type: [ExportPageViewDto] }) pageViews!: ExportPageViewDto[];
  @ApiProperty({ type: [ExportPlayDto] }) plays!: ExportPlayDto[];
  @ApiProperty({ type: [ExportHistoryDayDto] }) history!: ExportHistoryDayDto[];
  @ApiProperty({ type: [ExportFactDto] }) facts!: ExportFactDto[];
  @ApiProperty({ type: [ExportReleaseViewDto] }) releaseViews!: ExportReleaseViewDto[];
}
