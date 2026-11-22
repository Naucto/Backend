import { Body, Controller, Get, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreatedFlagDto, CreateFlagDto } from './dto/flag.dto';
import { StandingDto } from './dto/standing.dto';
import { FlagsService } from './flags.service';
import { MODERATION_ERROR } from './moderation.error';
import { StandingService } from './standing.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@ApiTags('moderation')
@Controller('moderation')
@RequiresAuth()
@UseGuards(ThrottlerGuard)
export class ModerationController {
  constructor(
    private readonly flags: FlagsService,
    private readonly standings: StandingService,
  ) {}

  @Post('flags')
  @Throttle({ identity: { limit: 20, ttl: DAY_MS } })
  @ApiOperation({ summary: 'Report a game, a comment or a profile to staff' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreatedFlagDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: `Your own content (${MODERATION_ERROR.CANNOT_FLAG_OWN_CONTENT})`,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: `No such target, or none the account can see (${MODERATION_ERROR.FLAG_TARGET_NOT_FOUND})`,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: `Already reported by this account and not settled yet (${MODERATION_ERROR.ALREADY_FLAGGED})`,
  })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many reports' })
  createFlag(@Req() req: RequestWithUser, @Body() dto: CreateFlagDto): Promise<CreatedFlagDto> {
    return this.flags.create(req.user.id, dto);
  }

  @Get('standing')
  @ApiOperation({ summary: 'Where the signed-in account stands with moderation, and why' })
  @ApiResponse({ status: HttpStatus.OK, type: StandingDto })
  standing(@Req() req: RequestWithUser, @Query() query: PaginationQueryDto): Promise<StandingDto> {
    return this.standings.standing(req.user.id, { page: query.page, limit: query.limit });
  }
}
