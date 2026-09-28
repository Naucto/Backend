import { randomUUID } from "node:crypto";
import { BadRequestException, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "@ourPrisma/prisma.service";
import * as Y from "yjs";
import { AiService } from "./ai.service";
import { AiApplyService } from "./ai-apply.service";
import { recordSavedAiProvenance } from "./ai-provenance";
import { AiJobsService } from "./ai-jobs.service";
import { ConfigService } from "@nestjs/config";
import { AiConnection, AiProposal } from "@prisma/client";

const integration = process.env["AI_INTEGRATION"] === "1" ? describe : describe.skip;
integration("AI application PostgreSQL integration", () => {
  let prisma: PrismaService;
  let ai: AiService;
  let apply: AiApplyService;
  let userId: number;
  let projectId: number;
  /** What `ProjectService.save` does as far as this suite is concerned: store it, and record it. */
  const storeAndRecord = async (id: number, file: { buffer: Buffer }): Promise<void> => {
    await recordSavedAiProvenance(prisma, id, file.buffer);
  };
  const save = jest.fn(storeAndRecord);
  const documentState = (): string => Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
  const currentText = (): string => (document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString();
  /** A code proposal against whatever the document holds right now, so tests stand on their own. */
  const stageCode = async (title: string, after: string): Promise<AiProposal> => {
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    return ai.propose(connection, { title, summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: currentText(), after }] });
  };
  // Every test starts from the real behaviour. Overriding it and leaving the override behind makes
  // the next test's provenance assertions depend on receipts an earlier one happened to write.
  afterEach(() => {
    save.mockReset();
    save.mockImplementation(storeAndRecord);
  });
  const document = new Y.Doc();
  let proposalId: string;
  let contentHash: string;
  let connection: AiConnection;
  let jobs: AiJobsService;
  const extraUserIds: number[] = [];
  /** Every project this suite made, so it can clean up after itself and nothing else. */
  const createdProjectIds: number[] = [];
  const newProject = async (name: string, ownerId = userId): Promise<number> => {
    const project = await prisma.project.create({ data: { name, shortDesc: "test", userId: ownerId } });
    createdProjectIds.push(project.id);
    return project.id;
  };

  beforeAll(async () => {
    const host = new URL(process.env["DATABASE_URL"] ?? "").hostname;
    if (!["localhost", "127.0.0.1"].includes(host)) throw new Error("Use a disposable local PostgreSQL instance");
    prisma = new PrismaService();
    const nonce = randomUUID();
    const user = await prisma.user.create({ data: { email: `${nonce}@example.invalid`, username: nonce } });
    userId = user.id;
    projectId = await newProject("AI integration");
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
    // Only what this suite created. The host guard above admits a developer's own development
    // database, which is populated and worth keeping, and CI now sets AI_INTEGRATION — so a blanket
    // `deleteMany` here would empty whichever database was pointed at.
    await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    // Keys belong to the people this suite made, not to a project, so they are scoped by user.
    await prisma.aiKey.deleteMany({ where: { userId: { in: [userId, ...extraUserIds] } } });
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
    const state = documentState();
    const fresh = await stageCode("stale hash", `${currentText()} -- newer`);
    // The exact proposal that was reviewed is what gets applied; anything else is a different
    // document, and accepting it would apply a change nobody looked at.
    await expect(apply.apply(projectId, userId, fresh.id, "f".repeat(64), state)).rejects.toThrow("review it again");
    // The same proposal cannot be taken twice: apply it once, then offer it again.
    const once = await stageCode("taken once", `${currentText()} -- once`);
    await apply.apply(projectId, userId, once.id, once.contentHash, state);
    await expect(apply.apply(projectId, userId, once.id, once.contentHash, state)).rejects.toThrow("already reviewed");
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
    const proposal = await stageCode("save fails", `${currentText()} -- written anyway?`);
    const state = documentState();

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
    const proposal = await stageCode("unreleasable", `${currentText()} -- never stored`);
    const state = documentState();
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
    const current = currentText();
    const proposal = await stageCode("preview", "previewed");
    const { result } = await apply.preview(projectId, userId, proposal.id, documentState());
    const shown = new Y.Doc();
    Y.applyUpdate(shown, Buffer.from(result, "base64"));
    expect((shown.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString()).toBe("previewed");
    // Nothing was written: the document on the client and the proposal are both as they were.
    expect((document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString()).toBe(current);
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PENDING");
    shown.destroy();
  });

  it("stores the inverse when accepting, so the revert is a reviewed proposal", async () => {
    const mine = await stageCode("inverse", `${currentText()} -- inverse`);
    await apply.apply(projectId, userId, mine.id, mine.contentHash, documentState());
    const applied = await prisma.aiProposal.findUniqueOrThrow({ where: { id: mine.id } });
    expect(applied.inverse).toEqual([{ kind: "code", fileId: "main", before: `${currentText()} -- inverse`, after: currentText() }]);
    const revert = await ai.proposeRevert(projectId, userId, mine.id);
    expect(await ai.proposeRevert(projectId, userId, mine.id)).toMatchObject({ id: revert.id });
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

  it("answers a snapshot that is not a document with a 400, not a crash", async () => {
    // The snapshot arrives from the client and the DTO can only check the base64 alphabet, so bytes
    // that are not a Yjs update get this far. This is the only path to a mutation, so an unhandled
    // throw here is a 500 on somebody else's malformed request. Its own proposal, so the assertion
    // is about this call and does not lean on an earlier test having run.
    const proposal = await stageCode("junk snapshot", `${currentText()} -- written anyway?`);
    for (const junk of ["AQID", "AQ==", "not base64 at all !!!!"]) {
      // The type is the point, not the wording: a plain Error reaching the controller is a 500 on
      // somebody else's malformed request, whatever it is called.
      const thrown = await apply.apply(projectId, userId, proposal.id, proposal.contentHash, junk).then(() => null, (error: unknown) => error);
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getStatus()).toBe(400);
    }
    // Nothing was claimed, so it is still available once a real document is sent.
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("PENDING");
  });

  it("refuses to revert a change that removed something with no inverse, rather than half of it", async () => {
    // `delete_map` and `delete_sound` record no inverse, because putting back a level would mean
    // inventing its content. A revert of a proposal containing one would restore the rest and leave
    // that behind, and its operations would not mention it.
    const mixed = await ai.propose(connection, {
      title: "mixed change",
      summary: "x",
      snapshotHash: (await ai.context(projectId, userId, { run: randomUUID() })).hash,
      operations: [
        { kind: "code", fileId: "main", before: currentText(), after: `${currentText()} -- newer` },
        { kind: "delete_sound", id: "slot-3" },
      ],
    });
    await prisma.aiProposal.update({ where: { id: mixed.id }, data: { status: "APPLIED", inverse: [{ kind: "code", fileId: "main", before: "newer", after: "new" }] } });
    await expect(ai.proposeRevert(projectId, userId, mixed.id)).rejects.toThrow("cannot be put back automatically");
    // A change with no inverse at all is still its own, plainer refusal.
    await prisma.aiProposal.update({ where: { id: mixed.id }, data: { operations: [{ kind: "delete_sound", id: "slot-3" }] } });
    await expect(ai.proposeRevert(projectId, userId, mixed.id)).rejects.toThrow("cannot be put back automatically");
  });

  it("previews a revert the way it will be applied, so the two cannot disagree", async () => {
    // A revert restores a declaration to the state it had before, which committed as an ordinary
    // proposal reads as a no-op and is refused. `preview` and `apply` both commit a staged revert as
    // the inverse it was recorded as; if only one of them did, a person would be shown a diff and
    // then refused, or refused with no explanation.
    const doc = new Y.Doc();
    doc.getMap("net.permissions").set("secrets", { flags: 3 });
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    const removed = await ai.propose(connection, {
      title: "close a path",
      summary: "x",
      snapshotHash: (await ai.context(projectId, userId, { run: randomUUID() })).hash,
      operations: [{ kind: "net_permissions", path: "secrets", remove: true, expect: { flags: 3 } }],
    });
    const applied = await apply.apply(projectId, userId, removed.id, removed.contentHash, state);
    const revert = await ai.proposeRevert(projectId, userId, removed.id);

    // The preview shows the declaration coming back, so the accept is not going to be refused.
    const previewed = new Y.Doc();
    Y.applyUpdate(previewed, Buffer.from((await apply.preview(projectId, userId, revert.id, applied.update)).result, "base64"));
    expect(previewed.getMap("net.permissions").get("secrets")).toEqual({ flags: 3 });

    // And applying what was previewed produces the same state.
    const appliedRevert = await apply.apply(projectId, userId, revert.id, revert.contentHash, applied.update);
    const actual = new Y.Doc();
    Y.applyUpdate(actual, Buffer.from(appliedRevert.update, "base64"));
    expect(actual.getMap("net.permissions").get("secrets")).toEqual({ flags: 3 });
    doc.destroy();
    previewed.destroy();
    actual.destroy();
  });

  it("stages a revert against the same state, and says so when that state is old", async () => {
    const doc = new Y.Doc();
    doc.getMap("net.permissions").set("gate", { flags: 3 });
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const removed = await ai.propose(connection, {
      title: "close a path",
      summary: "x",
      snapshotHash: context.hash,
      operations: [{ kind: "net_permissions", path: "gate", remove: true, expect: { flags: 3 } }],
    });
    await apply.apply(projectId, userId, removed.id, removed.contentHash, state);
    const revert = await ai.proposeRevert(projectId, userId, removed.id);

    // A revert is written against the state the change it undoes was written against, so it reports
    // the same age rather than the column's default of zero — which would tell a person they are
    // looking at something that reaches back no further than the moment it was staged.
    expect(revert.baseContextAgeMs).toBe(removed.baseContextAgeMs);
    expect(revert.snapshotHash).toBe(removed.snapshotHash);
    doc.destroy();
  });

  it("refuses a proposal whose operations cannot be read, rather than reverting part of it", async () => {
    // Only `propose` writes operations and it always writes a list, so this needs a hand-edited row.
    // Reverting one anyway would restore whatever it could and say nothing about the rest, which is
    // the failure the non-invertible check exists to prevent — so the shape is refused as well.
    const stored = await prisma.aiProposal.create({ data: {
      projectId, userId, title: "odd operations", summary: "x", snapshotHash: "0".repeat(64), contentHash: "2".repeat(64), status: "APPLIED",
      operations: { kind: "delete_map" } as never,
      inverse: [{ kind: "code", fileId: "main", before: "new", after: "old" }],
    } });
    await expect(ai.proposeRevert(projectId, userId, stored.id)).rejects.toThrow("record cannot be read");
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
    const other = await newProject("Other");
    await expect(ai.connection(auth, String(other))).rejects.toThrow("not linked");

    // Two linked projects need the header: guessing one would read the wrong game.
    await ai.grantKey(userId, made.id, other);
    await expect(ai.connection(auth)).rejects.toThrow("several projects");
    expect((await ai.connection(auth, String(other))).projectId).toBe(other);

    // Unlinking one project is enough to stop it.
    await ai.revokeGrant(userId, made.id, other);
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
    const stranger = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, username: randomUUID() } });
    extraUserIds.push(stranger.id);
    const theirs = await ai.createKey(stranger.id, "Theirs");
    await expect(ai.revokeKey(userId, theirs.id)).rejects.toThrow("No such key");
    await expect(ai.grantKey(userId, theirs.id, projectId)).rejects.toThrow("No such key");
  });

  it("refuses a project hint that contradicts the 8-hour token", async () => {
    const { token } = await ai.connect(projectId, userId);
    const other = await newProject("Other");
    const auth = `Bearer ${token}`;
    // The token names one project, so a hint naming another is a mistake: answering with the
    // token's own project is how a client ends up reading the wrong game without being told.
    await expect(ai.connection(auth, String(other))).rejects.toThrow();
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
    const kept = await newProject("Kept", host.id);
    const theirs = await newProject("Theirs", host.id);
    for (const id of [kept, theirs])
      await prisma.project.update({ where: { id }, data: { collaborators: { connect: [{ id: owner.id }] } } });

    const made = await ai.createKey(owner.id, "Shared");
    await ai.grantKey(owner.id, made.id, kept);
    await ai.grantKey(owner.id, made.id, theirs);
    const auth = `Bearer ${made.token}`;
    await expect(ai.connection(auth)).rejects.toThrow("several projects");

    // Removing the owner from that project leaves the grant behind. It must stop counting: the
    // key resolves to the one project still open rather than demanding a header forever, and the
    // access does not return if the owner is added back.
    await prisma.project.update({ where: { id: theirs }, data: { collaborators: { disconnect: [{ id: owner.id }] } } });
    expect((await ai.connection(auth)).projectId).toBe(kept);
    await prisma.project.update({ where: { id: theirs }, data: { collaborators: { connect: [{ id: owner.id }] } } });
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
    // Applies its own change rather than reading a receipt an earlier test happened to write, and
    // compares before and after rather than an exact list, because the project's provenance is
    // shared by every test in this file.
    const context = await ai.context(projectId, userId, { run: randomUUID() });
    const state = Buffer.from(Y.encodeStateAsUpdate(document)).toString("base64");
    const current = (document.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString();
    const applied = await ai.propose(connection, { title: "receipt", summary: "x", snapshotHash: context.hash, operations: [{ kind: "code", fileId: "main", before: current, after: `${current} -- receipted` }] });
    await apply.apply(projectId, userId, applied.id, applied.contentHash, state);

    const before = (await jobs.provenance(projectId, userId)).categories;
    await jobs.declare(projectId, userId, ["SPRITES"], "Background painted with an external tool");
    const provenance = await jobs.provenance(projectId, userId);
    // A declaration adds its own category and leaves everything already there alone.
    expect(provenance.categories.sort()).toEqual([...new Set([...before, "SPRITES"])].sort());
    expect(provenance.declarations).toHaveLength(1);
    expect(provenance.applied.some(item => item.id === applied.id)).toBe(true);
  });
});
