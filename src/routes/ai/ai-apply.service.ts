import { ConflictException, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Prisma } from "@prisma/client";
import { ProjectService } from "@project/project.service";
import * as Y from "yjs";
import { commitSnapshots } from "./ai-commit";
import { AiService } from "./ai.service";

/**
 * Applying a proposal, without stopping anybody.
 *
 * The person who accepts sends the document as they have it, the operations are merged into that,
 * and the difference is handed back as a Yjs update. Their unsaved work is in the base, so it is
 * respected rather than reconstructed, and every operation is still checked against the real text
 * before it is written — a change to something that moved underneath is refused, not merged over.
 *
 * This replaced a barrier that froze every editor, collected their snapshots, and replaced the
 * whole document in each browser. That bought atomicity across a project at the cost of the editor
 * disappearing mid-change, which is a poor trade for a document that is a CRDT. What is given up is
 * this: two people editing the same region at the same instant now merge, where before the second
 * one's work was held back and replayed.
 */
@Injectable()
export class AiApplyService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService, private readonly modules: ModuleRef) {}

  /** What applying would do, for the diff a person decides on. Written, never stored. */
  async preview(projectId: number, userId: number, proposalId: string, snapshot: string): Promise<{ result: string }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findFirst({ where: { id: proposalId, projectId } });
    if (!proposal) throw new ConflictException("Proposal unavailable");
    return { result: commitSnapshots([snapshot], proposal.operations, `preview:${proposal.id}`).result };
  }

  /**
   * Applies the proposal to the accepting editor's own state and returns only the difference.
   *
   * A delta rather than a whole document: everyone else in the session is still editing, and
   * handing them the merged state would replace work they have not sent yet.
   */
  async apply(projectId: number, userId: number, proposalId: string, contentHash: string, snapshot: string): Promise<{ update: string; categories: string[] }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.projectId !== projectId) throw new ConflictException("Proposal unavailable");
    if (proposal.status !== "PENDING") throw new ConflictException("Proposal was already reviewed");
    if (proposal.contentHash !== contentHash) throw new ConflictException("Proposal changed; review it again");

    const commit = commitSnapshots([snapshot], proposal.operations, proposal.id);
    const update = difference(snapshot, commit.result);
    // A commit that would move nothing is a proposal that no longer describes this document.
    if (!update) throw new ConflictException("That change no longer applies to this project");

    // Claim the proposal before touching storage. The status is what makes acceptance single-use,
    // and two people can reach this at once, so the write is a compare-and-swap on PENDING rather
    // than a read-then-write: whoever wins the swap is the one who saves.
    const claimed = await this.prisma.aiProposal.updateMany({
      where: { id: proposal.id, status: "PENDING" },
      data: { status: "APPLIED", reviewedBy: userId, inverse: commit.inverse as Prisma.InputJsonValue },
    });
    if (claimed.count !== 1) throw new ConflictException("Proposal was already reviewed");

    // Persist what was accepted, so the stored project is not behind the one on screen. The update
    // is a full state, because the stored blob is replaced wholesale rather than merged.
    const project = this.modules.get(ProjectService, { strict: false });
    const buffer = Buffer.from(commit.result, "base64");
    try {
      await project.save(projectId, { buffer, originalname: "ai.yjs", mimetype: "application/octet-stream", size: buffer.length } as Express.Multer.File);
    } catch (error) {
      // Storage refused, so nothing was written and the claim has to go back: leaving it APPLIED
      // would report a change that does not exist in the project. Best effort — if the revert
      // itself fails the proposal stays claimed, which is the safer of the two bad outcomes.
      await this.prisma.aiProposal
        .updateMany({ where: { id: proposal.id, status: "APPLIED", reviewedBy: userId }, data: { status: "PENDING", reviewedBy: null } })
        .catch(() => undefined);
      throw error;
    }

    return { update, categories: commit.categories };
  }
}

/** The Yjs update that carries `after` to someone already holding `before`, or null if it is empty. */
function difference(before: string, after: string): string | null {
  const held = new Y.Doc();
  const merged = new Y.Doc();
  try {
    Y.applyUpdate(held, Buffer.from(before, "base64"));
    Y.applyUpdate(merged, Buffer.from(after, "base64"));
    const update = Buffer.from(Y.encodeStateAsUpdate(merged, Y.encodeStateVector(held))).toString("base64");
    return update.length > 0 ? update : null;
  } finally {
    held.destroy();
    merged.destroy();
  }
}
