import { BadRequestException } from "@nestjs/common";
import { PaginationDto, PaginatedMetaDto } from "@common/dto/pagination.dto";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 25;

export type Page = {
  skip: number;
  take: number;
  page: number;
  limit: number;
};

export type Paginated<T> = {
  data: T[];
  meta: PaginatedMetaDto;
};

export function resolvePage(filter: PaginationDto): Page {
  const page = filter.page ?? DEFAULT_PAGE;
  const limit = filter.limit ?? DEFAULT_LIMIT;

  return { skip: (page - 1) * limit, take: limit, page, limit };
}

export function buildMeta(
  total: number,
  { page, limit }: Pick<Page, "page" | "limit">
): PaginatedMetaDto {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

export function buildOrderBy<TOrderBy>(
  filter: PaginationDto,
  allowedFields: readonly string[],
  defaultField: string
): TOrderBy {
  const sortBy = filter.sortBy ?? defaultField;

  if (!allowedFields.includes(sortBy)) {
    throw new BadRequestException(
      `Cannot sort by "${sortBy}". Allowed: ${allowedFields.join(", ")}`
    );
  }

  return { [sortBy]: filter.order ?? "desc" } as TOrderBy;
}

export function paginated<TRow, TDto>(
  rows: TRow[],
  total: number,
  page: Pick<Page, "page" | "limit">,
  toDto: (row: TRow) => TDto
): Paginated<TDto> {
  return { data: rows.map(toDto), meta: buildMeta(total, page) };
}
