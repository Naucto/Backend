import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { Public, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { AnalyticsIngestService, IngestRequest } from './analytics-ingest.service';
import { AnalyticsThrottlerGuard } from './analytics-throttler.guard';
import {
  AnalyticsBeatDto,
  AnalyticsEventsDto,
  AnalyticsLinkDto,
  AnalyticsPingDto,
  AnalyticsPlayDto,
} from './dto/analytics-ingest.dto';
import {
  AnalyticsEventsResponseDto,
  AnalyticsLinkResponseDto,
  AnalyticsPlayResponseDto,
  AnalyticsRotationDto,
} from './dto/analytics-ingest-response.dto';

const MINUTE_MS = 60_000;

const requestOf = (req: Request): IngestRequest => ({
  userAgent: req.get('user-agent'),
  ip: req.ip,
  acceptLanguage: req.get('accept-language'),
});

/**
 * Where browsers report usage. The reporting routes take JSON sent as text/plain without
 * credentials, so a browser sends them without a preflight and `keepalive` works; they never read
 * an account.
 */
@ApiTags('analytics')
@Controller('analytics')
@UseGuards(AnalyticsThrottlerGuard)
export class AnalyticsIngestController {
  constructor(private readonly ingest: AnalyticsIngestService) {}

  @Public()
  @Post('events')
  @HttpCode(HttpStatus.OK)
  @Throttle({ identity: { limit: 120, ttl: MINUTE_MS } })
  @ApiConsumes('text/plain', 'application/json')
  @ApiOperation({ summary: "Store a consenting browser's page views" })
  @ApiResponse({ status: 200, type: AnalyticsEventsResponseDto })
  @ApiResponse({ status: 429, description: 'Too many reports from this browser or address' })
  events(
    @Body() dto: AnalyticsEventsDto,
    @Req() req: Request,
  ): Promise<AnalyticsEventsResponseDto> {
    return this.ingest.recordEvents(dto, requestOf(req));
  }

  @Public()
  @Post('play')
  @HttpCode(HttpStatus.OK)
  @Throttle({ identity: { limit: 120, ttl: MINUTE_MS } })
  @ApiConsumes('text/plain', 'application/json')
  @ApiOperation({ summary: "Store the start or end of a consenting browser's play" })
  @ApiResponse({ status: 200, type: AnalyticsPlayResponseDto })
  @ApiResponse({ status: 429, description: 'Too many reports from this browser or address' })
  play(@Body() dto: AnalyticsPlayDto, @Req() req: Request): Promise<AnalyticsPlayResponseDto> {
    return this.ingest.recordPlay(dto, requestOf(req));
  }

  @Public()
  @Post('beat')
  @HttpCode(HttpStatus.OK)
  @Throttle({ identity: { limit: 120, ttl: MINUTE_MS } })
  @ApiConsumes('text/plain', 'application/json')
  @ApiOperation({ summary: "Mark a consenting browser's visible tab as present this minute" })
  @ApiResponse({ status: 200, type: AnalyticsRotationDto })
  @ApiResponse({ status: 429, description: 'Too many reports from this browser or address' })
  beat(@Body() dto: AnalyticsBeatDto, @Req() req: Request): Promise<AnalyticsRotationDto> {
    return this.ingest.recordBeat(dto, requestOf(req));
  }

  @Public()
  @Post('ping')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ identity: { limit: 6_000, ttl: MINUTE_MS } })
  @ApiConsumes('text/plain', 'application/json')
  @ApiOperation({
    summary: 'Count an identifier-free ping of a tab that declined analytics or never answered',
  })
  @ApiResponse({ status: 204, description: 'Counted, or ignored' })
  @ApiResponse({ status: 429, description: 'Too many pings from this address' })
  async ping(@Body() dto: AnalyticsPingDto, @Req() req: Request): Promise<void> {
    await this.ingest.recordPing(dto, requestOf(req));
  }

  @RequiresAuth()
  @Post('link')
  @HttpCode(HttpStatus.OK)
  @Throttle({ identity: { limit: 30, ttl: MINUTE_MS } })
  @ApiOperation({ summary: 'Link this consenting browser to the signed-in account' })
  @ApiResponse({ status: 200, type: AnalyticsLinkResponseDto })
  @ApiResponse({ status: 429, description: 'Too many links from this account' })
  link(
    @Body() dto: AnalyticsLinkDto,
    @Req() req: RequestWithUser,
  ): Promise<AnalyticsLinkResponseDto> {
    return this.ingest.link(req.user.id, dto.visitorId);
  }
}
