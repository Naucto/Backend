import { ConflictException } from "@nestjs/common";
import type * as Y from "yjs";

import type { Operation, Prepared } from "./ai-assets";

/** Bits in a `net.permissions` declaration, matching the engine's NetPermissions. */
const CLIENT_READ = 1 << 0;
const CLIENT_WRITE = 1 << 1;

/**
 * A path, bounded the way the engine bounds it: 128 for the composed name and 64 per segment,
 * which is what the NET tab now checks on the composed name too. The Backend keeps its own copy
 * because this is the trust boundary and a proposal is untrusted input whether it came from the
 * editor or from a key; the two are pinned to the same rules by tests on both sides.
 */
const SEGMENT = /^[a-z0-9_]{1,64}$/i;
const PATH = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i;
const MAX_PATH = 128;

/**
 * The branch a lock or queue keeps its backing under. No declaration may name it: a value seeded
 * there is read by the lock machinery (an owner there deadlocks the first acquisition for good),
 * and a permission declared there is never consulted, because the host resolves against the
 * owner's path instead.
 */
const RESERVED = "__netobj__";

/** The longest authored starting value, so a declaration cannot become a payload. */
const MAX_DEFAULT = 512;

const isScalar = (value: unknown): value is number | string | boolean =>
  typeof value === "number" || typeof value === "string" || typeof value === "boolean";

/**
 * A `net.state` path, validated the way the net tab validates one.
 *
 * The Backend keeps its own copy rather than importing the engine's: this is the trust boundary,
 * and a proposal is untrusted input whether it arrived from the editor or from a key. A path is
 * also a Yjs key here, so an unbounded one would be a way to write an arbitrary key into a
 * document. The empty path is refused — a root entry is a whole-table setting, not a path, and
 * nothing in the editor can declare one.
 */
function path(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH || !PATH.test(value))
    throw new ConflictException("Invalid net.state path");
  for (const segment of value.split(".")) {
    if (segment === RESERVED) throw new ConflictException(`net.state path may not use ${RESERVED}`);
    if (!SEGMENT.test(segment)) throw new ConflictException("Invalid net.state path");
  }
  return value;
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ConflictException(`${label} must be true or false`);
  return value;
}

interface Declaration {
  flags: number;
  default?: number | string | boolean;
}

/**
 * Edits one declaration in `net.permissions`: which clients may reach a path, and what a session
 * starts it at.
 *
 * The default is the authored starting value, not a live one. A running session owns its values
 * and they are not versioned, so applying this changes how the next session begins and leaves a
 * game in progress alone — which is why it is safe to review, revert and diff like any other edit.
 */
export function prepareNetPermissions(doc: Y.Doc, op: Operation, touch: (key: string) => void, inverse = false): Prepared {
  const target = path(op["path"]);
  const map = doc.getMap<Declaration>("net.permissions");
  touch(`net:${target}`);

  // A plausible mistake that must not fail open: `flags` looks like the field, and dropping it
  // would leave the default of both bits set, which is the open state. Say what to send instead.
  if ("flags" in op) throw new ConflictException("Use clientRead and clientWrite, not flags");

  // A declaration must say what it expects to find, or nothing else does. Every other kind carries
  // the value it expects, and a declaration that has moved on is a conflict rather than a silent
  // clobber — the alternative is a change that quietly undoes somebody's afternoon. Reverts always
  // brought one; a fresh proposal did not, which meant it took whatever the accepting document
  // happened to hold and wrote over it. `Naucto-AI` fills this in from the state it read, the same
  // way it fills `snapshotHash`. Checked after the operation's own fields, so that a mistyped path
  // or a bound that does not fit is still reported as itself.
  const checkExpectation = (): void => {
    const want = op["expect"];
    if (want === undefined) throw new ConflictException("A multiplayer declaration must state what it expects to find");
    if (want === null) {
      if (map.has(target)) throw new ConflictException("Declaration changed since this was applied");
      return;
    }
    // Anything that is not a declaration — an array, a string, a number, an object without `flags` —
    // compares unequal to what is there, so it lands in the same refusal rather than needing a shape
    // check of its own.
    const now = map.get(target);
    const wanted = want as Declaration;
    const same = typeof wanted === "object" && now !== undefined && now.flags === wanted["flags"] && ((now as Declaration).default ?? null) === (wanted["default"] ?? null);
    if (!same) throw new ConflictException("Declaration changed since this was applied");
  };

  const raw = map.get(target);
  // `net.permissions` is a collaborative map, so any peer can have put anything in it. A value that
  // is not a declaration is refused rather than read through: `null.flags` is a 500, and treating
  // a malformed entry as absent would report the path as open when the host reads it otherwise.
  if (raw !== undefined && (typeof raw !== "object" || raw === null || typeof (raw as Declaration).flags !== "number" || !Number.isFinite((raw as Declaration).flags)))
    throw new ConflictException("Declaration is malformed; set its flags in the NET tab");
  const before = raw;
  const removing = op["remove"];
  if (removing !== undefined && removing !== true) throw new ConflictException("remove must be true");
  if (removing === true) {
    if (op["clientRead"] !== undefined || op["clientWrite"] !== undefined || op["default"] !== undefined)
      throw new ConflictException("remove cannot be combined with other changes");
    if (before === undefined) throw new ConflictException("No such declaration");
    checkExpectation();
    return {
      category: "MULTIPLAYER",
      writes: [() => { map.delete(target); }],
      // Restoring the declaration meets an empty path, which is what it has to expect to find.
      inverse: [{ kind: "net_permissions", path: target, expect: null, ...declarationFields(before) }],
    };
  }

  // A path with declared children is a table, and the engine reads a value before it reads a
  // container: a scalar default there would shadow the table and the game would index a number.
  const isContainer = [...map.keys()].some((other) => other !== target && other.startsWith(`${target}.`));
  if (isContainer && "default" in op && op["default"] !== null)
    throw new ConflictException("A path with children is a table, so it takes no starting value");

  const next: Declaration = { flags: before?.flags ?? CLIENT_READ | CLIENT_WRITE };
  if ("default" in op) {
    const value = op["default"];
    if (value === null) delete next.default;
    else if (!isScalar(value)) throw new ConflictException("default must be a number, string, boolean or null");
    else if (typeof value === "string" && value.length > MAX_DEFAULT) throw new ConflictException("default is too long");
    else if (typeof value === "number" && !Number.isFinite(value)) throw new ConflictException("default must be a finite number");
    else next.default = value;
  }
  if (op["clientRead"] !== undefined) {
    const on = flag(op["clientRead"], "clientRead");
    next.flags = on ? next.flags | CLIENT_READ : next.flags & ~CLIENT_READ;
  }
  if (op["clientWrite"] !== undefined) {
    const on = flag(op["clientWrite"], "clientWrite");
    next.flags = on ? next.flags | CLIENT_WRITE : next.flags & ~CLIENT_WRITE;
  }

  // A no-op proposal is a proposal that says nothing, and the diff a person reviews is the whole
  // point of asking. Note that flags of 0 is not a no-op: it is the server-private state, which is
  // the opposite of the open state an absent declaration means.
  if (!inverse) {
    if (before !== undefined && next.flags === before.flags && next.default === before.default)
      throw new ConflictException("Proposal contains no-op multiplayer changes");
    if (before === undefined && next.flags === (CLIENT_READ | CLIENT_WRITE) && next.default === undefined)
      throw new ConflictException("Proposal contains no-op multiplayer changes");
  }

  // Last, once the operation is known to be well-formed, so a mistake in the operation itself is
  // reported as that and not as a missing expectation.
  checkExpectation();

  return {
    category: "MULTIPLAYER",
    writes: [() => { map.set(target, next); }],
    // The inverse meets the state this write leaves, so that is what it expects to find — not the
    // state before it. Anything else has happened in between, and reverting over it is the thing
    // a revert must never do.
    inverse: before === undefined
      ? [{ kind: "net_permissions", path: target, remove: true, expect: next }]
      : [{ kind: "net_permissions", path: target, expect: next, ...declarationFields(before) }],
  };
}

/** An inverse that restores a declaration exactly, whether or not it had a default. */
function declarationFields(value: Declaration): Record<string, unknown> {
  return { clientRead: (value.flags & CLIENT_READ) !== 0, clientWrite: (value.flags & CLIENT_WRITE) !== 0, default: value.default ?? null };
}

