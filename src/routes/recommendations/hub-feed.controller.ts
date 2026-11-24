import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/access/access.decorators';
import { RequestWithOptionalUser } from '../../auth/auth.types';
import {
  HubResponseDto,
  HubShelfPageDto,
  HubShelfPageQueryDto,
  HubShelvesQueryDto,
  HubShelvesResponseDto,
} from './dto/hub.dto';
import { HubFeedService } from './hub-feed.service';

// Public, and personal for whoever sends a valid token: the same routes serve both readers.
@ApiTags('hub')
@Controller('hub')
@Public()
export class HubFeedController {
  constructor(private readonly hubFeedService: HubFeedService) {}

  @Get()
  @ApiOperation({ summary: 'The hub of the day: its hero and the shelves it opens on' })
  @ApiResponse({ status: 200, type: HubResponseDto })
  async getHub(@Req() req: RequestWithOptionalUser): Promise<HubResponseDto> {
    return this.hubFeedService.feed(req.user?.id ?? null);
  }

  @Get('shelves')
  @ApiOperation({ summary: 'Shelves by key, fetched as the page scrolls' })
  @ApiResponse({ status: 200, type: HubShelvesResponseDto })
  @ApiResponse({ status: 400, description: 'A key names no shelf, or too many were asked for' })
  async getShelves(
    @Req() req: RequestWithOptionalUser,
    @Query() query: HubShelvesQueryDto,
  ): Promise<HubShelvesResponseDto> {
    return { shelves: await this.hubFeedService.shelves(query.keys, req.user?.id ?? null) };
  }

  @Get('shelves/:key')
  @ApiOperation({ summary: 'One page of everything a shelf lists' })
  @ApiParam({ name: 'key', description: 'popular, trending, friends or tag:<tag>' })
  @ApiResponse({ status: 200, type: HubShelfPageDto })
  @ApiResponse({ status: 400, description: 'The key names no shelf' })
  async getShelf(
    @Req() req: RequestWithOptionalUser,
    @Param('key') key: string,
    @Query() query: HubShelfPageQueryDto,
  ): Promise<HubShelfPageDto> {
    return this.hubFeedService.shelfPage(key, req.user?.id ?? null, query);
  }
}
