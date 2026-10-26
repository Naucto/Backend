import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AiWorkspaceMcpController } from "./ai-workspace.controller";
import { AiMcpController } from "./ai.controller";
import { AiJobsService } from "./ai-jobs.service";
import { AddressInfo } from "node:net";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AiService } from "./ai.service";
import { AiWorkspaceService } from "./ai-workspace.service";
import { S3Service } from "@s3/s3.service";
import { Game } from "@naucto/engine/headless";
import * as Y from "yjs";
import { decodeSave, encodeSave, saveHash, saveUnits } from "./ai-save";
import { recordSavedAiProvenance } from "./ai-provenance";
import { randomUUID } from "node:crypto";

const integration = process.env["AI_WORKSPACE_INTEGRATION"] === "1" ? describe : describe.skip;
integration("AI working save PostgreSQL integration", () => {
  let prisma: PrismaService, ai: AiService, work: AiWorkspaceService;
  let userId: number, projectId: number, latest: string;
  const state = (text: string): string => {
    const doc = new Y.Doc();
    try { new Game(doc).addFile("main", text, "main"); return encodeSave(doc); } finally { doc.destroy(); }
  };
  beforeAll(async () => {
    const url = new URL(process.env["DATABASE_URL"] ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "55487") throw new Error("Use the disposable workspace-test database");
    prisma = new PrismaService();
    const nonce = randomUUID();
    userId = (await prisma.user.create({ data: { username: nonce, email: `${nonce}@example.invalid` } })).id;
    projectId = (await prisma.project.create({ data: { name: "AI workspace test", shortDesc: "test", userId } })).id;
    latest = state("base");
    ai = new AiService(prisma, {} as S3Service);
    jest.spyOn(ai, "newestStoredSave").mockImplementation(async () => Buffer.from(latest, "base64"));
    work = new AiWorkspaceService(prisma, ai);
  });
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma?.$disconnect();
  });
  it("initializes once, allows only one concurrent write and survives a new service instance", async () => {
    const reads = await Promise.all([work.read(projectId), work.read(projectId)]);
    expect(reads.map(r => r["revision"])).toEqual([1, 1]);
    const writes = await Promise.allSettled([
      work.save(projectId, { revision: 1, snapshot: state("one") }),
      work.save(projectId, { revision: 1, snapshot: state("two") })
    ]);
    expect(writes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const other = new AiWorkspaceService(prisma, ai);
    expect((await other.read(projectId))["revision"]).toBe(2);
    expect(saveHash(saveUnits(latest))).toBe(saveHash(saveUnits(state("base"))));
  });
  it("does not settle before normal save, then atomically clears the reviewed AI work", async () => {
    const preview = await work.compare(projectId, latest);
    const prepared = await work.prepare(projectId, userId, { revision: 2, currentHash: String(preview["latestHash"]), snapshot: latest, accepted: ["code:main"], rejected: [] });
    const id = String(prepared["reviewId"]);
    await expect(work.confirm(projectId, userId, id)).rejects.toThrow(/Save the reviewed/);
    latest = String(prepared["snapshot"]);
    await recordSavedAiProvenance(prisma, projectId, Buffer.from(latest, "base64"));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).aiCategories).toContain("CODE");
    await work.confirm(projectId, userId, id);
    expect((await work.compare(projectId))["changes"]).toEqual([]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).aiCategories).toContain("CODE");
    expect(await prisma.aiSaveReview.findUnique({ where: { id } })).toMatchObject({ status: "CONFIRMED" });
    const doc = decodeSave(latest);
    try { expect(doc.getMap("ai.applied").has(id)).toBe(true); } finally { doc.destroy(); }
  });
  it("authenticates native-save HTTP routes, rejects stale writes and retires proposal creation", async () => {
    const module = await Test.createTestingModule({
      controllers: [AiWorkspaceMcpController, AiMcpController],
      providers: [
        { provide: AiWorkspaceService, useValue: work },
        { provide: AiService, useValue: ai },
        { provide: AiJobsService, useValue: {} }
      ]
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    try {
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}/ai/mcp`;
      const key = await ai.createKey(userId, "workspace integration");
      const headers = { authorization: `Bearer ${key.token}`, "x-naucto-project": String(projectId), "content-type": "application/json" };
      expect((await fetch(`${base}/workspace`)).status).toBe(401);
      expect((await fetch(`${base}/workspace`, { headers: { ...headers, "x-naucto-project": "0" } })).status).toBe(401);
      const before = await (await fetch(`${base}/workspace`, { headers })).json() as { revision: number };
      const written = await fetch(`${base}/workspace`, { method: "POST", headers, body: JSON.stringify({ revision: before.revision, snapshot: state("HTTP AI draft") }) });
      expect(written.status).toBe(201);
      const stale = await fetch(`${base}/workspace`, { method: "POST", headers, body: JSON.stringify({ revision: before.revision, snapshot: state("obsolete") }) });
      expect(stale.status).toBe(409);
      const invalid = await fetch(`${base}/workspace`, { method: "POST", headers, body: JSON.stringify({ revision: 1, approved: true }) });
      expect(invalid.status).toBe(400);
      const retired = await fetch(`${base}/proposals`, { method: "POST", headers, body: JSON.stringify({ title: "old", summary: "old", snapshotHash: "a".repeat(64), operations: [{ kind: "code" }] }) });
      expect(retired.status).toBe(410);
      expect((await fetch(`${base}/workspace/compare`, { headers })).status).toBe(200);
      expect(saveHash(saveUnits(latest))).not.toBe(saveHash(saveUnits(state("HTTP AI draft"))));
    } finally { await app.close(); }
  });

});
