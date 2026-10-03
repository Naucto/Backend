import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/access/access.decorators';
import { FeaturedReleaseResponseDto } from './dto/featured-release.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('releases')
@Controller('releases')
export class FeaturedReleaseController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Public()
  @Get('featured')
  @ApiOperation({ summary: 'Get the current featured release (game of the week)' })
  @ApiResponse({
    status: 200,
    description: 'The featured release, or null when none is set',
    type: FeaturedReleaseResponseDto,
  })
  async getFeatured(): Promise<FeaturedReleaseResponseDto> {
    return { featured: await this.recommendationsService.getCurrent() };
  }
}
