import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Prisma } from "@prisma/client";
import { commitSnapshots } from "./ai-commit";
import { AiService } from "./ai.service";

/**
 * Applying a proposal, without stopping anybody.
 *
 * The person who accepts sends the document as they have it, the operations are merged into that,
 * and the merged result is handed back as a Yjs update. Their unsaved work is in the base, so a
 * proposal written against an older state is refused as changed rather than applied over what they
 * have in front of them, and every operation is still checked against the real text before it is
 * written. Note that this is a refusal, not a merge: a `code` operation replaces the whole file, so
 * a proposal that was written before their last keystroke is one they have to re-read and have the
 * assistant redo against the state they are looking at.
 *
 * This replaced a barrier that froze every editor, collected their snapshots, and replaced the
 * whole document in each browser. That bought atomicity across a project at the cost of the editor
 * disappearing mid-change, which is a poor trade for a document that is a CRDT. What is given up is
 * this: two people editing the same region at the same instant now merge, where before the second
 * one's work was held back and replayed. And the stored blob is the acceptor's own state plus the
 * change, where the barrier stored the union of everybody's frozen snapshots, so an edit that has
 * not yet been relayed to the acceptor is not in it — it reaches the next autosave from the
 * colleague's own document, and the acceptor's save lands in the same version slot.
 */
@Injectable()
export class AiApplyService {
  constructor(private readonly prisma: PrismaService, private readonly ai: AiService) {}

  /** What applying would do, for the diff a person decides on. Written, never stored. */
  async preview(projectId: number, userId: number, proposalId: string, snapshot: string): Promise<{ result: string }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findFirst({ where: { id: proposalId, projectId } });
    if (!proposal) throw new ConflictException("Proposal unavailable");
    return { result: commitSnapshots([snapshot], proposal.operations, `preview:${proposal.id}`, proposal.revertsId !== null).result };
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

    // A staged revert is committed as an inverse. `proposeRevert` re-offers the operations an
    // application recorded, and those were written for the inverse flag: without it, restoring a
    // declaration to the open state it had before any declaration existed is refused as a no-op,
    // which is the shape most declarations have.
    const commit = commitSnapshots([snapshot], proposal.operations, proposal.id, proposal.revertsId !== null);
    // No "did anything change" check here: every commit writes an `ai.applied` receipt, so the
    // result is never equal to the snapshot and such a test would never fire. What actually refuses
    // a proposal that no longer describes the document is each operation's own validation — a
    // `code` operation whose `before` no longer matches the text, a declaration that moved on, a
    // no-op — all of which raise before anything is written.

    // Claim the proposal. The status is what makes acceptance single-use, and two people can reach
    // this at once, so the write is a compare-and-swap on PENDING rather than a read-then-write:
    // whoever wins the swap is the one whose document now holds the change.
    const claimed = await this.prisma.aiProposal.updateMany({
      where: { id: proposal.id, status: "PENDING" },
      data: { status: "APPLIED", reviewedBy: userId, inverse: commit.inverse as Prisma.InputJsonValue },
    });
    if (claimed.count !== 1) throw new ConflictException("Proposal was already reviewed");

    // Nothing is written to storage here, and that is deliberate.
    //
    // Saving this state would put a `code` change's delete-and-reinsert into the stored blob before
    // the accepting editor has seen it. If the reply never arrived — the tab closed, the connection
    // dropped, the request hung — that change would sit in storage, unreceived by anyone, while
    // everyone kept editing. Saves merge into what is stored, so it would stay there, and the next
    // person to open the project would load a blob carrying a whole-file delete from that moment and
    // push it to every peer, silently undoing everything typed since.
    //
    // The accepting editor persists it instead: applying marks their document dirty, so their own
    // autosave writes the change within seconds — and only once they actually hold it. If they close
    // the tab immediately the change does not happen, which is recoverable and honest; the reverse
    // is not.
    return { update: commit.result, categories: commit.categories };
  }
}
