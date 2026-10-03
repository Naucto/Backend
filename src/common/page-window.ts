import { MAX_PAGE_SIZE, SkipTake, toSkipTake } from './dto/pagination-query.dto';

export type PageWindow = SkipTake & { page: number; limit: number };

/**
 * The page a lenient route serves, for `page`/`limit` that reach it unvalidated: a missing,
 * unparsable or non-positive value falls back to the first page or the route's default size, and
 * a size above the cap is cut to it, where `PaginationQueryDto` would answer 400. The echoed
 * `page` and `limit` are the ones actually served.
 */
export function pageWindow(
  page: number | undefined,
  limit: number | undefined,
  defaultLimit: number,
  maxLimit: number = MAX_PAGE_SIZE,
): PageWindow {
  const usable = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value >= 1;
  const window = {
    page: usable(page) ? Math.trunc(page) : 1,
    limit: usable(limit) ? Math.min(Math.trunc(limit), maxLimit) : defaultLimit,
  };

  return { ...window, ...toSkipTake(window) };
}
