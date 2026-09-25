import { Test, TestingModule } from "@nestjs/testing";
import { ModerationActionType, ModerationTargetType } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Actor } from "@auth/actor";
import { AuditService } from "./audit.service";
import { commentRef, projectRef, userRef } from "./moderatable";

type PrismaMock = {
  moderationAction: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
};

const entry = (
  overrides: Partial<{
    id: number;
    targetType: ModerationTargetType;
    targetId: number;
    createdAt: Date;
  }> = {}
): Record<string, unknown> => ({
  id: 1,
  targetType: ModerationTargetType.PROJECT,
  targetId: 4,
  action: ModerationActionType.HIDE_PROJECT,
  actorId: 9,
  actor: { id: 9, username: "mod" },
  reason: null,
  reportId: null,
  createdAt: new Date("2026-01-02"),
  ...overrides
});

describe("AuditService", () => {
  let service: AuditService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      moderationAction: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0)
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }]
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe("refs", () => {
    it("addresses any moderatable thing the same way", () => {
      // One shape for every entity is what lets the log be generic.
      expect(projectRef(4)).toEqual({ type: "PROJECT", id: 4 });
      expect(commentRef({ id: 5 })).toEqual({ type: "COMMENT", id: 5 });
      expect(userRef(6)).toEqual({ type: "USER", id: 6 });
    });
  });

  describe("record", () => {
    it("writes the actor, target and reason", async () => {
      await service.record({
        ref: commentRef(5),
        actor: new Actor(9, ["Moderator"]),
        action: ModerationActionType.EDIT_COMMENT,
        reason: "slur",
        before: { content: "a" },
        after: { content: "b" }
      });

      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 9,
          targetType: "COMMENT",
          targetId: 5,
          action: "EDIT_COMMENT",
          reason: "slur"
        })
      });
    });

    it("accepts a bare actor id for system-initiated actions", async () => {
      await service.record({
        ref: projectRef(4),
        actor: null,
        action: ModerationActionType.HIDE_PROJECT
      });

      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorId: null })
      });
    });
  });

  describe("historyOf", () => {
    it("queries by the ref, newest first", async () => {
      await service.historyOf(projectRef(4), { skip: 0, take: 10 });

      expect(prisma.moderationAction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { targetType: "PROJECT", targetId: 4 },
          orderBy: { createdAt: "desc" },
          skip: 0,
          take: 10
        })
      );
    });
  });

  describe("lastActionOn", () => {
    it("returns the most recent entry", async () => {
      prisma.moderationAction.findMany.mockResolvedValue([entry()]);

      await expect(service.lastActionOn(projectRef(4))).resolves.toMatchObject({
        id: 1
      });
    });

    it("returns null for something never moderated", async () => {
      await expect(service.lastActionOn(projectRef(4))).resolves.toBeNull();
    });
  });

  describe("lastActionsOn", () => {
    it("keeps only the newest entry per target", async () => {
      // Listings need one row each; without the batch they would issue a query
      // per row.
      prisma.moderationAction.findMany.mockResolvedValue([
        entry({ id: 3, targetId: 4, createdAt: new Date("2026-03-01") }),
        entry({ id: 2, targetId: 4, createdAt: new Date("2026-02-01") }),
        entry({ id: 1, targetId: 5, createdAt: new Date("2026-01-01") })
      ]);

      const latest = await service.lastActionsOn([projectRef(4), projectRef(5)]);

      expect(latest.get("PROJECT:4")?.id).toBe(3);
      expect(latest.get("PROJECT:5")?.id).toBe(1);
    });

    it("does not query for an empty ref list", async () => {
      await expect(service.lastActionsOn([])).resolves.toEqual(new Map());
      expect(prisma.moderationAction.findMany).not.toHaveBeenCalled();
    });
  });

  describe("moderationStateOf", () => {
    // These three facts used to be duplicated as hiddenReason/hiddenAt/
    // hiddenById columns on every moderatable table; they are derived now.
    it("derives who hid a thing, when and why", async () => {
      prisma.moderationAction.findMany.mockResolvedValue([
        entry({ id: 7, targetId: 4 })
      ]);

      await expect(service.moderationStateOf(projectRef(4))).resolves.toEqual({
        action: "HIDE_PROJECT",
        reason: null,
        at: new Date("2026-01-02"),
        byId: 9,
        byLabel: "@mod"
      });
    });

    it("returns null for something never moderated", async () => {
      await expect(service.moderationStateOf(projectRef(4))).resolves.toBeNull();
    });

    it("reads only the newest entry, so a restore supersedes the hide", async () => {
      prisma.moderationAction.findMany.mockResolvedValue([
        entry({ id: 8, targetId: 4 })
      ]);

      await service.moderationStateOf(projectRef(4));

      expect(prisma.moderationAction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1, orderBy: { createdAt: "desc" } })
      );
    });
  });

  describe("moderationStatesOf", () => {
    it("resolves a state per target in one query", async () => {
      prisma.moderationAction.findMany.mockResolvedValue([
        entry({ id: 3, targetId: 4, createdAt: new Date("2026-03-01") }),
        entry({ id: 1, targetId: 5, createdAt: new Date("2026-01-01") })
      ]);

      const states = await service.moderationStatesOf([
        projectRef(4),
        projectRef(5)
      ]);

      expect(states.get("PROJECT:4")?.byLabel).toBe("@mod");
      expect(states.get("PROJECT:5")?.at).toEqual(new Date("2026-01-01"));
    });
  });
});
