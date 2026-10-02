import { createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { S3Service } from "@s3/s3.service";
import { Readable } from "node:stream";
import * as Y from "yjs";
import { AiService } from "./ai.service";

describe("AI scoped proposals", () => {
  const prisma = {
    project: { findFirst: jest.fn(), findMany: jest.fn() },
    aiKey: { findUnique: jest.fn(), update: jest.fn() },
    aiProposal: { updateMany: jest.fn(), create: jest.fn(), count: jest.fn() }
  };
  const s3 = { listObjects: jest.fn(), downloadFile: jest.fn() };
  /** A stored save whose main file reads `text`. */
  const saved = (text: string): Buffer => {
    const doc = new Y.Doc();
    const file = new Y.Map<unknown>();
    doc.getMap("code.files").set("main", file);
    file.set("text", new Y.Text(text));
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  };
  let service: AiService;
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: prisma },
        { provide: S3Service, useValue: s3 }
      ]
    }).compile();
    service = module.get(AiService);
  });

  /**
   * A key works whether or not anyone has the project open: the state it reads is the project's
   * last save, so a project nobody has touched in days is still workable.
   */
  it("works from a save nobody is editing right now", async () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 9);
    s3.listObjects.mockResolvedValue([{ Key: "save/7/a", LastModified: old }]);
    s3.downloadFile.mockResolvedValue({ body: Readable.from([saved("hello")]) });

    const stored = await service.storedContext({ projectId: 7 });

    expect(stored?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored?.content)).toContain("hello");
    // The age still travels, so an assistant can say how far back it is reasoning.
    expect(stored?.ageMs).toBeGreaterThanOrEqual(1000 * 60 * 60 * 24 * 9);
  });

  /** The one thing it will not do is invent a state for a project that was never saved. */
  it("says there is no state for a project that was never saved", async () => {
    s3.listObjects.mockResolvedValue([]);
    await expect(service.storedContext({ projectId: 7 })).resolves.toBeNull();
  });

  it("does not accept an ordinary JWT as an MCP credential", async () => {
    await expect(service.connection("Bearer ordinary.jwt.token")).rejects.toThrow(UnauthorizedException);
    expect(prisma.aiKey.findUnique).not.toHaveBeenCalled();
  });

  it("no longer accepts the 8-hour project token", async () => {
    await expect(service.connection(`Bearer naucto_ai_${"a".repeat(64)}`)).rejects.toThrow(UnauthorizedException);
    expect(prisma.aiKey.findUnique).not.toHaveBeenCalled();
  });

  it("rejects expired and revoked keys, looking up only their digest", async () => {
    const token = `naucto_k_${"a".repeat(64)}`;
    prisma.aiKey.findUnique.mockResolvedValue({ id: "k", userId: 1, expiresAt: new Date(0), revokedAt: null });
    await expect(service.connection(`Bearer ${token}`)).rejects.toThrow(UnauthorizedException);
    expect(prisma.aiKey.findUnique).toHaveBeenCalledWith({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    prisma.aiKey.findUnique.mockResolvedValue({ id: "k", userId: 1, expiresAt: null, revokedAt: new Date() });
    await expect(service.connection(`Bearer ${token}`)).rejects.toThrow(UnauthorizedException);
  });

  it("reaches only projects the account owns", async () => {
    prisma.aiKey.findUnique.mockResolvedValue({ id: "k", userId: 4, expiresAt: null, revokedAt: null, lastUsedAt: new Date() });
    prisma.project.findMany.mockResolvedValue([{ id: 9 }]);
    const connection = await service.connection(`Bearer naucto_k_${"a".repeat(64)}`, "9");
    expect(connection.projectId).toBe(9);
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 4, creator: { deletedAt: null }, id: 9 } }));
  });

  it("stages a change against a save older than a 32-bit count of milliseconds", async () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 40);
    s3.listObjects.mockResolvedValue([{ Key: "save/7/a", LastModified: old }]);
    s3.downloadFile.mockImplementation(async () => ({ body: Readable.from([saved("x")]) }));
    const stored = await service.storedContext({ projectId: 7 });
    prisma.aiProposal.count.mockResolvedValue(0);
    prisma.aiProposal.create.mockResolvedValue({ id: "p" });
    await service.propose({ projectId: 7, userId: 3, expiresAt: new Date() }, { title: "t", summary: "s", snapshotHash: stored!.hash, operations: [{ kind: "code", fileId: "main", before: "x", after: "y" }] });
    const data = (prisma.aiProposal.create.mock.calls[0]![0] as { data: { baseContextAgeMs: number } }).data;
    expect(data.baseContextAgeMs).toBe(2_147_483_647);
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

  it("approves only by applying", async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.review(1, 2, "proposal", { decision: "APPROVED", contentHash: "b".repeat(64) })).rejects.toThrow("applying");
    expect(prisma.aiProposal.updateMany).not.toHaveBeenCalled();
  });
});
