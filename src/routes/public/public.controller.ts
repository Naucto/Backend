import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe
} from "@nestjs/common";
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";
import { CloudfrontService } from "@s3/edge.service";
import { ImageUrlResponseDto } from "./dto/image-url-response.dto";

@ApiTags("public")
@Controller("public")
export class PublicController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly s3Service: S3Service,
    private readonly cloudfrontService: CloudfrontService
  ) {}

  @Get("projects/:id/image")
  @ApiOperation({
    summary: "Get public CDN URL for a published project's image"
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Project ID"
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the CDN URL for the project image",
    type: ImageUrlResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "Project not found, not published, or has no image"
  })
  async getPublishedProjectImage(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ImageUrlResponseDto> {
    const project = await this.prismaService.project.findUnique({
      where: { id },
      select: { id: true, status: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    if (project.status !== "COMPLETED") {
      throw new NotFoundException(
        `Project with ID ${id} is not published`
      );
    }

    const key = `projects/${id}/image`;
    const exists = await this.s3Service.fileExists(key);
    if (!exists) {
      throw new NotFoundException("Project image not found");
    }

    const url = this.cloudfrontService.getCDNUrl(key);
    return { url };
  }

  @Get("users/:id/profile-picture")
  @ApiOperation({
    summary: "Get public CDN URL for a user's profile picture"
  })
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
  async getProfilePicture(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ImageUrlResponseDto> {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const key = `users/${id}/profile`;
    const exists = await this.s3Service.fileExists(key);
    if (!exists) {
      throw new NotFoundException("Profile picture not found");
    }

    const url = this.cloudfrontService.getCDNUrl(key);
    return { url };
  }
}
