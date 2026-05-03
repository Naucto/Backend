import { Controller, Get, HttpException, HttpStatus, Param, ParseIntPipe } from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "@auth/decorators/public.decorator";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "src/routes/s3/edge.service";
import { ImageUrlResponseDto } from "src/routes/common/dto/image-url-response.dto";
import { UserService } from "./user.service";
import { PublicUserProfileResponseDto } from "./dto/public-user-profile-response.dto";
import { ProjectService } from "../project/project.service";
import { ProjectExResponseDto } from "../project/dto/project-response.dto";

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

    const key = `users/${id}/profile`;
    const head = await this.s3Service.getFileMetadataOrNull(key);
    const profileImageUrl = head
      ? `${this.cloudfrontService.getCDNUrl(key)}?v=${head.ETag?.replace(/"/g, "") ?? Date.now().toString()}`
      : null;

    return {
      statusCode: HttpStatus.OK,
      message: "Public user profile retrieved successfully",
      data: {
        ...profile,
        profileImageUrl
      }
    };
  }

  @Public()
  @Get(":id/profile-picture")
  @ApiOperation({ summary: "Get public CDN URL for a user's profile picture" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "User ID"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the CDN URL for the profile picture",
    type: ImageUrlResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "User not found or has no profile picture"
  })
  async getPublicProfilePicture(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ImageUrlResponseDto> {
    const key = `users/${id}/profile`;
    const head = await this.s3Service.getFileMetadataOrNull(key);
    if (!head) {
      throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    }

    const version = head.ETag?.replace(/"/g, "") ?? Date.now().toString();
    const url = `${this.cloudfrontService.getCDNUrl(key)}?v=${version}`;
    return { url };
  }

  @Public()
  @Get(":id/likes")
  @ApiOperation({ summary: "Get a user's liked published games" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the list of published games liked by the user",
    type: [ProjectExResponseDto]
  })
  async getLikedGames(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ProjectExResponseDto[]> {
    return this.projectService.fetchLikedPublishedGamesByUser(id);
  }

  @Public()
  @Get(":id/published-games")
  @ApiOperation({ summary: "Get a user's published games" })
  @ApiParam({ name: "id", description: "User ID" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the list of games published by the user",
    type: [ProjectExResponseDto]
  })
  async getPublishedGames(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ProjectExResponseDto[]> {
    return this.projectService.fetchPublishedGamesByUser(id);
  }
}
