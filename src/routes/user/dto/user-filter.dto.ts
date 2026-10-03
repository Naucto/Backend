import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { MAX_PAGE_SIZE, PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const USER_SORT_FIELDS = ['id', 'username', 'email', 'createdAt'] as const;
export const DEFAULT_USER_PAGE_SIZE = 10;

export class UserFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Items per page',
    example: DEFAULT_USER_PAGE_SIZE,
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
    description: 'Free-text search over username and nickname',
  })
  @IsOptional()
  @IsString()
  // eslint-disable-next-line id-length -- the query parameter clients already send as ?q=
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by nickname' })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional({ description: 'Filter by email' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    description: 'Sort by field',
  })
  @IsOptional()
  @IsEnum(USER_SORT_FIELDS)
  sortBy?: (typeof USER_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Sort order' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
