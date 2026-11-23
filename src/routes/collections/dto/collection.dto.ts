import { HttpStatus } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CollectionVisibility } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { IsId } from '../../../common/decorators/is-id';
import { MAX_PAGE_SIZE, PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { HubGameDto } from '../../project/dto/hub-game.dto';
import { UserBasicInfoDto } from '../../project/dto/project-response.dto';
import {
  COLLECTION_HIDDEN_CODE,
  COLLECTION_LIMIT_CODES,
  CollectionLimitCode,
} from '../collection.error';
import {
  COLLECTION_DESCRIPTION_MAX_LENGTH,
  COLLECTION_GAMES_MAX,
  COLLECTION_PREVIEW_GAMES,
  COLLECTION_SEARCH_MAX_LENGTH,
  COLLECTION_TITLE_MAX_LENGTH,
  COLLECTIONS_PAGE_SIZE,
} from '../collection-limits';

export const COLLECTION_SORTS = ['popular', 'recent', 'games'] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export class CreateCollectionDto {
  @ApiProperty({ example: 'Couch co-op', maxLength: COLLECTION_TITLE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(COLLECTION_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({
    example: 'Games to play side by side.',
    type: String,
    nullable: true,
    maxLength: COLLECTION_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(COLLECTION_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    enum: CollectionVisibility,
    enumName: 'CollectionVisibility',
    default: CollectionVisibility.PRIVATE,
    description:
      'PUBLIC is listed and open to anyone, UNLISTED open to whoever holds its id, PRIVATE to its owner',
  })
  @IsOptional()
  @IsEnum(CollectionVisibility)
  visibility?: CollectionVisibility;
}

export class UpdateCollectionDto extends PartialType(CreateCollectionDto) {}

export class ReorderCollectionDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Games of the collection in their new order. One left out keeps its place after those listed',
    example: ['7c9e6679-7425-40de-944b-e07fc1f90ae7', 'c1a5f0de-3b7a-4f2e-9d6c-8e4b2a1f0c3d'],
    maxItems: COLLECTION_GAMES_MAX,
  })
  @IsArray()
  @ArrayMaxSize(COLLECTION_GAMES_MAX)
  @ArrayUnique()
  @IsId({ each: true })
  projectIds!: string[];
}

export class MyCollectionsQueryDto {
  @ApiPropertyOptional({
    description: 'A game: each collection then says whether it lists it',
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @IsOptional()
  @IsId()
  projectId?: string;
}

export class CollectionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Collections per page',
    example: COLLECTIONS_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  declare limit?: number;

  @ApiPropertyOptional({
    enum: COLLECTION_SORTS,
    default: 'popular',
    description:
      'popular: the most played games inside; recent: the newest collection; games: the most games',
  })
  @IsOptional()
  @IsIn(COLLECTION_SORTS)
  sort?: CollectionSort;

  @ApiPropertyOptional({
    description:
      'What was typed: only the collections whose title or description contains it, whatever the case, are listed. Blank means no search',
    maxLength: COLLECTION_SEARCH_MAX_LENGTH,
    example: 'co-op',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(COLLECTION_SEARCH_MAX_LENGTH)
  search?: string;
}

/** What every answer says of a collection, before its games. */
export class CollectionHeaderDto {
  @ApiProperty({ format: 'uuid', example: '6f1c2f4e-8a53-4c1c-9a57-2f0f6f0d6c11' })
  id!: string;

  @ApiProperty({ example: 'Couch co-op' })
  title!: string;

  @ApiProperty({ example: 'Games to play side by side.', type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: CollectionVisibility, enumName: 'CollectionVisibility' })
  visibility!: CollectionVisibility;

  @ApiProperty({
    example: null,
    description:
      'Set while moderation withholds the collection. Only its owner then reads it, and it takes no change but the removal of a game or its own deletion',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  hiddenAt!: Date | null;

  @ApiProperty({ type: UserBasicInfoDto })
  owner!: UserBasicInfoDto;

  @ApiProperty({ description: 'Games of it on the hub: the ones a reader is shown', example: 14 })
  gameCount!: number;

  @ApiProperty({ example: '2026-11-20T12:00:00Z' })
  createdAt!: Date;

  @ApiProperty({
    example: '2026-11-20T12:00:00Z',
    description: 'When it or its list of games last changed',
  })
  updatedAt!: Date;
}

/** A collection as a list shows it. */
export class CollectionPreviewDto extends CollectionHeaderDto {
  @ApiProperty({
    type: [HubGameDto],
    description: `Its first games on the hub, in order, ${COLLECTION_PREVIEW_GAMES} at most`,
    maxItems: COLLECTION_PREVIEW_GAMES,
  })
  games!: HubGameDto[];
}

export class MyCollectionDto extends CollectionPreviewDto {
  @ApiPropertyOptional({
    description:
      'Whether it lists the game asked about, on the hub or not. Absent when no game was asked about',
  })
  contains?: boolean;
}

/** A collection opened: every game of it a reader is shown. */
export class CollectionDto extends CollectionHeaderDto {
  @ApiProperty({ type: [HubGameDto], description: 'Its games on the hub, in order' })
  games!: HubGameDto[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Games it lists that left the hub, for its owner to remove. Always empty for anyone else',
    example: ['c1a5f0de-3b7a-4f2e-9d6c-8e4b2a1f0c3d'],
  })
  unavailableGameIds!: string[];
}

export class CollectionsPageDto {
  @ApiProperty({ type: [CollectionPreviewDto] })
  collections!: CollectionPreviewDto[];

  @ApiProperty({ description: 'Collections the list holds', example: 128 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: COLLECTIONS_PAGE_SIZE })
  limit!: number;
}

export class CollectionLimitDto {
  @ApiProperty({ example: HttpStatus.BAD_REQUEST })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({ enum: COLLECTION_LIMIT_CODES })
  code!: CollectionLimitCode;

  @ApiProperty({ example: '50 collections at most - delete one to create another' })
  message!: string;

  @ApiProperty({ example: 50, description: 'The count that is reached' })
  max!: number;
}

/** What a change answers the owner of a collection moderation withholds. */
export class CollectionHiddenDto {
  @ApiProperty({ example: HttpStatus.FORBIDDEN })
  statusCode!: number;

  @ApiProperty({ example: 'Forbidden' })
  error!: string;

  @ApiProperty({ enum: [COLLECTION_HIDDEN_CODE] })
  code!: typeof COLLECTION_HIDDEN_CODE;

  @ApiProperty({ example: 'This collection is hidden by moderation' })
  message!: string;
}
