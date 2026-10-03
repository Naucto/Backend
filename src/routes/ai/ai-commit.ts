import { BadRequestException, ConflictException } from "@nestjs/common";
import * as Y from "yjs";
import { type Operation, prepareAsset } from "./ai-assets";
export type { Operation } from "./ai-assets";
import { prepareNetPermissions } from "./ai-net";

/** The one size limit on a proposal: a code file may not be larger than this many bytes. */
export const MAX_CODE_BYTES = 1024 * 1024;

export const OPERATION_KINDS = ["code", "pixels", "tiles", "catalog", "sound", "delete_sound", "create_map", "delete_map", "resize_map", "net_permissions"] as const;

/**
 * Operations that record no inverse, so a change containing one cannot be undone as a whole.
 *
 * A deletion removes something the document no longer holds a description of, so putting it back
 * would mean inventing content. Reverting a proposal that contained one would restore the parts it
 * could and quietly leave the rest, and a reviewer reading the revert's operations would have no way
 * to see the half that stays. `proposeRevert` refuses those instead.
 */
export const NON_INVERTIBLE_KINDS = new Set(["delete_map", "delete_sound"]);

export interface Commit {
  /** Full Yjs state of the merged snapshots with the proposal applied, base64. */
  result: string;
  /** Operations that would undo exactly these writes, in the order to submit them. */
  inverse: Operation[];
  categories: string[];
}

/** Merge frozen editor states, validate a complete native batch, then create one immutable result. */
export function commitSnapshots(snapshots: string[], operations: unknown, proposalId: string, isInverse = false): Commit {
  const doc = new Y.Doc();
  try {
    try {
      for (const snapshot of snapshots) Y.applyUpdate(doc, Buffer.from(snapshot, "base64"));
    } catch {
      // A snapshot is whatever the caller sent, decoded from base64 by a DTO that can only check the
      // alphabet. Bytes that are not a Yjs update raise here, and an unhandled error in a controller
      // is a 500 — this is the only path to a mutation, so it is the wrong place to be unkind about
      // a malformed request.
      throw new BadRequestException("Snapshot is not a readable document");
    }
    if (doc.getMap("ai.applied").has(proposalId)) throw new ConflictException("Already applied");
    if (!Array.isArray(operations) || !operations.length) throw new ConflictException("Invalid operations");
    const writes: (() => void)[] = [];
    const inverse: Operation[] = [];
    const categories = new Set<string>();
    const touched = new Set<string>();
    const touch = (key: string): void => {
      if (touched.has(key)) throw new ConflictException("Overlapping operations");
      touched.add(key);
    };
    for (const raw of operations as unknown[]) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConflictException("Invalid operation");
      const op = raw as Operation;
      if (!OPERATION_KINDS.includes(op["kind"] as typeof OPERATION_KINDS[number])) throw new ConflictException("Unsupported operation");
      if (op["kind"] !== "code") {
        // Multiplayer declarations are their own document map, not an asset, so they get their own
        // preparation rather than a case inside the asset switch.
        const asset = op["kind"] === "net_permissions" ? prepareNetPermissions(doc, op, touch, isInverse) : prepareAsset(doc, op, touch);
        writes.push(...asset.writes);
        inverse.unshift(...asset.inverse);
        if (asset.category) categories.add(asset.category);
        continue;
      }
      const id = op["fileId"], before = op["before"], after = op["after"];
      if (typeof id !== "string" || typeof before !== "string" || typeof after !== "string") throw new ConflictException("Invalid code operation");
      if (Buffer.byteLength(after) > MAX_CODE_BYTES) throw new ConflictException("A code file cannot be larger than 1 MiB");
      if (before === after) throw new ConflictException("Proposal contains no-op code changes");
      const file = doc.getMap("code.files").get(id);
      const text = file instanceof Y.Map ? file.get("text") : null;
      if (!(text instanceof Y.Text) || text.toString() !== before) throw new ConflictException("Code changed: review a fresh proposal");
      touch(`code:${id}`);
      writes.push(() => { text.delete(0, text.length); text.insert(0, after); });
      inverse.unshift({ kind: "code", fileId: id, before: after, after: before });
      categories.add("CODE");
    }
    doc.transact(() => {
      for (const write of writes) write();
      doc.getMap("ai.applied").set(proposalId, { categories: [...categories] });
    });
    return { result: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"), inverse, categories: [...categories] };
  } finally { doc.destroy(); }
}
