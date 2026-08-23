import { BadRequestException } from "@nestjs/common";
import {
  buildMeta,
  buildOrderBy,
  paginated,
  resolvePage
} from "./admin-pagination.util";
import { AdminPaginationDto } from "./dto/admin-pagination.dto";

// A bare object rather than `new AdminPaginationDto()`: the class carries
// property defaults, and these cases are about the util's own fallbacks.
function filter(overrides: Partial<AdminPaginationDto> = {}): AdminPaginationDto {
  return { ...overrides } as AdminPaginationDto;
}

describe("admin pagination util", () => {
  describe("resolvePage", () => {
    it("defaults to page 1 / limit 25", () => {
      expect(resolvePage(filter())).toEqual({
        skip: 0,
        take: 25,
        page: 1,
        limit: 25
      });
    });

    it("converts page/limit into prisma skip/take", () => {
      expect(resolvePage(filter({ page: 4, limit: 10 }))).toEqual({
        skip: 30,
        take: 10,
        page: 4,
        limit: 10
      });
    });
  });

  describe("buildMeta", () => {
    it("reports the number of pages the total spans", () => {
      expect(buildMeta(42, { page: 2, limit: 10 })).toEqual({
        page: 2,
        limit: 10,
        total: 42,
        totalPages: 5
      });
    });

    it("reports one page when there is nothing to list", () => {
      // The panel renders a pager off this value; zero would read as "no pages".
      expect(buildMeta(0, { page: 1, limit: 25 }).totalPages).toBe(1);
    });
  });

  describe("buildOrderBy", () => {
    const allowed = ["id", "createdAt"] as const;

    it("falls back to the default field and descending order", () => {
      expect(buildOrderBy(filter(), allowed, "createdAt"))
        .toEqual({ createdAt: "desc" });
    });

    it("honours an allowed sort field and order", () => {
      expect(
        buildOrderBy(filter({ sortBy: "id", order: "asc" }), allowed, "createdAt")
      ).toEqual({ id: "asc" });
    });

    it("rejects a field outside the allowlist", () => {
      // sortBy is an unconstrained string on the DTO, so an unknown column would
      // otherwise reach Prisma and surface as a 500 instead of a 400.
      expect(() =>
        buildOrderBy(filter({ sortBy: "password" }), allowed, "createdAt")
      ).toThrow(BadRequestException);
    });
  });

  describe("paginated", () => {
    it("maps the rows and attaches the page meta", () => {
      const result = paginated(
        [{ id: 1 }, { id: 2 }],
        7,
        { page: 1, limit: 2 },
        (row) => ({ ref: `#${row.id}` })
      );

      expect(result).toEqual({
        data: [{ ref: "#1" }, { ref: "#2" }],
        meta: { page: 1, limit: 2, total: 7, totalPages: 4 }
      });
    });
  });
});
