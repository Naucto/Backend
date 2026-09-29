import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Prisma } from "@prisma/client";
import { commitSnapshots, Operation } from "./ai-commit";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { AiProposal } from "@prisma/client";
import { HunkSelection, currentText, narrowCodeOperation } from "./ai-hunks";
import { hasReceipt } from "./ai-receipt";
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
  async apply(
    projectId: number,
    userId: number,
    proposalId: string,
    contentHash: string,
    snapshot: string,
    hunks?: HunkSelection[],
  ): Promise<{ update: string; categories: string[]; appliedProposalId?: string }> {
    await this.ai.authorize(projectId, userId);
    const proposal = await this.prisma.aiProposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.projectId !== projectId) throw new ConflictException("Proposal unavailable");
    if (hunks?.length) return this.applySelection(projectId, userId, proposal, snapshot, hunks);
    if (proposal.contentHash !== contentHash) throw new ConflictException("Proposal changed; review it again");

    // A claim that never reached storage can be applied again, and one that did cannot.
    //
    // Nothing is written here, so the change exists only in the accepting editor's document. If that
    // reply is lost, or the tab closes before its first save, the row says APPLIED and no document
    // anywhere holds it — the change is simply gone, while looking exactly like one a person is
    // reading the title of. `storedAt` is the difference: it is set by the first save whose bytes
    // carry this proposal's `ai.applied` receipt, so a null beside APPLIED means nothing was stored.
    //
    // A stored change is never re-applied. A `code` operation replaces the whole file, so applying
    // one twice concatenates it — and a client that is merely behind, holding an older document,
    // would pass the "no receipt" test while storage already has the change. Hence the receipt is
    // checked against the newest stored slot as well as against the submitted snapshot, and the
    // claim has to be old enough that a save in flight cannot still be about to confirm it.
    const reApply = await this.unstoredReapply(projectId, proposal, snapshot);
    if (proposal.status !== "PENDING" && !reApply) throw new ConflictException("Proposal was already reviewed");

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
    // this at once, so the write is a compare-and-swap rather than a read-then-write: whoever wins
    // the swap is the one whose document now holds the change.
    //
    // The re-apply branch swaps on the claim it read — status, the moment it was claimed, and
    // `storedAt` still null. Without all three, two tabs that both notice a missing change would
    // both apply it, and a `code` change applied twice concatenates the file. `storedAt` in the
    // where clause is what makes a save that landed in the meantime win instead: this swap then
    // matches nothing and the change is refused, which is correct — it is already stored.
    const claimed = await this.prisma.aiProposal.updateMany({
      where: reApply
        ? { id: proposal.id, status: "APPLIED", storedAt: null, appliedAt: proposal.appliedAt }
        : { id: proposal.id, status: "PENDING" },
      data: {
        status: "APPLIED",
        reviewedBy: userId,
        appliedAt: new Date(),
        // A fresh claim is not yet in storage; a re-apply resets the record, since the previous
        // claim's receipts were only ever in the document that was lost.
        storedAt: null,
        inverse: commit.inverse as Prisma.InputJsonValue,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException(reApply
        ? "This change is already stored, or another person is re-applying it"
        : "Proposal was already reviewed");
    }

    // Nothing is written to storage here, and that is deliberate.
    //
    // Saving this state would put a `code` change's delete-and-reinsert into the stored blob before
    // the accepting editor has seen it. If the reply never arrived — the tab closed, the connection
    // dropped, the request hung — that change would sit in storage, unreceived by anyone, while
    // everyone kept editing. Saves merge into what is stored, so it would stay there, and the next
    // person to open the project would load a blob carrying a whole-file delete from that moment and
    // push it to every peer, silently undoing everything typed since.
    //
    // The accepting editor persists it instead: applying marks their document dirty, so an autosave
    // writes the change within seconds — and only once they actually hold it. If they close the tab
    // immediately the change does not happen, which is recoverable and honest; the reverse is not.
    //
    // The client saves at once rather than waiting for the autosave, and retries, because "their own
    // autosave" is not enough on its own: any collaborator can accept, a non-host's autosave never
    // runs, and a single save that failed would otherwise leave the change in that tab alone while
    // this row says APPLIED. If it cannot be stored at all, this proposal is APPLIED and nothing
    // holds the change — recoverable only by re-proposing it, since the status is no longer PENDING
    // and the inverse's `before` no longer matches anything. That gap is real and is not closed here.
    return { update: commit.result, categories: commit.categories };
  }

  /**
   * How long a claim is left alone before it can be applied again.
   *
   * Long enough that a save which is merely in flight is not overtaken. The accepting editor saves
   * immediately on apply and retries until storage has the change, so the normal gap is seconds; a
   * claim that has been sitting unsaved for this long was not going to be saved.
   */
  static readonly REAPPLY_GRACE_MS = 30_000;

  /**
   * Apply part of a proposal: the lines the person chose, in the file as it is now.
   *
   * The proposal itself is deliberately not claimed. It stays PENDING, so the rest of it can still
   * be applied — and it should be, because the parts were written against one snapshot and applying
   * them at different times means the second is read against a document the first has already moved.
   * The applied part is recorded as its own row carrying the same provenance and its own inverse, so
   * "one change is one undo unit" survives: reverting this part does not disturb the rest, and a
   * revert of the whole is refused rather than silently doing half of it.
   */
  private async applySelection(
    projectId: number,
    userId: number,
    proposal: AiProposal,
    snapshot: string,
    hunks: HunkSelection[],
  ): Promise<{ update: string; categories: string[]; appliedProposalId: string }> {
    if (proposal.status !== "PENDING") throw new ConflictException("Proposal was already reviewed");
    if (!Array.isArray(proposal.operations)) throw new ConflictException("This change's record cannot be read");

    // Built from the snapshot the person sent, so the chosen lines are located in the document as
    // they have it rather than in the one the proposal was written against.
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, new Uint8Array(Buffer.from(snapshot, "base64")));
      // A file nobody chose lines in is applied whole; a file that was is narrowed to the choice.
      // Anything that is not a code operation — artwork, maps, sound, declarations — is applied
      // whole too, because there is no honest way to take half of a sprite sheet or half a
      // multiplayer permission, and refusing the whole apply over it would leave the person unable
      // to take the one edit they did want.
      const wanted = new Set(hunks.map((hunk) => hunk.fileId));
      for (const selection of hunks) {
        if (!proposal.operations.some(
          (op) => !!op && typeof op === "object" && (op as { kind?: unknown }).kind === "code"
            && (op as { fileId?: unknown }).fileId === selection.fileId,
        )) {
          throw new ConflictException(`This change does not touch ${selection.fileId}`);
        }
      }
      const chosen: Operation[] = [];
      for (const raw of proposal.operations as unknown[]) {
        if (!raw || typeof raw !== "object") continue;
        const op = raw as Operation;
        const kind = op["kind"];
        const fileId = typeof op["fileId"] === "string" ? (op["fileId"] as string) : "";
        // Not a code operation, or a code operation nobody narrowed: taken as it stands.
        if (kind !== "code" || !wanted.has(fileId)) {
          chosen.push(op);
          continue;
        }
        const selection = hunks.find((hunk) => hunk.fileId === fileId);
        if (!selection) continue;
        const current = currentText(doc, fileId);
        if (current === null) throw new ConflictException(`This change does not touch ${fileId}`);
        chosen.push(narrowCodeOperation(
          op as unknown as { kind: "code"; fileId: string; before: string; after: string },
          selection,
          current,
        ));
      }
      if (!chosen.length) throw new ConflictException("Nothing in this change was selected");

      const part = await this.prisma.aiProposal.create({ data: {
        projectId, userId,
        parentId: proposal.id,
        title: `Part of: ${proposal.title}`.slice(0, 160),
        summary: `Lines ${hunks.map((h) => `${h.fileId}:${h.from}-${h.to}`).join(", ")} of a change with ${(proposal.operations as unknown[]).length} operation(s).`,
        snapshotHash: proposal.snapshotHash,
        baseContextAgeMs: proposal.baseContextAgeMs,
        operations: chosen as unknown as Prisma.InputJsonValue,
        contentHash: createHash("sha256").update(JSON.stringify(chosen)).digest("hex"),
        status: "PENDING",
      } });

      const commit = commitSnapshots([snapshot], chosen, part.id, false);
      const claimed = await this.prisma.aiProposal.updateMany({
        where: { id: part.id, status: "PENDING" },
        data: {
          status: "APPLIED", reviewedBy: userId, appliedAt: new Date(), storedAt: null,
          inverse: commit.inverse as Prisma.InputJsonValue,
        },
      });
      if (claimed.count !== 1) throw new ConflictException("That part was applied by someone else");
      return { update: commit.result, categories: commit.categories, appliedProposalId: part.id };
    } finally {
      doc.destroy();
    }
  }

  /**
   * Whether this proposal may be applied a second time: claimed, never stored, and held by nobody.
   *
   * Every clause is a way the change could be somewhere after all, and re-applying when it is would
   * duplicate it — a `code` operation replaces the whole file, so a second application concatenates
   * it rather than merging cleanly.
   */
  private async unstoredReapply(projectId: number, proposal: AiProposal, snapshot: string): Promise<boolean> {
    if (proposal.status !== "APPLIED") return false;
    // Set by the first save whose bytes carry this proposal's receipt. Present means stored, and
    // stored is final. A null on a row predating the column is read as "unknown", which is not the
    // same as "absent" — so those are never re-applied, since they are almost certainly stored many
    // times over and a duplicate code change is worse than an unrecoverable one.
    if (proposal.storedAt !== null) return false;
    if (proposal.appliedAt === null) return false;
    if (Date.now() - proposal.appliedAt.getTime() < AiApplyService.REAPPLY_GRACE_MS) return false;
    // The client asking must not hold it either.
    if (hasReceipt(snapshot, proposal.id)) return false;
    // Nor may storage. A client that is merely behind, holding a document from before the change,
    // would pass the test above while storage already has it.
    const newest = (await this.ai.newestStoredSave(projectId)) ?? null;
    if (newest && hasReceipt(newest, proposal.id)) return false;
    return true;
  }
}
