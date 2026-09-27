import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "@ourPrisma/prisma.service";
import * as Y from "yjs";
import { AiService } from "./ai.service";
import { AiBarrierService } from "./ai-barrier.service";
import { recordSavedAiProvenance } from "./ai-provenance";
import { AiJobsService } from "./ai-jobs.service";
import { ConfigService } from "@nestjs/config";
import { AiConnection } from "@prisma/client";

const integration = process.env["AI_INTEGRATION"] === "1" ? describe : describe.skip;
integration("AI barrier PostgreSQL integration", () => {
  let prisma: PrismaService;
  let ai: AiService;
  let barriers: AiBarrierService;
  let userId: number;
  let projectId: number;
  const save = jest.fn();
  const a = randomUUID(), b = randomUUID();
  const document = new Y.Doc();
  let proposalId: string;
  let contentHash: string;
  let connection: AiConnection;
  let jobs: AiJobsService;
  const extraUserIds: number[] = [];

  beforeAll(async () => {
    const host = new URL(process.env["DATABASE_URL"] ?? "").hostname;
    if (!["localhost", "127.0.0.1"].includes(host)) throw new Error("Use a disposable local PostgreSQL instance");
    prisma = new PrismaService();
    const nonce = randomUUID();
    const user = await prisma.user.create({ data: { email: `${nonce}@example.invalid`, username: nonce } });
    userId = user.id;
    const project = await prisma.project.create({ data: { name: "AI integration", shortDesc: "test", userId } });
    projectId = project.id;
    ai = new AiService(prisma);
    const module = await Test.createTestingModule({ providers: [
      AiBarrierService, { provide: AiService, useValue: ai }, { provide: PrismaService, useValue: prisma },
      { provide: ModuleRef, useValue: { get: (): { save: typeof save } => ({ save }) } }
    ] }).compile();
    barriers = module.get(AiBarrierService);
    const file = new Y.Map<unknown>();
    document.getMap("code.files").set("main", file);
    file.set("text", new Y.Text("old"));
    const { token } = await ai.connect(projectId, userId);
    connection = await ai.connection(`Bearer ${token}`);
    jobs = new AiJobsService(prisma, ai, new ConfigService({ AI_SERVICE_SECRET: "service-secret", AI_JOBS_PER_PROJECT_HOUR: "2" }));
    const context = await ai.context(projectId, userId, { code: "old" });
    const proposal = await ai.propose(connection, { title: "test", summary: "change", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "old", after: "new" }] });
    proposalId = proposal.id;
    contentHash = proposal.contentHash;
  });

  afterAll(async () => {
    // Extra projects and users made by a test own rows the cascade below would trip over.
    await prisma.project.deleteMany({});
    await prisma.aiKey.deleteMany({});
    await prisma.user.deleteMany({ where: { OR: [{ id: userId }, { id: { in: extraUserIds } }] } });
    await prisma?.$disconnect();
    document.destroy();
  });

  it("requires all frozen snapshots and recovers a failed save without replaying edits", async () => {
    await barriers.heartbeat(projectId, userId, a);
    await barriers.heartbeat(projectId, userId, b);
    await expect(barriers.start(projectId, userId, proposalId, contentHash, [a])).rejects.toThrow("membership");
    const barrier = await barriers.start(projectId, userId, proposalId, contentHash, [a, b]);
    const encode = (): string => Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    await barriers.acknowledge(projectId, userId, a, barrier.id, encode());
    await expect(barriers.finish(projectId, userId, barrier.id)).rejects.toThrow("Waiting");
    document.getMap("gfx.sprites").set("0,0", 4);
    await barriers.acknowledge(projectId, userId, b, barrier.id, encode());
    save.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(barriers.finish(projectId, userId, barrier.id)).rejects.toThrow("storage unavailable");
    const persisted = await prisma.aiBarrier.findUniqueOrThrow({ where: { projectId } });
    expect(persisted.status).toBe("COMMITTING");
    await expect(barriers.abort(projectId, userId, barrier.id)).rejects.toThrow("Commit has started");
    save.mockImplementation(async (id: number, file: Express.Multer.File) => {
      await recordSavedAiProvenance(prisma, id, file.buffer);
    });
    const done = await barriers.finish(projectId, userId, barrier.id);
    expect(done.result).toBe(persisted.result);
    expect(done.status).toBe("APPLIED");
    const result = new Y.Doc();
    Y.applyUpdate(result, Buffer.from(done.result!, "base64"));
    expect(result.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!.toString()).toBe("new");
    expect(result.getMap("gfx.sprites").get("0,0")).toBe(4);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).aiCategories).toEqual(["CODE"]);
    const revert = await ai.proposeRevert(projectId, userId, proposalId);
    expect(revert.revertsId).toBe(proposalId);
    expect(revert.status).toBe("PENDING");
    result.destroy();
  });

  it("stores the inverse at commit so the revert is a reviewed proposal", async () => {
    const applied = await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(applied.inverse).toEqual([{ kind: "code", fileId: "main", before: "new", after: "old" }]);
    const revert = await ai.proposeRevert(projectId, userId, proposalId);
    expect(await ai.proposeRevert(projectId, userId, proposalId)).toMatchObject({ id: revert.id });
  });

  it("aborts before commit when a participant reports a late write", async () => {
    const context = await ai.context(projectId, userId, { code: "second" });
    const proposal = await ai.propose(connection, { title: "second", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "new", after: "newer" }] });
    await barriers.heartbeat(projectId, userId, a);
    await barriers.heartbeat(projectId, userId, b);
    const barrier = await barriers.start(projectId, userId, proposal.id, proposal.contentHash, [a, b]);
    await barriers.acknowledge(projectId, userId, a, barrier.id, Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64"));
    const reported = await barriers.violation(projectId, userId, a, barrier.id, "update after pause");
    expect(reported.status).toBe("ABORTED");
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PENDING");
    await expect(barriers.finish(projectId, userId, barrier.id)).rejects.toThrow("update after pause");
  });

  it("ignores late updates a snapshot already holds and aborts on one none holds", async () => {
    const encode = (doc: Y.Doc): string => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    const run = async (late: (base: Y.Doc) => string): Promise<string> => {
      const text = (document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString();
      const context = await ai.context(projectId, userId, { run: randomUUID() });
      const proposal = await ai.propose(connection, { title: "late", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: text, after: `${text}!` }] });
      await barriers.heartbeat(projectId, userId, a);
      await barriers.heartbeat(projectId, userId, b);
      const barrier = await barriers.start(projectId, userId, proposal.id, proposal.contentHash, [a, b]);
      await barriers.acknowledge(projectId, userId, a, barrier.id, encode(document));
      await barriers.acknowledge(projectId, userId, b, barrier.id, encode(document));
      await barriers.violation(projectId, userId, a, barrier.id, "update after pause", late(document));
      try {
        return (await barriers.finish(projectId, userId, barrier.id)).status;
      } catch (error) {
        return (error as Error).message;
      }
    };
    // Snapshots store the text at the ack; apply the committed result to our copy for the next run.
    save.mockImplementation(async () => undefined);
    expect(await run(doc => encode(doc))).toBe("APPLIED");
    const state = await prisma.aiBarrier.findUniqueOrThrow({ where: { projectId } });
    Y.applyUpdate(document, Buffer.from(state.result!, "base64"));
    const detached = (): string => {
      const other = new Y.Doc();
      Y.applyUpdate(other, Y.encodeStateAsUpdate(document));
      other.getMap("gfx.sprites").set("1,1", 2);
      const update = Buffer.from(Y.encodeStateAsUpdate(other, Y.encodeStateVector(document))).toString("base64");
      other.destroy();
      return update;
    };
    expect(await run(() => detached())).toContain("no snapshot contains");
  });

  it("enforces the job quota, the service secret, and discards late cancelled results", async () => {
    const first = await jobs.create(connection, "sprite", { prompt: "gem" });
    const second = await jobs.create(connection, "sprite", { prompt: "tree" });
    await expect(jobs.create(connection, "sprite", { prompt: "third" })).rejects.toThrow("quota");
    await expect(jobs.create(connection, "midi", { prompt: "loop" })).rejects.toThrow("Unknown generation kind");
    expect(() => jobs.assertService("wrong-secret-xx")).toThrow();
    expect(() => jobs.assertService("service-secret")).not.toThrow();
    expect(await jobs.claim(connection, first.id)).toBe(true);
    await jobs.cancelAsEditor(projectId, userId, first.id);
    const late = await jobs.complete(connection, first.id, { pixels: [] }, "pixellab:create-image-pixflux");
    expect(late.state).toBe("CANCELLED");
    expect(late.result).toBeNull();
    await jobs.cancel(projectId, second.id);
    expect(await jobs.claim(connection, second.id)).toBe(false);
    expect((await jobs.list(projectId, userId)).map(job => job.state).sort()).toEqual(["CANCELLED", "CANCELLED"]);
  });

  it("gives a long-lived key exactly the projects it was linked to, and no more", async () => {
    const made = await ai.createKey(userId, "Test client");
    expect(made.token).toMatch(/^naucto_k_[a-f0-9]{64}$/);
    expect(made.expiresAt).toBeNull();
    const auth = `Bearer ${made.token}`;

    // Not linked yet: refused, and it says so rather than reaching a project by accident.
    await expect(ai.connection(auth)).rejects.toThrow("not linked");

    await ai.grantKey(userId, made.id, projectId);
    const resolved = await ai.connection(auth);
    expect(resolved.projectId).toBe(projectId);
    expect(resolved.userId).toBe(userId);
    // Never expiring still answers with a usable date, so nothing downstream has to special-case it.
    expect(resolved.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // A project it was not linked to stays out of reach, even named explicitly.
    const other = await prisma.project.create({ data: { name: "Other", shortDesc: "test", userId } });
    await expect(ai.connection(auth, String(other.id))).rejects.toThrow("not linked");

    // Two linked projects need the header: guessing one would read the wrong game.
    await ai.grantKey(userId, made.id, other.id);
    await expect(ai.connection(auth)).rejects.toThrow("several projects");
    expect((await ai.connection(auth, String(other.id))).projectId).toBe(other.id);

    // Unlinking one project is enough to stop it.
    await ai.revokeGrant(userId, made.id, other.id);
    expect((await ai.connection(auth)).projectId).toBe(projectId);

    // Revoking the key kills it everywhere at once.
    await ai.revokeKey(userId, made.id);
    await expect(ai.connection(auth)).rejects.toThrow();
    expect(await ai.listKeys(userId)).toHaveLength(0);
  });

  it("expires a key only when the user asked for a date", async () => {
    const soon = await ai.createKey(userId, "Week", 1);
    expect(soon.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    const listed = await ai.listKeys(userId);
    const found = listed.find(k => k.id === soon.id);
    expect(found?.expiresAt).toEqual(soon.expiresAt);
    await expect(ai.createKey(userId, "x", 0)).rejects.toThrow("Invalid expiry");
  });

  it("still refuses a key belonging to someone else", async () => {
    const other = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, username: randomUUID() } });
    extraUserIds.push(other.id);
    const theirs = await ai.createKey(other.id, "Theirs");
    await expect(ai.revokeKey(userId, theirs.id)).rejects.toThrow("No such key");
    await expect(ai.grantKey(userId, theirs.id, projectId)).rejects.toThrow("No such key");
  });

  it("refuses a project hint that contradicts the 8-hour token", async () => {
    const { token } = await ai.connect(projectId, userId);
    const other = await prisma.project.create({ data: { name: "Other", shortDesc: "test", userId } });
    const auth = `Bearer ${token}`;
    // The token names one project, so a hint naming another is a mistake: answering with the
    // token's own project is how a client ends up reading the wrong game without being told.
    await expect(ai.connection(auth, String(other.id))).rejects.toThrow();
    await expect(ai.connection(auth, "1, 2")).rejects.toThrow();
    await expect(ai.connection(auth, "01")).rejects.toThrow();
    expect((await ai.connection(auth)).projectId).toBe(projectId);
    expect((await ai.connection(auth, String(projectId))).projectId).toBe(projectId);
  });

  it("ignores a grant to a project the owner can no longer open", async () => {
    // The owner is a collaborator on both projects, not the creator, so access can be taken away.
    const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, username: randomUUID() } });
    extraUserIds.push(owner.id);
    const host = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, username: randomUUID() } });
    extraUserIds.push(host.id);
    const kept = await prisma.project.create({ data: { name: "Kept", shortDesc: "test", userId: host.id } });
    const theirs = await prisma.project.create({ data: { name: "Theirs", shortDesc: "test", userId: host.id } });
    for (const id of [kept.id, theirs.id])
      await prisma.project.update({ where: { id }, data: { collaborators: { connect: [{ id: owner.id }] } } });

    const made = await ai.createKey(owner.id, "Shared");
    await ai.grantKey(owner.id, made.id, kept.id);
    await ai.grantKey(owner.id, made.id, theirs.id);
    const auth = `Bearer ${made.token}`;
    await expect(ai.connection(auth)).rejects.toThrow("several projects");

    // Removing the owner from that project leaves the grant behind. It must stop counting: the
    // key resolves to the one project still open rather than demanding a header forever, and the
    // access does not return if the owner is added back.
    await prisma.project.update({ where: { id: theirs.id }, data: { collaborators: { disconnect: [{ id: owner.id }] } } });
    expect((await ai.connection(auth)).projectId).toBe(kept.id);
    await prisma.project.update({ where: { id: theirs.id }, data: { collaborators: { connect: [{ id: owner.id }] } } });
    await expect(ai.connection(auth)).rejects.toThrow("several projects");
  });

  it("caps how many live keys one account holds", async () => {
    const holder = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, username: randomUUID() } });
    extraUserIds.push(holder.id);
    for (let i = 0; i < 20; i++) await ai.createKey(holder.id, `Key ${String(i)}`);
    await expect(ai.createKey(holder.id, "One too many")).rejects.toThrow("Too many keys");
    // Revoking one makes room again, so the cap is a prompt to tidy up rather than a dead end.
    const [first] = await ai.listKeys(holder.id);
    await ai.revokeKey(holder.id, first!.id);
    await expect(ai.createKey(holder.id, "Replacement")).resolves.toMatchObject({ name: "Replacement" });
  });

  it("declarations only add categories", async () => {
    await jobs.declare(projectId, userId, ["SPRITES"], "Background painted with an external tool");
    const provenance = await jobs.provenance(projectId, userId);
    expect(provenance.categories.sort()).toEqual(["CODE", "SPRITES"]);
    expect(provenance.declarations).toHaveLength(1);
    expect(provenance.applied.some(item => item.id === proposalId)).toBe(true);
  });
});
