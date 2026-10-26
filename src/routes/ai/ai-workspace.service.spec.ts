import { ConflictException, NotFoundException } from "@nestjs/common";
import { AiWorkspace } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Game } from "@naucto/engine/headless";
import * as Y from "yjs";
import { AiService } from "./ai.service";
import { AiWorkspaceService } from "./ai-workspace.service";
import { decodeSave, encodeSave, saveHash, saveUnits } from "./ai-save";

const makeSave = (text: string): string => {
  const doc = new Y.Doc();
  try { new Game(doc).addFile("main", text, "main"); return encodeSave(doc); } finally { doc.destroy(); }
};

describe("durable AI workspace lifecycle", () => {
  let row: AiWorkspace | null, latest: string;
  const reviews = new Map<string, Record<string, unknown>>();
  let service: AiWorkspaceService, prisma: Record<string, unknown>, ai: { newestStoredSave: jest.Mock; authorize: jest.Mock };
  beforeEach(() => {
    row = null; latest = makeSave("base"); reviews.clear();
    const db = {
      aiWorkspace: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
          row ??= { ...create, revision: 1, pendingReviewId: null, updatedAt: new Date() } as unknown as AiWorkspace;
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!row || Object.entries(where).some(([k, v]) => row![k as keyof AiWorkspace] !== v)) return { count: 0 };
          const revision = row.revision + ((data["revision"] as { increment?: number } | undefined)?.increment ?? 0);
          row = { ...row, ...data, revision } as AiWorkspace;
          return { count: 1 };
        })
      },
      aiSaveReview: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { reviews.set(String(data["id"]), { ...data, status: "PREPARED" }); return data; }),
        findFirst: jest.fn(async ({ where }: { where: { id: string; projectId: number } }) => {
          const result = reviews.get(where.id); return result?.["projectId"] === where.projectId ? result : null;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => reviews.set(where.id, { ...reviews.get(where.id), ...data })),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      project: { updateMany: jest.fn(async () => ({ count: 1 })) }
    };
    prisma = { ...db, $transaction: jest.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db)) };
    ai = { newestStoredSave: jest.fn(async () => Buffer.from(latest, "base64")), authorize: jest.fn(async () => undefined) };
    service = new AiWorkspaceService(prisma as unknown as PrismaService, ai as unknown as AiService);
  });
  it("persists AI edits across service instances without touching the user save", async () => {
    const opened = await service.read(1);
    const edited = await service.save(1, { revision: Number(opened["revision"]), operations: [{ kind: "code", fileId: "main", before: "base", after: "AI" }] });
    expect(edited["revision"]).toBe(2);
    const again = new AiWorkspaceService(prisma as unknown as PrismaService, ai as unknown as AiService);
    expect((await again.read(1))["snapshot"]).toBe(edited["snapshot"]);
    expect(saveHash(saveUnits(latest))).toBe(saveHash(saveUnits(makeSave("base"))));
    await expect(service.save(1, { revision: 1, snapshot: makeSave("stale") })).rejects.toBeInstanceOf(ConflictException);
  });
  it("rejects stale user-save hashes instead of applying obsolete conflict choices", async () => {
    await service.read(1); latest = makeSave("human");
    await expect(service.merge(1, 1, "0".repeat(64), {})).rejects.toBeInstanceOf(ConflictException);
    expect(row!.revision).toBe(1);
  });
  it("requires normal persistence before review confirmation and then resets accepted work", async () => {
    await service.read(1); await service.save(1, { revision: 1, snapshot: makeSave("AI") });
    const preview = await service.compare(1, latest);
    const prepared = await service.prepare(1, 7, { revision: 2, snapshot: latest, currentHash: String(preview["latestHash"]), accepted: ["code:main"], rejected: [] });
    const id = String(prepared["reviewId"]);
    expect((await service.readReview(1, 7, id)).snapshot).toBe(prepared.snapshot);
    await expect(service.confirm(1, 7, id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.save(1, { revision: 3, snapshot: makeSave("racing AI") })).rejects.toBeInstanceOf(ConflictException);
    latest = String(prepared["snapshot"]); // Ordinary save happens outside the AI API.
    expect((await service.confirm(1, 7, id))["confirmed"]).toBe(true);
    expect((await service.compare(1))["changes"]).toEqual([]);
    expect((await service.confirm(1, 7, id))["confirmed"]).toBe(true);
  });
  it("resets rejected work only after the reviewed user state is saved", async () => {
    await service.read(1); await service.save(1, { revision: 1, snapshot: makeSave("AI") });
    const prepared = await service.prepare(1, 7, { revision: 2, snapshot: latest, currentHash: saveHash(saveUnits(latest)), accepted: [], rejected: ["code:main"] });
    latest = String(prepared["snapshot"]);
    await service.confirm(1, 7, String(prepared["reviewId"]));
    expect(saveHash(saveUnits((await service.read(1))["snapshot"] as string))).toBe(saveHash(saveUnits(makeSave("base"))));
  });
  it("does not let a non-collaborator prepare or confirm a review", async () => {
    ai.authorize.mockRejectedValue(new NotFoundException());
    await expect(service.prepare(1, 99, { revision: 1, snapshot: latest, currentHash: saveHash(saveUnits(latest)), accepted: ["code:main"], rejected: [] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.confirm(1, 99, "unknown")).rejects.toBeInstanceOf(NotFoundException);
    expect(row).toBeNull();
  });
  it("keeps human locks and receipts when saving a raw AI snapshot", async () => {
    const human = decodeSave(latest);
    human.getMap("ai.locks").set("protected", { target: "map", resourceId: "0", x: 0, y: 0, width: 1, height: 1 });
    human.getMap("ai.applied").set("human-history", true); latest = encodeSave(human); human.destroy();
    await service.read(1);
    const output = await service.save(1, { revision: 1, snapshot: makeSave("AI") });
    const saved = decodeSave(String(output["snapshot"]));
    try { expect(saved.getMap("ai.locks").has("protected")).toBe(true); expect(saved.getMap("ai.applied").has("human-history")).toBe(true); }
    finally { saved.destroy(); }
  });
  it("refuses accepting raw snapshot changes to a protected map cell", async () => {
    const human = decodeSave(latest);
    human.getMap("ai.locks").set("protected", { target: "map", resourceId: "0", x: 0, y: 0, width: 1, height: 1 }); latest = encodeSave(human); human.destroy();
    await service.read(1);
    const draft = decodeSave(latest); new Game(draft).setTile(0, 0, 4);
    await service.save(1, { revision: 1, snapshot: encodeSave(draft) }); draft.destroy();
    await expect(service.prepare(1, 7, { revision: 2, snapshot: latest, currentHash: saveHash(saveUnits(latest)), accepted: ["graphics"], rejected: [] })).rejects.toBeInstanceOf(ConflictException);
  });
});
