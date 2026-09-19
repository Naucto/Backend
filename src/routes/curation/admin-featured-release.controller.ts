import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  Req
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { Request } from "express";
import { AdminOnly } from "@auth/decorators/admin-only.decorator";
import { UserDto } from "@auth/dto/user.dto";
import { CurationService } from "./curation.service";
import {
  FeaturedReleaseDto,
  FeaturedReleaseHistoryDto,
  SetFeaturedReleaseDto
} from "./dto/featured-release.dto";

interface RequestWithUser extends Request {
  user: UserDto;
}

@ApiTags("admin")
@Controller("admin/featured-release")
@AdminOnly()
export class AdminFeaturedReleaseController {
  constructor(private readonly curationService: CurationService) {}

  @Put()
  @ApiOperation({
    summary: "Feature a published project (replaces the current pick)"
  })
  @ApiBody({ type: SetFeaturedReleaseDto })
  @ApiResponse({
    status: 200,
    description: "The new featured release",
    type: FeaturedReleaseDto
  })
  @ApiResponse({ status: 400, description: "Project is not published" })
  @ApiResponse({ status: 404, description: "Project not found" })
  @HttpCode(HttpStatus.OK)
  async setFeatured(
    @Body() body: SetFeaturedReleaseDto,
    @Req() req: RequestWithUser
  ): Promise<FeaturedReleaseDto> {
    return this.curationService.setFeatured(
      body.projectId,
      req.user.id,
      body.note
    );
  }

  @Delete()
  @ApiOperation({ summary: "Clear the current featured release" })
  @ApiResponse({ status: 204, description: "No featured release remains" })
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearFeatured(): Promise<void> {
    await this.curationService.clearFeatured();
  }

  @Get("history")
  @ApiOperation({ summary: "List past and current featured releases" })
  @ApiQuery({ name: "page", type: "number", required: false })
  @ApiQuery({ name: "limit", type: "number", required: false })
  @ApiResponse({
    status: 200,
    description: "Featured releases, newest first",
    type: FeaturedReleaseHistoryDto
  })
  async getHistory(
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ): Promise<FeaturedReleaseHistoryDto> {
    return this.curationService.getHistory(
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined
    );
  }
}
