import { Controller, Get, HttpStatus, Param, ParseIntPipe, Query } from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "@auth/decorators/public.decorator";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";
import { UserService } from "./user.service";
import { PublicUserProfileResponseDto } from "./dto/public-user-profile-response.dto";
import { ProjectService } from "../project/project.service";
import { ProjectExResponseDto } from "../project/dto/project-response.dto";

const DEFAULT_GAMES_LIMIT = 20;

@ApiTags("users")
@ApiExtraModels(PublicUserProfileResponseDto)
@Controller("users/public")
export class UserPublicController {
  constructor(
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
    private readonly cloudfrontService: CloudfrontService,
    private readonly projectService: ProjectService
  ) {}

  private async getPublicAssetUrl(key: string): Promise<string | null> {
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      return null;
    }

    const version = head.ETag?.replace(/"/g, "") ?? Date.now().toString();
    return `${this.cloudfrontService.getCDNUrl(key)}?v=${version}`;
  }

  @Public()
  @Get(":id/profile")
  @ApiOperation({ summary: "Get a public user profile by ID" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the public user profile",
    type: PublicUserProfileResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  async getPublicProfile(
    @Param("id", ParseIntPipe) id: number
  ): Promise<PublicUserProfileResponseDto> {
    const profile = await this.userService.findPublicProfile(id);
    const profileImageUrl = await this.getPublicAssetUrl(`users/${id}/profile`);
    const backgroundImageUrl = await this.getPublicAssetUrl(`users/${id}/background`);

    return {
      statusCode: HttpStatus.OK,
      message: "Public user profile retrieved successfully",
      data: {
        ...profile,
        profileImageUrl,
        backgroundImageUrl
      }
    };
  }

  @Public()
  @Get(":id/likes")
  @ApiOperation({ summary: "Get a user's liked published games" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Optional max number of games to return"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the list of published games liked by the user",
    type: [ProjectExResponseDto]
  })
  async getLikedGames(
    @Param("id", ParseIntPipe) id: number,
    @Query("limit") limit?: string
  ): Promise<ProjectExResponseDto[]> {
    const parsedLimit = limit ? Number(limit) : undefined;
    const safeLimit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.trunc(parsedLimit), DEFAULT_GAMES_LIMIT)
        : undefined;
    return this.projectService.fetchLikedPublishedGamesByUser(id, safeLimit);
  }

  @Public()
  @Get(":id/published-games")
  @ApiOperation({ summary: "Get a user's published games" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Optional max number of games to return"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the list of games published by the user",
    type: [ProjectExResponseDto]
  })
  async getPublishedGames(
    @Param("id", ParseIntPipe) id: number,
    @Query("limit") limit?: string
  ): Promise<ProjectExResponseDto[]> {
    const parsedLimit = limit ? Number(limit) : undefined;
    const safeLimit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.trunc(parsedLimit), DEFAULT_GAMES_LIMIT)
        : undefined;
    return this.projectService.fetchPublishedGamesByUser(id, safeLimit);
  }
}
