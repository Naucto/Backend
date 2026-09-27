import { randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AiBarrier, Prisma } from "@prisma/client";
import { ProjectService } from "@project/project.service";
import { AiService } from "./ai.service";
import * as Y from "yjs";
import { commitSnapshots, OPERATION_KINDS } from "./ai-commit";

/** Whether an update adds anything to a state: Yjs ignores what it already holds. */
export function addsTo(state: string[], update: string): boolean {
  const doc = new Y.Doc();
  try {
    for (const part of state) Y.applyUpdate(doc, Buffer.from(part, "base64"));
    const before = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    Y.applyUpdate(doc, Buffer.from(update, "base64"));
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") !== before;
  } finally { doc.destroy(); }
}

/** How long an editor's heartbeat counts as present. Heartbeats are sent every 1.5 s. */
const PRESENT_MS = 10000;

@Injectable()
export class AiBarrierService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService, private readonly modules: ModuleRef) {}

  async preview(projectId: number, userId: number, proposalId: string, snapshot: string): Promise<{ result: string }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findFirst({ where: { id: proposalId, projectId } });
    if (!proposal) throw new ConflictException("Proposal unavailable");
    return { result: commitSnapshots([snapshot], proposal.operations, `preview:${proposal.id}`).result };
  }

  async heartbeat(projectId: number, userId: number, editorId: string): Promise<AiBarrier | null> {
    await this.ai.authorize(projectId, userId);
    // Registration and reading the barrier are one serializable decision: a new editor cannot
    // slip between the membership snapshot and the pause request.
    return this.prisma.$transaction(async tx => {
      const existing = await tx.aiEditor.findUnique({ where: { id: editorId } });
      if (existing && (existing.projectId !== projectId || existing.userId !== userId)) throw new ConflictException("Editor identity mismatch");
      await tx.aiEditor.upsert({ where: { id: editorId }, create: { id: editorId, projectId, userId }, update: { lastSeen: new Date() } });
      return tx.aiBarrier.findUnique({ where: { projectId } });
    }, { isolationLevel: "Serializable" });
  }

  async start(projectId: number, userId: number, proposalId: string, contentHash: string, participants: string[]): Promise<AiBarrier> {
    await this.ai.authorize(projectId, userId);
    return this.prisma.$transaction(async tx => {
      const current = await tx.aiBarrier.findUnique({ where: { projectId } });
      if (current && ["PREPARING", "COMMITTING"].includes(current.status)) throw new ConflictException("Another application is active");
      const proposal = await tx.aiProposal.findFirst({ where: { id: proposalId, projectId, contentHash, status: "PENDING" } });
      if (!proposal) throw new ConflictException("Proposal changed or already reviewed");
      if (!Array.isArray(proposal.operations) || proposal.operations.some(op => !op || typeof op !== "object" || Array.isArray(op) || !OPERATION_KINDS.includes(String(op["kind"]) as typeof OPERATION_KINDS[number]))) throw new ConflictException("Unsupported proposal operations");
      const editors = await tx.aiEditor.findMany({ where: { projectId, lastSeen: { gt: new Date(Date.now() - PRESENT_MS) } } });
      const expected = editors.map(e => e.id).sort();
      if (!expected.length || !editors.some(e => e.userId === userId) || JSON.stringify(expected) !== JSON.stringify([...new Set(participants)].sort())) throw new ConflictException("Editor membership changed; reconnect and retry");
      await tx.aiProposal.update({ where: { id: proposalId }, data: { status: "APPROVED", reviewedBy: userId } });
      const data = { id: randomUUID(), proposalId, status: "PREPARING", expected, result: null, violation: null, lateUpdates: [], startedAt: new Date() };
      return tx.aiBarrier.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    }, { isolationLevel: "Serializable" });
  }

  async acknowledge(projectId: number, userId: number, editorId: string, barrierId: string, snapshot: string): Promise<void> {
    await this.ai.authorize(projectId, userId);
    const barrier = await this.prisma.aiBarrier.findUnique({ where: { projectId } });
    if (!barrier || barrier.id !== barrierId || barrier.status !== "PREPARING" || !barrier.expected.includes(editorId)) throw new ConflictException("Barrier changed");
    const updated = await this.prisma.aiEditor.updateMany({
      where: { id: editorId, projectId, userId, OR: [{ frozenId: null }, { NOT: { frozenId: barrierId } }] },
      data: { frozenId: barrierId, snapshot, lastSeen: new Date() }
    });
    if (!updated.count) throw new ConflictException("This editor already acknowledged the pause");
  }

  /**
   * A participant saw the document change after it had frozen. The change may simply be a peer's
   * last edit arriving late, which that peer's own snapshot already holds, so nothing is decided
   * from the report alone: before the commit the update is kept and checked against the merged
   * snapshots; after it, it is checked against the committed result, and flagged for a person if
   * the result does not contain it.
   */
  async violation(projectId: number, userId: number, editorId: string, barrierId: string, reason: string, update?: string): Promise<AiBarrier> {
    await this.ai.authorize(projectId, userId);
    return this.prisma.$transaction(async tx => {
      const barrier = await tx.aiBarrier.findUnique({ where: { projectId } });
      if (!barrier || barrier.id !== barrierId || !barrier.expected.includes(editorId)) throw new ConflictException("Barrier changed");
      const note = `${editorId.slice(0, 8)}: ${reason}`.slice(0, 500);
      if (barrier.status === "ABORTED") return barrier;
      if (barrier.status === "PREPARING") {
        if (!update) {
          // Without the update there is nothing to check it against: stop rather than guess.
          await tx.aiProposal.updateMany({ where: { id: barrier.proposalId, status: "APPROVED" }, data: { status: "PENDING", reviewedBy: null } });
          return tx.aiBarrier.update({ where: { projectId }, data: { status: "ABORTED", violation: note } });
        }
        if (barrier.lateUpdates.length >= 50) {
          await tx.aiProposal.updateMany({ where: { id: barrier.proposalId, status: "APPROVED" }, data: { status: "PENDING", reviewedBy: null } });
          return tx.aiBarrier.update({ where: { projectId }, data: { status: "ABORTED", violation: "Too many edits arrived during the pause" } });
        }
        return tx.aiBarrier.update({ where: { projectId }, data: { lateUpdates: { push: update } } });
      }
      if (barrier.violation) return barrier;
      if (update && barrier.result && !addsTo([barrier.result], update)) return barrier;
      return tx.aiBarrier.update({ where: { projectId }, data: { violation: note } });
    }, { isolationLevel: "Serializable" });
  }

  async abort(projectId: number, userId: number, barrierId: string): Promise<void> {
    await this.ai.authorize(projectId, userId);
    await this.prisma.$transaction(async tx => {
      const barrier = await tx.aiBarrier.findUnique({ where: { projectId } });
      if (!barrier || barrier.id !== barrierId || barrier.status !== "PREPARING") throw new ConflictException("Commit has started; resume it instead");
      await tx.aiBarrier.update({ where: { projectId }, data: { status: "ABORTED" } });
      await tx.aiProposal.updateMany({ where: { id: barrier.proposalId, status: "APPROVED" }, data: { status: "PENDING", reviewedBy: null } });
    }, { isolationLevel: "Serializable" });
  }

  /** Dismisses a post-commit warning once someone has checked the result. */
  async acknowledgeViolation(projectId: number, userId: number, barrierId: string): Promise<void> {
    await this.ai.authorize(projectId, userId);
    await this.prisma.aiBarrier.updateMany({ where: { projectId, id: barrierId, status: "APPLIED" }, data: { violation: null } });
  }

  async finish(projectId: number, userId: number, barrierId: string): Promise<AiBarrier> {
    await this.ai.authorize(projectId, userId);
    const barrier = await this.prisma.$transaction(async tx => {
      const current = await tx.aiBarrier.findUnique({ where: { projectId } });
      if (!current || current.id !== barrierId) throw new ConflictException("Barrier changed");
      if (["COMMITTING", "APPLIED"].includes(current.status)) return current;
      if (current.status !== "PREPARING") throw new ConflictException(current.violation ? `Application aborted: ${current.violation}` : "Application aborted");
      const editors = await tx.aiEditor.findMany({ where: { projectId, id: { in: current.expected }, frozenId: barrierId } });
      if (editors.length !== current.expected.length || editors.some(e => !e.snapshot)) throw new ConflictException("Waiting for all editors to pause");
      const proposal = await tx.aiProposal.findUniqueOrThrow({ where: { id: current.proposalId } });
      if (proposal.status !== "APPROVED") throw new ConflictException("Approval unavailable");
      const snapshots = editors.map(e => e.snapshot!);
      if (current.lateUpdates.some(update => addsTo(snapshots, update))) {
        await tx.aiProposal.update({ where: { id: proposal.id }, data: { status: "PENDING", reviewedBy: null } });
        await tx.aiBarrier.update({ where: { projectId }, data: { status: "ABORTED", violation: "An edit reached a paused editor that no snapshot contains; review a fresh proposal" } });
        return null;
      }
      const commit = commitSnapshots(editors.map(e => e.snapshot!), proposal.operations, proposal.id);
      await tx.aiProposal.update({ where: { id: proposal.id }, data: { inverse: commit.inverse as Prisma.InputJsonValue } });
      return tx.aiBarrier.update({ where: { projectId }, data: { status: "COMMITTING", result: commit.result } });
    }, { isolationLevel: "Serializable" });
    if (!barrier) throw new ConflictException("An edit reached a paused editor that no snapshot contains; review a fresh proposal");
    if (barrier.status === "APPLIED") return barrier;
    const project = this.modules.get(ProjectService, { strict: false });
    // The persisted result is reused after failure; operations are never replayed.
    const buffer = Buffer.from(barrier.result!, "base64");
    await project.save(projectId, { buffer, originalname: "ai.yjs", mimetype: "application/octet-stream", size: buffer.length } as Express.Multer.File, barrier.id);
    await this.prisma.aiBarrier.updateMany({ where: { projectId, id: barrierId, status: "COMMITTING" }, data: { status: "APPLIED" } });
    // Snapshots can hold a whole game; they are no use once the result is persisted.
    await this.prisma.aiEditor.updateMany({ where: { projectId, frozenId: barrierId }, data: { snapshot: null } });
    return this.prisma.aiBarrier.findUniqueOrThrow({ where: { projectId } });
  }
}
