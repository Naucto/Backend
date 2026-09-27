import { createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AiService } from "./ai.service";

describe("AI scoped proposals", () => {
  const prisma = {
    project: { findFirst: jest.fn() },
    aiConnection: { findUnique: jest.fn() },
    aiContext: { findUnique: jest.fn() },
    aiProposal: { updateMany: jest.fn(), create: jest.fn() }
  };
  let service: AiService;
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [AiService, { provide: PrismaService, useValue: prisma }]
    }).compile();
    service = module.get(AiService);
  });

  it("does not accept an ordinary JWT as an MCP credential", async () => {
    await expect(service.connection("Bearer ordinary.jwt.token")).rejects.toThrow(UnauthorizedException);
    expect(prisma.aiConnection.findUnique).not.toHaveBeenCalled();
  });

  it("rejects expired credentials and looks up only their digest", async () => {
    const token = `naucto_ai_${"a".repeat(64)}`;
    prisma.aiConnection.findUnique.mockResolvedValue({ expiresAt: new Date(0) });
    await expect(service.connection(`Bearer ${token}`)).rejects.toThrow(UnauthorizedException);
    expect(prisma.aiConnection.findUnique).toHaveBeenCalledWith({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  });

  it("rechecks project access for every credential use", async () => {
    prisma.aiConnection.findUnique.mockResolvedValue({ projectId: 1, userId: 2, expiresAt: new Date(Date.now() + 60000) });
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.connection(`Bearer naucto_ai_${"a".repeat(64)}`)).rejects.toThrow("Project unavailable");
  });

  it("cannot reject another project's proposal or a different reviewed hash", async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 1 });
    prisma.aiProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.review(1, 2, "proposal", { decision: "REJECTED", contentHash: "b".repeat(64) })).rejects.toThrow(ConflictException);
    expect(prisma.aiProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "proposal", projectId: 1, contentHash: "b".repeat(64), status: "PENDING" },
      data: { status: "REJECTED", reviewedBy: 2 }
    });
  });

  it("approves only by applying under the barrier", async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.review(1, 2, "proposal", { decision: "APPROVED", contentHash: "b".repeat(64) })).rejects.toThrow("applying");
    expect(prisma.aiProposal.updateMany).not.toHaveBeenCalled();
  });
});
