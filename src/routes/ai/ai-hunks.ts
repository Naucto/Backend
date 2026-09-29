import { ConflictException } from "@nestjs/common";
import * as Y from "yjs";

/** The lines a person chose out of a proposed whole-file replacement, by line number in the result. */
export interface HunkSelection {
  fileId: string;
  /** First chosen line, counted from zero in the proposed text. */
  from: number;
  /** One past the last chosen line. */
  to: number;
}

const splitLines = (text: string): string[] => text.split("\n");

/** The text of a Lua file in a document, or null when there is no such file there. */
export function currentText(doc: Y.Doc, fileId: string): string | null {
  const file = doc.getMap<Y.Map<Y.Text>>("code.files").get(fileId);
  const text = file?.get("text");
  return text instanceof Y.Text ? text.toString() : null;
}

/** One run of lines that differ, as a range in the old text and a range in the new one. */
interface Hunk {
  from: number;
  to: number;
  beforeFrom: number;
  beforeTo: number;
}

/**
 * The runs of lines that differ between the two texts.
 *
 * A real diff rather than "everything between the first and last difference", because a whole-file
 * replacement frequently makes several separate changes — an edit to `start()` and an edit to
 * `stop()` — and a person choosing one of them is asking for one of them. A single region spanning
 * both would either force them to take both or offer neither.
 *
 * Longest common subsequence, because it is the alignment that leaves the fewest spurious
 * differences, and a spurious difference in the middle of a hunk is what makes its `before` fail to
 * match. Quadratic, so a file past the guard falls back to one region from the shared prefix and
 * suffix: for a file that large the common case is a small edit, and being conservative there means
 * declining a hunk rather than applying the wrong lines.
 */
function changedHunks(before: string[], after: string[]): Hunk[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  if (before.length * after.length > LCS_CELLS) {
    return [{ from: head, to: after.length - tail, beforeFrom: head, beforeTo: before.length - tail }];
  }

  // A table of the longest common subsequence over the two middles, filled from the back so each
  // cell can be read as "how much follows here".
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  const i0 = head;
  const j0 = head;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      if (open) {
        hunks.push(open);
        open = null;
      }
      i += 1;
      j += 1;
      continue;
    }
    open ??= { from: j0 + j, to: j0 + j, beforeFrom: i0 + i, beforeTo: i0 + i };
    // Step whichever side is shorter, so the walk finds the alignment the table describes.
    if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i += 1;
    else j += 1;
    open.to = j0 + j;
    open.beforeTo = i0 + i;
  }
  // Whatever is left when one side runs out is still a difference — a pure insertion leaves nothing
  // on the `a` side at all, and without this the walk reports no change for exactly the case a
  // hunk most often is.
  if (open || i < a.length || j < b.length) {
    hunks.push(open ?? { from: j0 + j, to: j0 + b.length, beforeFrom: i0 + i, beforeTo: i0 + i });
  }
  return hunks;
}

/** Above this many cells the diff falls back to one conservative region. */
const LCS_CELLS = 4_000_000;

/**
 * The proposal as the person chose part of it: the file as it is now, with one region changed.
 *
 * A `code` operation carries the entire new file, so accepting one accepts all of it, and a person
 * who wanted two of the assistant's four edits had no way to say so — they took all four, or asked
 * again. This applies their range instead. The lines they left out are not applied, and the proposal
 * is not consumed, so the rest can still be taken afterwards.
 *
 * Returned as a whole file rather than as a splice, because that is what a `code` commit is: it
 * replaces the file and checks the file it replaces against exact text. A ranged operation would
 * have had to be taught a second shape to validate and to apply, and a partial one validated against
 * a fragment of the file is a fragment that may appear twice.
 *
 * The hunk is located by the unchanged text on either side of it, so a `before` that occurs more
 * than once in the file still resolves to the right place. If the surroundings cannot be found the
 * hunk is refused rather than guessed at, because a wrong answer here surfaces later as "code
 * changed", which reads as somebody else's edit.
 */
/** The first index at which `needle` occurs in `haystack`, or -1. */
function indexOfLines(haystack: string[], needle: string[]): number {
  if (!needle.length) return 0;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function narrowCodeOperation(
  operation: { kind: "code"; fileId: string; before: string; after: string },
  selection: HunkSelection,
  current: string,
): { kind: "code"; fileId: string; before: string; after: string } {
  const beforeLines = splitLines(operation.before);
  const afterLines = splitLines(operation.after);
  // The hunk the range falls in, or overlaps. A range that spans two changes is two hunks, not one:
  // the person is asking for the lines between them too, and those may well be unchanged text that
  // should be left alone.
  const hunks = changedHunks(beforeLines, afterLines).filter(
    (hunk) => selection.to > hunk.from && selection.from < Math.max(hunk.to, hunk.from + 1),
  );
  if (!hunks.length) throw new ConflictException("The selected range contains no changed lines");
  const from = Math.max(hunks[0]!.from, selection.from);
  const to = Math.min(hunks[hunks.length - 1]!.to, selection.to);
  if (to <= from) throw new ConflictException("The selected range contains no changed lines");
  // The document lines the chosen new lines stand in for: from the first hunk's start to the last
  // hunk's end, which is the span the rewrite occupies in the file as it is.
  const region = { beforeFrom: hunks[0]!.beforeFrom, beforeTo: hunks[hunks.length - 1]!.beforeTo };

  // Found line-wise rather than by character offsets. The window is the region plus a couple of
  // unchanged lines either side, and matching it as a sequence of lines is what keeps a hunk aimed
  // at the right one of two identical blocks; joining to a string and measuring offsets gets the
  // separators wrong as soon as the region is empty, which a pure insertion always is.
  const anchor = 2;
  const currentLines = splitLines(current);
  const windowFrom = Math.max(0, region.beforeFrom - anchor);
  const windowTo = Math.min(beforeLines.length, region.beforeTo + anchor);
  const window = beforeLines.slice(windowFrom, windowTo);
  const at = indexOfLines(currentLines, window);
  if (at < 0) throw new ConflictException("Those lines are not in the file as it is now; review a fresh proposal");

  // The lines the file holds where the rewrite goes, in the document rather than reassembled from
  // the proposal, so what is checked and what is replaced are the same characters.
  const regionAt = at + (region.beforeFrom - windowFrom);
  const replaced = currentLines.slice(regionAt, regionAt + (region.beforeTo - region.beforeFrom));
  const narrowed = [
    ...currentLines.slice(0, regionAt),
    ...afterLines.slice(from, to),
    ...currentLines.slice(regionAt + replaced.length),
  ].join("\n");
  if (narrowed === current) throw new ConflictException("The selected range is already what the file holds");
  const narrowedAfter = narrowed;
  return { kind: "code", fileId: operation.fileId, before: current, after: narrowedAfter };
}
