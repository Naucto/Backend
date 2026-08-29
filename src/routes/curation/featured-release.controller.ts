import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "@auth/decorators/public.decorator";
import { CurationService } from "./curation.service";
import { FeaturedReleaseResponseDto } from "./dto/featured-release.dto";

@ApiTags("releases")
@Controller("releases")
export class FeaturedReleaseController {
  constructor(private readonly curationService: CurationService) {}

  @Public()
  @Get("featured")
  @ApiOperation({ summary: "Get the current featured release (game of the week)" })
  @ApiResponse({
    status: 200,
    description: "The featured release, or null when none is set",
    type: FeaturedReleaseResponseDto
  })
  async getFeatured(): Promise<FeaturedReleaseResponseDto> {
    return { featured: await this.curationService.getCurrent() };
  }
}
