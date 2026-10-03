import { Controller, Get, HttpStatus, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/access/access.decorators';
import { DEFAULT_PAGE_SIZE } from '../../common/dto/pagination-query.dto';
import { ProjectExResponseDto } from '../project/dto/project-response.dto';
import { HubService } from '../project/hub.service';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicUserSearchResponseDto } from './dto/public-user-search.dto';
import { ProfileAssetService } from './profile-asset.service';
import { PublicProfile, UserService } from './user.service';

/** A suggestion panel shows a handful of people; asking for more is asking for a results page. */
const MAX_SEARCH_LIMIT = 10;

@ApiTags('users')
@Controller('users/public')
export class UserPublicController {
  constructor(
    private readonly userService: UserService,
    private readonly profileAssetService: ProfileAssetService,
    private readonly hubService: HubService,
  ) {}

  private async toProfileResponse(profile: PublicProfile): Promise<PublicUserProfileResponseDto> {
    const imageUrls = await this.profileAssetService.imageUrls(profile.id);
    const totals = await this.hubService.fetchUserTotals(profile.id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Public user profile retrieved successfully',
      data: {
        ...profile,
        ...totals,
        ...imageUrls,
      },
    };
  }

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Find people by handle or display name' })
  @ApiQuery({ name: 'q', type: 'string', description: 'What was typed' })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Matching people, exact handle first',
    type: PublicUserSearchResponseDto,
  })
  async search(
    @Query('q') query?: string,
    @Query('limit') limit?: string,
  ): Promise<PublicUserSearchResponseDto> {
    const term = query?.trim() ?? '';
    const take = Math.min(
      Math.max(parseInt(limit ?? '', 10) || MAX_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );

    // An empty term matches every account, which is not a search result.
    const hits = term ? await this.userService.searchPublic(term, take) : [];
    const data = await Promise.all(
      hits.map(async (hit) => ({
        ...hit,
        profileImageUrl: await this.profileAssetService.url(hit.id, 'profile'),
      })),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Users retrieved successfully',
      data,
    };
  }

  @Public()
  @Get(':id/profile')
  @ApiOperation({ summary: 'Get a public user profile by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the public user profile',
    type: PublicUserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  async getPublicProfile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PublicUserProfileResponseDto> {
    return this.toProfileResponse(await this.userService.findPublicProfile(id));
  }

  @Public()
  @Get('username/:username/profile')
  @ApiOperation({ summary: 'Get a public user profile by username' })
  @ApiParam({ name: 'username', description: 'Username' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the public user profile',
    type: PublicUserProfileResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  async getPublicProfileByUsername(
    @Param('username') username: string,
  ): Promise<PublicUserProfileResponseDto> {
    return this.toProfileResponse(await this.userService.findPublicProfileByUsername(username));
  }

  @Public()
  @Get(':id/likes')
  @ApiOperation({ summary: "Get a user's liked published games" })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiQuery({
    name: 'page',
    type: 'number',
    required: false,
  })
  @ApiQuery({
    name: 'limit',
    type: 'number',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the list of published games liked by the user',
    type: [ProjectExResponseDto],
  })
  async getLikedGames(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ProjectExResponseDto[]> {
    return this.hubService.fetchLikedPublishedGamesByUser(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : DEFAULT_PAGE_SIZE,
    );
  }

  @Public()
  @Get(':id/published-games')
  @ApiOperation({ summary: "Get a user's published games" })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiQuery({
    name: 'page',
    type: 'number',
    required: false,
  })
  @ApiQuery({
    name: 'limit',
    type: 'number',
    required: false,
  })
  @ApiQuery({
    name: 'ownedOnly',
    type: 'string',
    required: false,
    description: 'Only the games this user owns, rather than every game they are credited on',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the list of games published by the user',
    type: [ProjectExResponseDto],
  })
  async getPublishedGames(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('ownedOnly') ownedOnly?: string,
  ): Promise<ProjectExResponseDto[]> {
    return this.hubService.fetchPublishedGamesByUser(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : DEFAULT_PAGE_SIZE,
      ownedOnly === 'true',
    );
  }

  @Public()
  @Get(':id/collaborations')
  @ApiOperation({ summary: 'Get published games the user collaborated on' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Games the user helped build but does not own',
    type: [ProjectExResponseDto],
  })
  async getCollaborations(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ProjectExResponseDto[]> {
    return this.hubService.fetchCollaborationsByUser(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : DEFAULT_PAGE_SIZE,
    );
  }

  @Public()
  @Get(':id/remixes')
  @ApiOperation({ summary: "Get published games remixed from this user's" })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Games other people forked from one of this user's",
    type: [ProjectExResponseDto],
  })
  async getRemixes(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ProjectExResponseDto[]> {
    return this.hubService.fetchRemixesOfUser(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : DEFAULT_PAGE_SIZE,
    );
  }
}
