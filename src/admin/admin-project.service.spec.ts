import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ModerationService } from "src/moderation/moderation.service";
import { AdminProjectService } from "./admin-project.service";
import { AdminProjectFilterDto } from "./dto/projects/admin-project-filter.dto";

const PROJECT = {
  id: 4,
  name: "Pong",
  shortDesc: "s",
  longDesc: null,
  tags: [],
  publishedTags: [],
  publishedName: null,
  publishedShortDesc: null,
  publishedLongDesc: null,
  status: "COMPLETED",
  iconUrl: null,
  monetization: "NONE",
  price: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  publishedAt: null,
  userId: 9,
  hidden: false,
  hiddenReason: null,
  hiddenAt: null,
  hiddenById: null,
  viewCount: 3,
  likes: 1
};

type PrismaMock = {
  project: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
};

type ModerationMock = {
  hideProject: jest.Mock;
  restoreProject: jest.Mock;
  unpublishProject: jest.Mock;
  editProject: jest.Mock;
};

function filter(overrides: Partial<AdminProjectFilterDto> = {}): AdminProjectFilterDto {
  return { ...overrides } as AdminProjectFilterDto;
}

describe("AdminProjectService", () => {
  let service: AdminProjectService;
  let prisma: PrismaMock;
  let moderation: ModerationMock;

  beforeEach(async () => {
    prisma = {
      project: {
        findMany: jest.fn().mockResolvedValue([PROJECT]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(PROJECT)
      }
    };
    moderation = {
      hideProject: jest.fn().mockResolvedValue(undefined),
      restoreProject: jest.fn().mockResolvedValue(undefined),
      unpublishProject: jest.fn().mockResolvedValue(undefined),
      editProject: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderation }
      ]
    }).compile();

    service = module.get<AdminProjectService>(AdminProjectService);
  });

  describe("list", () => {
    it("paginates with the shared defaults", async () => {
      const result = await service.list(filter());

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 })
      );
      expect(result.meta).toEqual({
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1
      });
    });

    it("searches names case-insensitively", async () => {
      await service.list(filter({ name: "pon" }));

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: "pon", mode: "insensitive" } }
        })
      );
    });

    it("filters on hidden === false rather than dropping the filter", async () => {
      await service.list(filter({ hidden: false }));

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { hidden: false } })
      );
    });

    it("defaults to newest-updated first", async () => {
      await service.list(filter());

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { updatedAt: "desc" } })
      );
    });

    it("rejects a sort field outside the allowlist", async () => {
      await expect(service.list(filter({ sortBy: "userId; DROP" }))).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe("findOne", () => {
    it("throws NotFoundException for an unknown project", async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.findOne(404)).rejects.toThrow(NotFoundException);
    });

    it("exposes the moderation fields the panel renders", async () => {
      await expect(service.findOne(4)).resolves.toMatchObject({
        id: 4,
        hidden: false,
        hiddenReason: null,
        createdAt: "2026-01-01T00:00:00.000Z"
      });
    });
  });

  describe("moderation actions", () => {
    // Every mutation goes through ModerationService so it lands in the audit
    // trail -- writing to prisma directly here would bypass it.

    it("hide delegates with the actor, reason and report", async () => {
      await service.hide(4, 1, "spam", 12);

      expect(moderation.hideProject).toHaveBeenCalledWith(4, 1, "spam", 12);
    });

    it("restore passes nulls when no reason or report is given", async () => {
      await service.restore(4, 1);

      expect(moderation.restoreProject).toHaveBeenCalledWith(4, 1, null, null);
    });

    it("unpublish delegates instead of updating the project itself", async () => {
      await service.unpublish(4, 1, "tos", 12);

      expect(moderation.unpublishProject).toHaveBeenCalledWith(4, 1, "tos", 12);
    });

    it("update separates the moderation reason from the patch", async () => {
      await service.update(4, { name: "Pong 2", reason: "rename" }, 1);

      expect(moderation.editProject).toHaveBeenCalledWith(
        4,
        1,
        { name: "Pong 2" },
        "rename"
      );
    });

    it("returns the re-read project so the panel sees the applied state", async () => {
      await expect(service.hide(4, 1)).resolves.toMatchObject({ id: 4 });
      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: 4 } });
    });
  });
});
