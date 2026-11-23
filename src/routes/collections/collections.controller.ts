import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { Public, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithOptionalUser, RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { ProjectHiddenDto } from '../project/dto/project-hidden.dto';
import { CollectionsService } from './collections.service';
import {
  CollectionDto,
  CollectionHiddenDto,
  CollectionLimitDto,
  CollectionPreviewDto,
  CollectionsPageDto,
  CollectionsQueryDto,
  CreateCollectionDto,
  MyCollectionDto,
  MyCollectionsQueryDto,
  ReorderCollectionDto,
  UpdateCollectionDto,
} from './dto/collection.dto';

const NOT_FOUND =
  'No such collection, or one of someone else that is private or withheld by moderation';
const NOT_OWNER = 'The collection is not the caller’s';
const NOT_CHANGEABLE = `${NOT_OWNER} (no \`code\`), or it is theirs and moderation withholds it`;

@ApiTags('collections')
@ApiExtraModels(CollectionHiddenDto, ProjectHiddenDto)
@Controller('collections')
@RequiresAuth()
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'The public collections holding a game, a page at a time' })
  @ApiResponse({ status: HttpStatus.OK, type: CollectionsPageDto })
  async list(@Query() query: CollectionsQueryDto): Promise<CollectionsPageDto> {
    return this.collections.listPublic(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a collection' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CollectionDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid fields, or the caller holds as many collections as they may',
    type: CollectionLimitDto,
  })
  async create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateCollectionDto,
  ): Promise<CollectionDto> {
    return this.collections.create(req.user.id, dto);
  }

  // Public, and wider for whoever sends a valid token: an owner also reads their private one.
  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'A collection and its games',
    description:
      'One moderation withholds answers its owner alone, with `hiddenAt` set, and everyone else as a gap.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: CollectionDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: NOT_FOUND })
  async findOne(
    @Req() req: RequestWithOptionalUser,
    @Param('id', ParseIdPipe) id: string,
  ): Promise<CollectionDto> {
    return this.collections.findOne(id, req.user?.id ?? null);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change the title, the description or who may read a collection' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: CollectionDto })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: NOT_CHANGEABLE,
    type: CollectionHiddenDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: NOT_FOUND })
  async update(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionDto> {
    return this.collections.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a collection, withheld by moderation or not' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: NOT_OWNER })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: NOT_FOUND })
  async remove(@Req() req: RequestWithUser, @Param('id', ParseIdPipe) id: string): Promise<void> {
    await this.collections.remove(id, req.user.id);
  }

  @Put(':id/games')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder the games of a collection' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'A game named is not in it' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: NOT_CHANGEABLE,
    type: CollectionHiddenDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: NOT_FOUND })
  async reorder(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ReorderCollectionDto,
  ): Promise<void> {
    await this.collections.reorder(id, req.user.id, dto.projectIds);
  }

  @Put(':id/games/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Add a published game to a collection, last; no-op when it is there' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'projectId', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The collection lists as many games as it may',
    type: CollectionLimitDto,
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: `${NOT_CHANGEABLE}; or the game is one the caller works on and moderation withholds it`,
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CollectionHiddenDto) },
        { $ref: getSchemaPath(ProjectHiddenDto) },
      ],
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: `${NOT_FOUND}; or the game is not on the hub, a game of someone else that moderation withholds included`,
  })
  async addGame(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('projectId', ParseIdPipe) projectId: string,
  ): Promise<void> {
    await this.collections.addGame(id, req.user.id, projectId);
  }

  @Delete(':id/games/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a game from a collection; no-op when it is not there',
    description: 'Open on a collection moderation withholds, unlike every other change to it.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiParam({ name: 'projectId', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: NOT_OWNER })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: NOT_FOUND })
  async removeGame(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('projectId', ParseIdPipe) projectId: string,
  ): Promise<void> {
    await this.collections.removeGame(id, req.user.id, projectId);
  }
}

@ApiTags('collections')
@Controller('users')
export class UserCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @RequiresAuth()
  @Get('me/collections')
  @ApiOperation({ summary: "The caller's collections, private ones included" })
  @ApiResponse({ status: HttpStatus.OK, type: [MyCollectionDto] })
  async mine(
    @Req() req: RequestWithUser,
    @Query() query: MyCollectionsQueryDto,
  ): Promise<MyCollectionDto[]> {
    return this.collections.listMine(req.user.id, query.projectId);
  }

  @Public()
  @Get('public/:id/collections')
  @ApiOperation({ summary: "A user's public collections" })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User ID' })
  @ApiResponse({ status: HttpStatus.OK, type: [CollectionPreviewDto] })
  async publicOf(@Param('id', ParseIdPipe) id: string): Promise<CollectionPreviewDto[]> {
    return this.collections.listPublicOf(id);
  }
}
