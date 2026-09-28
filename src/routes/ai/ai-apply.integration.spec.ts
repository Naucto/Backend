import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "@ourPrisma/prisma.service";
import * as Y from "yjs";
import { AiService } from "./ai.service";
import { AiApplyService } from "./ai-apply.service";
import { recordSavedAiProvenance } from "./ai-provenance";
import { AiJobsService } from "./ai-jobs.service";
import { ConfigService } from "@nestjs/config";
import { AiConnection } from "@prisma/client";

const integration = process.env["AI_INTEGRATION"] === "1" ? describe : describe.skip;
integration("AI application PostgreSQL integration", () => {
  let prisma: PrismaService;
  let ai: AiService;
  let apply: AiApplyService;
  let userId: number;
  let projectId: number;
  const save = jest.fn(async (id: number, file: { buffer: Buffer }) => {
    await recordSavedAiProvenance(prisma, id, file.buffer);
  });
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
      AiApplyService, { provide: AiService, useValue: ai }, { provide: PrismaService, useValue: prisma },
      { provide: ModuleRef, useValue: { get: (): { save: typeof save } => ({ save }) } }
    ] }).compile();
    apply = module.get(AiApplyService);
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

  it("applies to the caller's own document without costing anyone else their work", async () => {
    const before = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    const { update, categories } = await apply.apply(projectId, userId, proposalId, contentHash, before);
    expect(categories).toEqual(["CODE"]);

    // The peer that matters: it never received the keystrokes the acceptor made before pressing
    // accept, and it has unsent edits of its own. A `code` commit is a delete and a reinsert, so an
    // update cut against the acceptor's state vector gives this peer a delete it can apply and a
    // replacement whose origin it does not have — the file then reads as empty, or as the peer's own
    // text with the AI's gone, with the replacement in `store.pendingStructs`. A state carries its
    // own dependencies, so it lands whole and combines with what they had.
    const peerState = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    const acceptor = new Y.Doc();
    Y.applyUpdate(acceptor, Buffer.from(peerState, "base64"));
    const acceptorText = acceptor.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!;
    acceptorText.insert(acceptorText.length, " ACCEPTOR TYPED");
    const acceptorState = Buffer.from(Y.encodeStateAsUpdate(acceptor)).toString("base64");

    const second = await ai.propose(connection, {
      title: "colleague behind",
      summary: "x",
      snapshotHash: (await ai.context(projectId, userId, { run: randomUUID() })).hash,
      operations: [{ kind: "code", fileId: "main", before: acceptorText.toString(), after: "AI final" }],
    });
    const { update: secondUpdate } = await apply.apply(projectId, userId, second.id, second.contentHash, acceptorState);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Buffer.from(peerState, "base64"));
    peer.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!.insert(0, "PEER ");
    Y.applyUpdate(peer, Buffer.from(secondUpdate, "base64"));
    const peerText = (peer.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString();
    expect(peerText).toContain("AI final");
    expect(peerText).toContain("PEER");
    expect(peerText).not.toBe("");
    peer.destroy();
    acceptor.destroy();

    Y.applyUpdate(document, Buffer.from(update, "base64"));
    expect((document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString()).toBe("new");
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("APPLIED");
  });

  it("refuses a proposal whose content moved after it was reviewed, and one already taken", async () => {
    const state = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const fresh = await ai.propose(connection, { title: "stale hash", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "new", after: "newer" }] });
    // The exact proposal that was reviewed is what gets applied; anything else is a different
    // document, and accepting it would apply a change nobody looked at.
    await expect(apply.apply(projectId, userId, fresh.id, "f".repeat(64), state)).rejects.toThrow("review it again");
    // The same proposal cannot be taken twice.
    await expect(apply.apply(projectId, userId, proposalId, contentHash, state)).rejects.toThrow("already reviewed");
  });

  it("refuses a change to code that moved underneath, instead of merging over it", async () => {
    save.mockImplementation(async () => undefined);
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const proposal = await ai.propose(connection, { title: "stale", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "something else entirely", after: "newer" }] });
    // The document has moved on since the proposal was written, so the operation's `before` no
    // longer matches. This is what the old barrier existed to catch, and it is caught here.
    await expect(apply.apply(projectId, userId, proposal.id, proposal.contentHash, Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64"))).rejects.toThrow("Code changed");
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PENDING");
  });

  it("hands the proposal back when storage refuses the write, instead of reporting it applied", async () => {
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const proposal = await ai.propose(connection, { title: "save fails", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "new", after: "written anyway?" }] });
    const state = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");

    save.mockImplementationOnce(async () => {
      throw new Error("S3 unavailable");
    });
    await expect(apply.apply(projectId, userId, proposal.id, proposal.contentHash, state)).rejects.toThrow("S3 unavailable");

    // The change is not in the project, so it must not be recorded as applied, and it must still be
    // possible to accept once storage recovers. The inverse goes too: a proposal that was never
    // applied has nothing to revert, and a row claiming otherwise is a dead end somebody reads as
    // real.
    const stored = await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stored.status).toBe("PENDING");
    expect(stored.reviewedBy).toBeNull();
    expect(stored.inverse).toBeNull();
    save.mockImplementation(async () => undefined);
    await expect(apply.apply(projectId, userId, proposal.id, proposal.contentHash, state)).resolves.toMatchObject({ categories: ["CODE"] });
  });

  it("says so when storage fails and the claim cannot be released", async () => {
    // `save` uploads and then writes, so it can fail with the blob already stored. The claim is then
    // released anyway, and if that release cannot be confirmed the proposal is left recorded as
    // applied with nothing behind it: it can neither be applied again nor reverted. Silent, that is
    // a state nobody finds until somebody needs the undo.
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const proposal = await ai.propose(connection, { title: "unreleasable", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "new", after: "never stored" }] });
    const state = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    const logged: string[] = [];
    const logger = jest.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    // The first save fails, and the release that follows fails with it. The claim is a different
    // `updateMany` — a rejected one there would stop the call before `save` is ever reached — so
    // only the release is made to fail.
    save.mockImplementationOnce(async () => {
      throw new Error("S3 unavailable");
    });
    const real = prisma.aiProposal.updateMany.bind(prisma.aiProposal);
    const failure = jest.spyOn(prisma.aiProposal, "updateMany").mockImplementation((async (args: never) => {
      const releasing = (args as { data?: { status?: string } }).data?.status === "PENDING";
      if (releasing) throw new Error("database gone");
      return real(args);
    }) as never);
    try {
      await expect(apply.apply(projectId, userId, proposal.id, proposal.contentHash, state)).rejects.toThrow("S3 unavailable");
      expect(logged.join(" ")).toContain("recorded as applied but its document was not stored");
      expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("APPLIED");
    } finally {
      failure.mockRestore();
      logger.mockRestore();
      save.mockImplementation(async () => undefined);
    }
  });

  it("previews without touching anything", async () => {
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const proposal = await ai.propose(connection, { title: "preview", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: "new", after: "previewed" }] });
    const current = (document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString();
    const { result } = await apply.preview(projectId, userId, proposal.id, Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64"));
    const shown = new Y.Doc();
    Y.applyUpdate(shown, Buffer.from(result, "base64"));
    expect((shown.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString()).toBe("previewed");
    // Nothing was written: the document on the client and the proposal are both as they were.
    expect((document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString()).toBe(current);
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PENDING");
    shown.destroy();
  });

  it("stores the inverse when accepting, so the revert is a reviewed proposal", async () => {
    const applied = await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(applied.inverse).toEqual([{ kind: "code", fileId: "main", before: "new", after: "old" }]);
    const revert = await ai.proposeRevert(projectId, userId, proposalId);
    expect(await ai.proposeRevert(projectId, userId, proposalId)).toMatchObject({ id: revert.id });
  });

  it("applies a revert, including one that restores a declaration to the open state", async () => {
    // Reverting a removal re-adds a declaration that was open and carried no starting value, which
    // is what most declarations look like. Committed as an ordinary proposal that is a no-op and is
    // refused; a revert has to be committed as the inverse it was recorded as.
    const doc = new Y.Doc();
    doc.getMap("net.permissions").set("secrets", { flags: 3 });
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    const removed = await ai.propose(connection, {
      title: "close a path",
      summary: "x",
      snapshotHash: (await ai.context(projectId, userId, { run: randomUUID() })).hash,
      operations: [{ kind: "net_permissions", path: "secrets", remove: true, expect: { flags: 3 } }],
    });
    const first = await apply.apply(projectId, userId, removed.id, removed.contentHash, state);
    const closed = new Y.Doc();
    Y.applyUpdate(closed, Buffer.from(first.update, "base64"));
    expect(closed.getMap("net.permissions").get("secrets")).toBeUndefined();

    const revert = await ai.proposeRevert(projectId, userId, removed.id);
    const restored = await apply.apply(projectId, userId, revert.id, revert.contentHash, first.update);
    const back = new Y.Doc();
    Y.applyUpdate(back, Buffer.from(restored.update, "base64"));
    // Open again: both bits set, which is what an undeclared path resolves to.
    expect(back.getMap("net.permissions").get("secrets")).toEqual({ flags: 3 });
    doc.destroy();
    closed.destroy();
    back.destroy();
  });

  it("still offers a revert of a declaration recorded before the expectation was required", async () => {
    // Operations were recorded in `inverse` before a declaration had to state what it expects to
    // find. Re-offered verbatim, such a revert shows a diff, then fails the moment it is accepted,
    // and the open revert is returned as-is so it can never be re-staged. The expectation is derived
    // from the forward operation instead, so the change stays revertible.
    const stored = await prisma.aiProposal.create({ data: {
      projectId, userId, title: "legacy", summary: "x", snapshotHash: "0".repeat(64), contentHash: "1".repeat(64), status: "APPLIED",
      // Deliberately no `expect`, and no `expect` on the forward operation's own inverse either.
      operations: [{ kind: "net_permissions", path: "legacy.path", clientWrite: false }] as never,
      inverse: [{ kind: "net_permissions", path: "legacy.path", expect: null, clientRead: true, clientWrite: true, default: null }],
    } });
    const revert = await ai.proposeRevert(projectId, userId, stored.id);
    const operations = (revert.operations ?? []) as Record<string, unknown>[];
    expect(operations[0]).toMatchObject({ kind: "net_permissions", path: "legacy.path", expect: null });
    await prisma.aiProposal.delete({ where: { id: stored.id } });
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
