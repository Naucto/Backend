import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresRole } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { AnalyticsQueryService } from './analytics-query.service';
import {
  AnalyticsBreakdownQueryDto,
  AnalyticsGamesQueryDto,
  AnalyticsPeriodQueryDto,
  AnalyticsPresenceQueryDto,
  AnalyticsRangeQueryDto,
  AnalyticsRetentionQueryDto,
  AnalyticsSeriesQueryDto,
} from './dto/admin-analytics-query.dto';
import {
  AnalyticsBreakdownDto,
  AnalyticsFunnelDto,
  AnalyticsGamesDto,
  AnalyticsHealthDto,
  AnalyticsLiveDto,
  AnalyticsMetricsResponseDto,
  AnalyticsOverviewDto,
  AnalyticsPresenceDto,
  AnalyticsRetentionDto,
  AnalyticsSeriesDto,
} from './dto/admin-analytics-response.dto';

@ApiTags('admin')
@Controller('admin/analytics')
@RequiresRole(ADMIN)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsQueryService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Every metric with what it counts, how it combines and its version' })
  @ApiResponse({ status: 200, type: AnalyticsMetricsResponseDto })
  metrics(): AnalyticsMetricsResponseDto {
    return this.analytics.metrics();
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'A metric, or one value of a dimension, per day, ISO week or month' })
  @ApiResponse({ status: 200, type: AnalyticsSeriesDto })
  timeseries(@Query() query: AnalyticsSeriesQueryDto): Promise<AnalyticsSeriesDto> {
    return this.analytics.series(query);
  }

  @Get('breakdown')
  @ApiOperation({ summary: 'A metric split by one dimension over one period' })
  @ApiResponse({ status: 200, type: AnalyticsBreakdownDto })
  breakdown(@Query() query: AnalyticsBreakdownQueryDto): Promise<AnalyticsBreakdownDto> {
    return this.analytics.breakdown(query);
  }

  @Get('overview')
  @ApiOperation({ summary: 'The headline metrics of a period and of the period before it' })
  @ApiResponse({ status: 200, type: AnalyticsOverviewDto })
  overview(@Query() query: AnalyticsPeriodQueryDto): Promise<AnalyticsOverviewDto> {
    return this.analytics.overview(query);
  }

  @Get('live')
  @ApiOperation({
    summary: 'The last hour of presence, the current minute and the games playing now',
  })
  @ApiResponse({ status: 200, type: AnalyticsLiveDto })
  live(): Promise<AnalyticsLiveDto> {
    return this.analytics.live();
  }

  @Get('presence')
  @ApiOperation({ summary: 'Minute presence samples over at most seven days' })
  @ApiResponse({ status: 200, type: AnalyticsPresenceDto })
  presence(@Query() query: AnalyticsPresenceQueryDto): Promise<AnalyticsPresenceDto> {
    return this.analytics.presence(query);
  }

  @Get('retention')
  @ApiOperation({ summary: 'D1, D7 and D30 retention of the cohorts starting in a range' })
  @ApiResponse({ status: 200, type: AnalyticsRetentionDto })
  retention(@Query() query: AnalyticsRetentionQueryDto): Promise<AnalyticsRetentionDto> {
    return this.analytics.retention(query);
  }

  @Get('funnel')
  @ApiOperation({ summary: 'From first visit to a published game, within the raw window' })
  @ApiResponse({ status: 200, type: AnalyticsFunnelDto })
  funnel(@Query() query: AnalyticsRangeQueryDto): Promise<AnalyticsFunnelDto> {
    return this.analytics.funnel(query);
  }

  @Get('games')
  @ApiOperation({ summary: 'Games ranked by plays, playtime, players or multiplayer sessions' })
  @ApiResponse({ status: 200, type: AnalyticsGamesDto })
  games(@Query() query: AnalyticsGamesQueryDto): Promise<AnalyticsGamesDto> {
    return this.analytics.games(query);
  }

  @Get('health')
  @ApiOperation({ summary: 'Ingest errors, finalization progress and projection backlog' })
  @ApiResponse({ status: 200, type: AnalyticsHealthDto })
  health(): Promise<AnalyticsHealthDto> {
    return this.analytics.health();
  }
}
