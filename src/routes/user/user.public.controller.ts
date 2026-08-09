import { Controller, Get, HttpStatus, Param, ParseIntPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "@auth/decorators/public.decorator";
import { CloudfrontService } from "@s3/edge.service";
import { UserService } from "./user.service";
import { PublicUserProfileResponseDto } from "./dto/public-user-profile-response.dto";
import { ProjectService } from "@project/project.service";
import { ProjectExResponseDto } from "@project/dto/project-response.dto";

const DEFAULT_GAMES_PAGE = 1;
const DEFAULT_GAMES_LIMIT = 20;

@ApiTags("users")
@Controller("users/public")
export class UserPublicController {
  constructor(
    private readonly userService: UserService,
    private readonly cloudfrontService: CloudfrontService,
    private readonly projectService: ProjectService
  ) {}

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
    const profileImageUrl = await this.cloudfrontService.getVersionedCDNUrl(`users/${id}/profile`);
    const backgroundImageUrl = await this.cloudfrontService.getVersionedCDNUrl(`users/${id}/background`);

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
  @Get("username/:username/profile")
  @ApiOperation({ summary: "Get a public user profile by username" })
  @ApiParam({ name: "username", description: "Username" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the public user profile",
    type: PublicUserProfileResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: "User not found" })
  async getPublicProfileByUsername(
    @Param("username") username: string
  ): Promise<PublicUserProfileResponseDto> {
    const profile = await this.userService.findPublicProfileByUsername(username);
    const profileImageUrl = await this.cloudfrontService.getVersionedCDNUrl(
      `users/${profile.id}/profile`
    );
    const backgroundImageUrl = await this.cloudfrontService.getVersionedCDNUrl(
      `users/${profile.id}/background`
    );

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
    name: "page",
    type: "number",
    required: false
  })
  @ApiQuery({
    name: "limit",
    type: "number",
    required: false
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the list of published games liked by the user",
    type: [ProjectExResponseDto]
  })
  async getLikedGames(
    @Param("id", ParseIntPipe) id: number,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ): Promise<ProjectExResponseDto[]> {
    return this.projectService.fetchLikedPublishedGamesByUser(
      id,
      page ? parseInt(page, 10) : DEFAULT_GAMES_PAGE,
      limit ? parseInt(limit, 10) : DEFAULT_GAMES_LIMIT
    );
  }

  @Public()
  @Get(":id/published-games")
  @ApiOperation({ summary: "Get a user's published games" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiQuery({
    name: "page",
    type: "number",
    required: false
  })
  @ApiQuery({
    name: "limit",
    type: "number",
    required: false
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the list of games published by the user",
    type: [ProjectExResponseDto]
  })
  async getPublishedGames(
    @Param("id", ParseIntPipe) id: number,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ): Promise<ProjectExResponseDto[]> {
    return this.projectService.fetchPublishedGamesByUser(
      id,
      page ? parseInt(page, 10) : DEFAULT_GAMES_PAGE,
      limit ? parseInt(limit, 10) : DEFAULT_GAMES_LIMIT
    );
  }
}
