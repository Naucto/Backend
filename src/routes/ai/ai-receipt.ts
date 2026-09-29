import * as Y from "yjs";

/**
 * Whether a document carries the receipt that a given proposal was committed.
 *
 * Every commit writes an `ai.applied` entry keyed by proposal id, and a save writes the document's
 * receipts out with it. So the receipt in a document is the difference between "this change was
 * committed here" and "this change was claimed", and it is the only evidence either side has: a Yjs
 * update carries no document identity and no history of its own beyond the structs it holds.
 *
 * Read defensively. A blob that is not a document has no receipts, and saying so is what lets a
 * caller treat an unreadable state as holding nothing rather than refusing to answer.
 */
export function hasReceipt(encoded: string | Uint8Array, proposalId: string): boolean {
  try {
    const bytes = typeof encoded === "string"
      ? new Uint8Array(Buffer.from(encoded, "base64"))
      : encoded;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, bytes);
      return doc.getMap("ai.applied").has(proposalId);
    } finally {
      doc.destroy();
    }
  } catch {
    return false;
  }
}
