import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

import { Public } from '../../auth/access/access.decorators';
import { isBotUserAgent } from '../analytics/request-context';
import { CrashService } from './crash.service';
import { CrashReportDto } from './dto/crash-report.dto';

const MINUTE_MS = 60_000;

/**
 * Where browsers report crashes. Like the analytics routes, it takes JSON sent as text/plain
 * without credentials and never reads an account, so a crash names no one.
 */
@ApiTags('feedback')
@Controller('reports')
@UseGuards(ThrottlerGuard)
export class CrashIngestController {
  constructor(private readonly crashes: CrashService) {}

  @Public()
  @Post('crash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ identity: { limit: 30, ttl: MINUTE_MS } })
  @ApiConsumes('text/plain', 'application/json')
  @ApiOperation({ summary: 'Report an uncaught error of the web app or a fault of the engine' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Recorded, or ignored' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many reports' })
  async report(@Body() dto: CrashReportDto, @Req() req: Request): Promise<void> {
    const userAgent = req.get('user-agent');
    if (isBotUserAgent(userAgent)) {
      return;
    }
    await this.crashes.recordSafely({
      source: dto.source === 'engine' ? 'ENGINE' : 'WEB',
      name: dto.name,
      message: dto.message,
      stack: dto.stack,
      route: dto.route,
      appRelease: dto.appRelease,
      userAgent,
      ...(dto.extra ? { extra: { ...dto.extra } } : {}),
    });
  }
}
