import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MAX_PAGE_SIZE, PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { HubGameDto } from '../../project/dto/hub-game.dto';
import { RELEASE_SORTS, ReleaseSort } from '../../project/hub.service';
import { HUB_SHELF_KEY_MAX_LENGTH, HUB_SHELF_KEYS_MAX, HUB_SHELF_SIZE } from '../hub-limits';
import { HUB_SHELF_KINDS, HubShelfKind } from '../hub-shelf-key';

export const HUB_REASONS = [
  'GAME_OF_THE_WEEK',
  'CONTINUE',
  'TRENDING',
  'NEW_AND_RISING',
  'FRIENDS_PLAY',
  'BECAUSE_YOU_PLAYED',
] as const;
export type HubReason = (typeof HUB_REASONS)[number];

export class HubReasonGameDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'Moon Lander' })
  name!: string;
}

export class HubHeroSlotDto {
  @ApiProperty({ enum: HUB_REASONS, description: 'Why this game is put forward' })
  reason!: HubReason;

  @ApiPropertyOptional({
    type: HubReasonGameDto,
    description: 'The game the reader played, for BECAUSE_YOU_PLAYED',
  })
  reasonGame?: HubReasonGameDto;

  @ApiProperty({ type: HubGameDto })
  game!: HubGameDto;
}

export class HubShelfDto {
  @ApiProperty({
    description: 'What names the shelf to the shelf routes',
    example: 'tag:Platformer',
  })
  key!: string;

  @ApiProperty({ enum: HUB_SHELF_KINDS })
  kind!: HubShelfKind;

  @ApiPropertyOptional({ description: 'The tag of a TAG shelf', example: 'Platformer' })
  tag?: string;

  @ApiProperty({ description: 'Games its "see all" lists', example: 57 })
  total!: number;

  @ApiProperty({
    type: [HubGameDto],
    description: `Its games in order: the first ${HUB_SHELF_SIZE} on the hub, one page in "see all"`,
  })
  games!: HubGameDto[];
}

export class HubResponseDto {
  @ApiProperty({ description: 'The UTC day these shelves were drawn for', example: '2026-11-20' })
  day!: string;

  @ApiProperty({
    type: [HubHeroSlotDto],
    description: 'Up to four games, each once, in the order the hero stacks them',
    maxItems: 4,
  })
  hero!: HubHeroSlotDto[];

  @ApiProperty({
    type: [HubShelfDto],
    description: 'The shelves the page opens on; one with nothing to show is left out',
  })
  shelves!: HubShelfDto[];

  @ApiProperty({
    type: [String],
    description: 'Keys of the shelves to fetch as the page scrolls, in order',
    example: ['tag:Platformer', 'tag:Puzzle'],
  })
  more!: string[];
}

export class HubShelvesResponseDto {
  @ApiProperty({
    type: [HubShelfDto],
    description: 'The shelves asked for, in the order asked; one with nothing to show is left out',
  })
  shelves!: HubShelfDto[];
}

export class HubShelfPageDto extends HubShelfDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: HUB_SHELF_SIZE })
  limit!: number;
}

export class HubShelvesQueryDto {
  @ApiProperty({
    type: String,
    description: `Comma-separated shelf keys, ${HUB_SHELF_KEYS_MAX} at most`,
    example: 'tag:Platformer,tag:Puzzle',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(HUB_SHELF_KEYS_MAX)
  @IsString({ each: true })
  @MaxLength(HUB_SHELF_KEY_MAX_LENGTH, { each: true })
  keys!: string[];
}

export class HubShelfPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Games per page',
    example: HUB_SHELF_SIZE,
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
    enum: RELEASE_SORTS,
    description: "Defaults to the shelf's own order: the draw of the day, or the most played",
  })
  @IsOptional()
  @IsIn(RELEASE_SORTS)
  sort?: ReleaseSort;
}
