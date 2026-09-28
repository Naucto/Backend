import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Prisma } from "@prisma/client";
import { ProjectService } from "@project/project.service";
import { commitSnapshots } from "./ai-commit";
import { AiService } from "./ai.service";

/**
 * Applying a proposal, without stopping anybody.
 *
 * The person who accepts sends the document as they have it, the operations are merged into that,
 * and the merged result is handed back as a Yjs update. Their unsaved work is in the base, so it is
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
  private readonly logger = new Logger(AiApplyService.name);
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService, private readonly modules: ModuleRef) {}

  /** What applying would do, for the diff a person decides on. Written, never stored. */
  async preview(projectId: number, userId: number, proposalId: string, snapshot: string): Promise<{ result: string }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findFirst({ where: { id: proposalId, projectId } });
    if (!proposal) throw new ConflictException("Proposal unavailable");
    return { result: commitSnapshots([snapshot], proposal.operations, `preview:${proposal.id}`).result };
  }

  /**
   * Applies the proposal to the accepting editor's own state and returns the merged document.
   *
   * The whole state, not a difference from the acceptor's. Yjs merges on apply, so a full state does
   * not overwrite a colleague who has unsent work — it combines with it. A difference does not have
   * that property: it only makes sense to the one client whose state vector it was cut against. The
   * update leaves this server and reaches every tab in the session, and `code` commits are a
   * delete-and-reinsert, so a colleague still missing the acceptor's own edits would apply that
   * delete and park the replacement as a struct whose origin they do not have — an empty file until
   * the missing chunk happens to arrive. A state carries its own dependencies, so it is correct for
   * every recipient regardless of what they have.
   */
  async apply(projectId: number, userId: number, proposalId: string, contentHash: string, snapshot: string): Promise<{ update: string; categories: string[] }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.projectId !== projectId) throw new ConflictException("Proposal unavailable");
    if (proposal.status !== "PENDING") throw new ConflictException("Proposal was already reviewed");
    if (proposal.contentHash !== contentHash) throw new ConflictException("Proposal changed; review it again");

    const commit = commitSnapshots([snapshot], proposal.operations, proposal.id);
    // A commit that moves nothing is a proposal that no longer describes this document. Compared
    // against the snapshot, because a full state is never empty of itself.
    if (commit.result === snapshot) throw new ConflictException("That change no longer applies to this project");

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
      // The upload is the first thing `save` does and the most likely thing to fail; its two writes
      // after it can also throw, and then the blob is stored while the proposal is not. Reverting is
      // right for the common case, and wrong for that one, so a revert that cannot be confirmed is
      // reported rather than swallowed: a proposal left APPLIED with nothing stored is a dead end
      // (it cannot be applied again, and `proposeRevert` only looks at APPLIED rows).
      const released = await this.prisma.aiProposal
        .updateMany({ where: { id: proposal.id, status: "APPLIED", reviewedBy: userId }, data: { status: "PENDING", reviewedBy: null } })
        .catch(() => null);
      if (!released || released.count !== 1) {
        this.logger.error(`Proposal ${proposal.id} is recorded as applied but its document was not stored; it needs a manual decision.`, error instanceof Error ? error.stack : undefined);
      }
      throw error;
    }

    return { update: commit.result, categories: commit.categories };
  }
}
