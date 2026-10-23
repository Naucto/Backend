import { aiContext, Game } from "@naucto/engine/headless";
import * as Y from "yjs";

/** Project the saved document with the same model the editors use, even with no browser open. */
export function buildContext(state: Uint8Array): Record<string, unknown> {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return aiContext(new Game(doc));
  } finally {
    doc.destroy();
  }
}
