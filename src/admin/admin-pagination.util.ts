import { BadRequestException } from "@nestjs/common";
import { AdminPaginationDto, PaginatedMetaDto } from "./dto/admin-pagination.dto";

export const ADMIN_DEFAULT_PAGE = 1;
export const ADMIN_DEFAULT_LIMIT = 25;

/** Prisma `skip`/`take` alongside the page numbers the response meta needs. */
export type AdminPage = {
  skip: number;
  take: number;
  page: number;
  limit: number;
};

/** A paginated admin listing: the mapped rows plus their page meta. */
export type AdminPaginated<T> = {
  data: T[];
  meta: PaginatedMetaDto;
};

export function resolvePage(filter: AdminPaginationDto): AdminPage {
  const page = filter.page ?? ADMIN_DEFAULT_PAGE;
  const limit = filter.limit ?? ADMIN_DEFAULT_LIMIT;

  return { skip: (page - 1) * limit, take: limit, page, limit };
}

export function buildMeta(
  total: number,
  { page, limit }: Pick<AdminPage, "page" | "limit">
): PaginatedMetaDto {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

/**
 * Builds a Prisma `orderBy` from the request's `sortBy`/`order`.
 *
 * `sortBy` arrives as a free-form string, so it is checked against the caller's
 * allowlist: an unknown column would otherwise reach Prisma and surface as a 500
 * instead of a 400.
 */
export function buildOrderBy<TOrderBy>(
  filter: AdminPaginationDto,
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

/** Shapes the `{ data, meta }` envelope every admin listing returns. */
export function paginated<TRow, TDto>(
  rows: TRow[],
  total: number,
  page: Pick<AdminPage, "page" | "limit">,
  toDto: (row: TRow) => TDto
): AdminPaginated<TDto> {
  return { data: rows.map(toDto), meta: buildMeta(total, page) };
}
