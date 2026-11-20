import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { FeaturedReleaseHistoryDto } from './dto/featured-release.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('admin')
@Controller('admin/featured-release')
@RequiresStaffSession(ADMIN)
export class AdminFeaturedReleaseController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get('history')
  @ApiOperation({ summary: 'List past and current featured releases' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: 200,
    description: 'Featured releases, newest first',
    type: FeaturedReleaseHistoryDto,
  })
  async getHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<FeaturedReleaseHistoryDto> {
    return this.recommendationsService.getHistory(
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
