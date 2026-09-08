import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "@auth/decorators/public.decorator";
import { FeaturesResponseDto } from "./dto/features.dto";
import { FeaturesService } from "./features.service";

@ApiTags("features")
@Controller("features")
export class FeaturesController {
  constructor(private readonly featuresService: FeaturesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Which parts of the product this deployment is showing" })
  @ApiResponse({ status: 200, type: FeaturesResponseDto })
  getFeatures(): FeaturesResponseDto {
    return this.featuresService.features;
  }
}
