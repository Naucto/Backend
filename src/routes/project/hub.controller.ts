import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { Public, RequiresAuth } from '../../auth/access/access.decorators';
import { UserDto } from '../../auth/dto/user.dto';
import { ImageUrlResponseDto } from './dto/image-url-response.dto';
import { LikeResponseDto } from './dto/like-response.dto';
import {
  ForkProjectResponseDto,
  PaginatedProjectsResponseDto,
  ProjectExResponseDto,
  ProjectsCountResponseDto,
} from './dto/project-response.dto';
import { RegisterViewDto } from './dto/register-view.dto';
import { ReleaseTagsResponseDto } from './dto/release-tags-response.dto';
import { ViewResponseDto } from './dto/view-response.dto';
import type { PublishedProjectFilters, ReleaseSort, ReleaseWindow } from './hub.service';
import { HubService, RELEASE_SORTS, RELEASE_WINDOWS } from './hub.service';
import { ProjectId } from './project-id.decorator';
import { parseOptionalInt, parseTags } from './project-query';

interface RequestWithUser extends Request {
  user: UserDto;
}

/**
 * A suggestion list shows a handful of tags; a catalogue is a different screen. Not the number of
 * tags a project may carry, whatever the two happen to be.
 */
const TAG_SUGGESTIONS_MAX = 12;

@ApiTags('projects')
@Controller('projects')
@RequiresAuth()
export class HubController {
  constructor(private readonly hubService: HubService) {}

  private buildPublishedProjectFilters(
    search?: string,
    tags?: string,
    releaseWindow?: ReleaseWindow,
  ): PublishedProjectFilters {
    const filters: PublishedProjectFilters = {};
    const parsedTags = parseTags(tags);

    if (search) {
      filters.search = search;
    }

    if (parsedTags) {
      filters.tags = parsedTags;
    }

    if (releaseWindow && RELEASE_WINDOWS.includes(releaseWindow)) {
      filters.releaseWindow = releaseWindow;
    }

    return filters;
  }

  // `releases/:id` follows the literal `releases/…` routes, or it would take them.
  @Public()
  @Get('releases')
  @ApiOperation({
    summary: 'Get all released projects',
  })
  @ApiResponse({
    status: 200,
    description: 'A JSON array of projects with collaborators and creator information',
    type: [ProjectExResponseDto],
  })
  async getAllReleases(): Promise<ProjectExResponseDto[]> {
    return this.hubService.fetchPublishedGames();
  }

  @Public()
  @Get('releases/paginated')
  @ApiOperation({
    summary: 'Get released projects with pagination',
  })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiQuery({ name: 'search', type: 'string', required: false })
  @ApiQuery({
    name: 'tags',
    type: 'string',
    required: false,
    description: 'Comma-separated tag list',
  })
  @ApiQuery({ name: 'releaseWindow', enum: RELEASE_WINDOWS, required: false })
  @ApiQuery({
    name: 'sort',
    enum: RELEASE_SORTS,
    required: false,
    description: 'Shelf ordering; defaults to newest first',
  })
  @ApiResponse({
    status: 200,
    description: 'A paginated list of released projects',
    type: PaginatedProjectsResponseDto,
  })
  async getPaginatedReleases(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string,
    @Query('releaseWindow') releaseWindow?: ReleaseWindow,
    @Query('sort') sort?: ReleaseSort,
  ): Promise<PaginatedProjectsResponseDto> {
    return this.hubService.fetchPublishedGamesPaginated(
      parseOptionalInt(page),
      parseOptionalInt(limit),
      this.buildPublishedProjectFilters(search, tags, releaseWindow),
      RELEASE_SORTS.includes(sort as ReleaseSort) ? (sort as ReleaseSort) : 'fresh',
    );
  }

  @Public()
  @Get('releases/tags')
  @ApiOperation({
    summary: 'List the tags published games carry',
  })
  @ApiQuery({
    name: 'q',
    type: 'string',
    required: false,
    description: 'Narrow to tags holding this fragment',
  })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: 200,
    description: 'Tags, most used first',
    type: ReleaseTagsResponseDto,
  })
  async getReleaseTags(
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ): Promise<ReleaseTagsResponseDto> {
    const take = Math.min(
      Math.max(parseOptionalInt(limit) ?? TAG_SUGGESTIONS_MAX, 1),
      TAG_SUGGESTIONS_MAX,
    );

    return {
      tags: await this.hubService.fetchPublishedTags(query?.trim() ?? '', take),
    };
  }

  @Public()
  @Get('releases/count')
  @ApiOperation({
    summary: 'Count released projects with filters',
  })
  @ApiQuery({ name: 'search', type: 'string', required: false })
  @ApiQuery({
    name: 'tags',
    type: 'string',
    required: false,
    description: 'Comma-separated tag list',
  })
  @ApiQuery({
    name: 'releaseWindow',
    enum: RELEASE_WINDOWS,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'The total number of released projects matching the request',
    type: ProjectsCountResponseDto,
  })
  async countReleasedProjects(
    @Query('search') search?: string,
    @Query('tags') tags?: string,
    @Query('releaseWindow')
    releaseWindow?: ReleaseWindow,
  ): Promise<ProjectsCountResponseDto> {
    const total = await this.hubService.countPublishedGames(
      this.buildPublishedProjectFilters(search, tags, releaseWindow),
    );

    return { total };
  }

  @Public()
  @Get('releases/:id')
  @ApiOperation({
    summary: 'Get project release version',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Project release metadata',
    type: ProjectExResponseDto,
  })
  async getRelease(@ProjectId() id: number): Promise<ProjectExResponseDto> {
    const projectRelease = await this.hubService.fetchRelease(id);
    // Public, so a draft's name and people are nobody's business until it is on the hub.
    if (!projectRelease.publishedAt) {
      throw new NotFoundException(`Published project with ID ${id} not found`);
    }

    return projectRelease;
  }

  @Post('releases/:id/like')
  @ApiOperation({
    summary: 'Like a published project (idempotent, authenticated users only)',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Like status',
    type: LikeResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async likeProject(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<LikeResponseDto> {
    return this.hubService.likeProject(id, req.user.id);
  }

  @Delete('releases/:id/like')
  @ApiOperation({
    summary: 'Unlike a published project (authenticated users only)',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Like removed',
    type: LikeResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async unlikeProject(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<LikeResponseDto> {
    return this.hubService.unlikeProject(id, req.user.id);
  }

  @Get('releases/:id/like-status')
  @ApiOperation({
    summary: 'Get like status for a project (authenticated users only)',
  })
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Like status',
    type: LikeResponseDto,
  })
  async getLikeStatus(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<LikeResponseDto> {
    return this.hubService.getLikeStatus(id, req.user.id);
  }

  // Never reads the account: a play is tied to a viewer only through the visitor of a browser that
  // consented. Takes JSON sent as text/plain, like the analytics routes.
  @Public()
  @Post('releases/:id/view')
  @ApiOperation({
    summary: 'Count a play of a published project',
  })
  @ApiConsumes('text/plain', 'application/json')
  @ApiParam({ name: 'id', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Updated view count',
    type: ViewResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async registerReleaseView(
    @ProjectId() id: number,
    @Body() dto: RegisterViewDto,
    @Req() req: Request,
  ): Promise<ViewResponseDto> {
    return this.hubService.registerReleaseView(id, {
      visitorId: dto.visitorId ?? null,
      address: req.ip ?? '',
    });
  }

  @Public()
  @Get('public/:id/image')
  @ApiOperation({
    summary: "Get public CDN URL for a published project's image",
  })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Project ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the CDN URL for the project image',
    type: ImageUrlResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Project not found, not published, or has no image',
  })
  async getPublishedProjectImage(@ProjectId() id: number): Promise<ImageUrlResponseDto> {
    const url = await this.hubService.publishedCoverUrl(id);
    if (!url) {
      throw new NotFoundException('Not found');
    }

    return { url };
  }

  @Post(':id/fork')
  @ApiOperation({ summary: 'Fork a published project' })
  @ApiParam({
    name: 'id',
    type: 'number',
    description: 'Numeric ID of the published project to fork',
  })
  @ApiResponse({
    status: 201,
    description: 'Forked project created successfully',
    type: ForkProjectResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Project is not published' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @HttpCode(HttpStatus.CREATED)
  async fork(
    @ProjectId() id: number,
    @Req() req: RequestWithUser,
  ): Promise<ForkProjectResponseDto> {
    return await this.hubService.fork(id, req.user.id);
  }
}
