import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * `?page=&limit=` for a paginated list. A route whose default or cap differs extends this class
 * and redeclares the field, so the bounds stay declared where Swagger and validation read them.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Page number, from 1', example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

export interface SkipTake {
  skip: number;
  take: number;
}

/** The Prisma window for a page; `defaultLimit` is the route's own default page size. */
export function toSkipTake(
  query: PaginationQueryDto,
  defaultLimit: number = DEFAULT_PAGE_SIZE,
): SkipTake {
  const take = query.limit ?? defaultLimit;
  const page = query.page ?? 1;
  return { skip: (page - 1) * take, take };
}
