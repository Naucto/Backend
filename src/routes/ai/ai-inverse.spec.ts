import { createHash } from "node:crypto";
import * as Y from "yjs";
import { commitSnapshots } from "./ai-commit";

const encode = (doc: Y.Doc): string => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
const load = (state: string): Y.Doc => { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(state, "base64")); return doc; };

/** Apply a proposal, then its inverse, and hand back both states. */
function roundTrip(doc: Y.Doc, operations: unknown[]): { applied: Y.Doc; reverted: Y.Doc } {
  const forward = commitSnapshots([encode(doc)], operations, "forward");
  const applied = load(forward.result);
  const back = commitSnapshots([forward.result], forward.inverse, "inverse", true);
  return { applied, reverted: load(back.result) };
}

function fixture(): Y.Doc {
  const doc = new Y.Doc();
  const file = new Y.Map<unknown>();
  doc.getMap("code.files").set("main", file);
  file.set("text", new Y.Text("print(1)"));
  doc.getMap("gfx.sprites").set("8,0", 3);
  return doc;
}

describe("reviewed reverts for every asset kind", () => {
  it("restores pixels and tiles, including raw section tiles", () => {
    const doc = fixture();
    const { applied, reverted } = roundTrip(doc, [
      { kind: "pixels", sheetId: "0", changes: [{ x: 0, y: 0, before: 0, after: 5 }, { x: 8, y: 0, before: 3, after: 0 }] },
      { kind: "tiles", mapId: "0", changes: [{ x: 2, y: 1, before: 0, sprite: 7 }] }
    ]);
    expect(applied.getMap("gfx.sprites").get("0,0")).toBe(5);
    expect(applied.getMap("gfx.sprites").has("8,0")).toBe(false);
    expect(applied.getMap("map.tiles").get("2,1")).toBe(7);
    expect(reverted.getMap("gfx.sprites").has("0,0")).toBe(false);
    expect(reverted.getMap("gfx.sprites").get("8,0")).toBe(3);
    expect(reverted.getMap("map.tiles").has("2,1")).toBe(false);
  });

  it("refuses a revert that would overwrite a later human edit", () => {
    const doc = fixture();
    const forward = commitSnapshots([encode(doc)], [{ kind: "pixels", sheetId: "0", changes: [{ x: 0, y: 0, before: 0, after: 5 }] }], "forward");
    const later = load(forward.result);
    later.getMap("gfx.sprites").set("0,0", 9);
    expect(() => commitSnapshots([encode(later)], forward.inverse, "inverse")).toThrow("changed");
  });

  it("restores and deletes catalog entries without claiming provenance", () => {
    const doc = fixture();
    const pixels = new Uint8Array(64); pixels[0] = 3;
    const entry = { id: "grass", name: "Grass", kind: "tile", resourceId: "0", x: 8, y: 0, width: 8, height: 8, tags: [], description: "", semantics: "walkable", contentHash: createHash("sha256").update(pixels).digest("hex") };
    const forward = commitSnapshots([encode(doc)], [{ kind: "catalog", before: null, after: entry }], "catalog");
    expect(forward.categories).toEqual([]);
    const reverted = load(commitSnapshots([forward.result], forward.inverse, "undo").result);
    expect(reverted.getMap("ai.catalog").has("grass")).toBe(false);
  });

  it("removes an added sound bundle only while it is untouched", () => {
    const doc = fixture();
    const sound = {
      kind: "sound", category: "SFX", slot: 2,
      samples: [{ id: "hit", data: Buffer.from(Int8Array.from([0, 40, -40, 0]).buffer).toString("base64") }],
      instruments: [{ id: "hit-i", name: "hit", osc: "sample", sampleId: "hit", sampleRoot: 60, duty: 0.5, detune: 0, glide: 0, volume: 0.5, pan: 0, colour: 1, env: { attack: 0, decay: 0.1, sustain: 0, release: 0.01 }, vibrato: { rate: 0, depth: 0, delay: 0 }, arp: { rate: 0 }, filter: { type: "off", cutoff: 8000, resonance: 0, envAmount: 0 } }],
      patterns: [{ id: "hit-p", slot: 9, name: "hit", steps: 16, stepsPerBeat: 4, bpm: 120, notes: [{ step: 0, length: 1, pitch: 60, volume: 1, instrument: "hit-i" }] }]
    };
    const { applied, reverted } = roundTrip(doc, [sound]);
    expect(applied.getMap("sound.samples").has("hit")).toBe(true);
    expect(reverted.getMap("sound.sfx").has("2")).toBe(false);
    expect(reverted.getMap("sound.instruments").has("hit-i")).toBe(false);
    expect(reverted.getMap("sound.samples").has("hit")).toBe(false);
    const forward = commitSnapshots([encode(doc)], [sound], "again");
    const edited = load(forward.result);
    edited.getMap<string>("sound.patterns").set("hit-p", "{}");
    expect(() => commitSnapshots([encode(edited)], forward.inverse, "undo")).toThrow("edited");
  });

  it("rejects oversized samples", () => {
    const sound = { kind: "sound", category: "SFX", slot: 2, samples: [{ id: "long", data: Buffer.alloc(9000).toString("base64") }], instruments: [], patterns: [{ id: "p", slot: 1, name: "p", steps: 16, stepsPerBeat: 4, bpm: 120, notes: [] }] };
    expect(() => commitSnapshots([encode(fixture())], [sound], "x")).toThrow("8192");
  });

  it("removes a created level only while it is unchanged, and grows maps without cutting tiles", () => {
    const doc = fixture();
    const id = "12345678-1234-1234-1234-123456789abc";
    const forward = commitSnapshots([encode(doc)], [{ kind: "create_map", id, name: "Two", width: 2, height: 2, assets: [null, null, null, null], description: "", profile: "visual" }], "level");
    expect(load(commitSnapshots([forward.result], forward.inverse, "undo").result).getMap("map.maps").has(id)).toBe(false);
    const edited = load(forward.result);
    (edited.getMap<Y.Map<unknown>>("map.maps").get(id)!.get("tiles") as Y.Map<number>).set("0,0", 4);
    expect(() => commitSnapshots([encode(edited)], forward.inverse, "undo")).toThrow("edited");

    const { applied, reverted } = roundTrip(doc, [{ kind: "resize_map", mapId: "0", beforeWidth: 128, beforeHeight: 32, width: 160, height: 40 }]);
    expect(applied.getMap("game.meta").get("mapWidth")).toBe(160);
    expect(reverted.getMap("game.meta").get("mapWidth")).toBe(128);
    const placed = load(commitSnapshots([encode(doc)], [{ kind: "resize_map", mapId: "0", beforeWidth: 128, beforeHeight: 32, width: 160, height: 40 }], "grow").result);
    placed.getMap("map.tiles").set("150,35", 1);
    expect(() => commitSnapshots([encode(placed)], [{ kind: "resize_map", mapId: "0", beforeWidth: 160, beforeHeight: 40, width: 128, height: 32 }], "shrink")).toThrow("placed tiles");
  });

  it("never writes inside a human-locked region", () => {
    const doc = fixture();
    doc.getMap("ai.locks").set("spawn", { name: "spawn room", target: "map", resourceId: "0", x: 0, y: 0, width: 4, height: 4 });
    expect(() => commitSnapshots([encode(doc)], [{ kind: "tiles", mapId: "0", changes: [{ x: 3, y: 3, before: 0, sprite: 1 }] }], "x")).toThrow("locked");
    expect(() => commitSnapshots([encode(doc)], [{ kind: "tiles", mapId: "0", changes: [{ x: 4, y: 3, before: 0, sprite: 1 }] }], "y")).not.toThrow();
  });

  it("bounds raw tile numbers by the sprites the sheets hold", () => {
    expect(() => commitSnapshots([encode(fixture())], [{ kind: "tiles", mapId: "0", changes: [{ x: 0, y: 0, before: 0, sprite: 256 }] }], "x")).toThrow("Invalid");
  });
});

describe("multiplayer declarations round-trip", () => {
  const perms = (doc: Y.Doc): Record<string, unknown> => doc.getMap("net.permissions").toJSON() as Record<string, unknown>;

  it("restores the flags and the starting value it replaced", () => {
    const doc = fixture();
    doc.getMap("net.permissions").set("players.score", { flags: 3, default: 0 });
    const { applied, reverted } = roundTrip(doc, [
      { kind: "net_permissions", path: "players.score", clientWrite: false, default: 100, expect: { flags: 3, default: 0 } }
    ]);
    expect(perms(applied)["players.score"]).toEqual({ flags: 1, default: 100 });
    expect(perms(reverted)["players.score"]).toEqual({ flags: 3, default: 0 });
  });

  it("removes a declaration it introduced, and restores one it deleted", () => {
    const doc = fixture();
    const added = roundTrip(doc, [{ kind: "net_permissions", path: "room.theme", clientWrite: false, expect: null }]);
    expect(perms(added.applied)["room.theme"]).toEqual({ flags: 1 });
    expect(perms(added.reverted)["room.theme"]).toBeUndefined();

    doc.getMap("net.permissions").set("secrets", { flags: 0 });
    const removed = roundTrip(doc, [{ kind: "net_permissions", path: "secrets", remove: true, expect: { flags: 0 } }]);
    expect(perms(removed.applied)["secrets"]).toBeUndefined();
    expect(perms(removed.reverted)["secrets"]).toEqual({ flags: 0 });
  });

  it("refuses to revert over something a person changed afterwards", () => {
    const doc = fixture();
    doc.getMap("net.permissions").set("secrets", { flags: 0, default: 1 });
    const forward = commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "secrets", clientWrite: true, expect: { flags: 0, default: 1 } }], "f");
    // Somebody edits the declaration after the change was applied, and a revert that ignored this
    // would undo their afternoon without saying so.
    const after = load(forward.result);
    after.getMap("net.permissions").set("secrets", { flags: 2, default: 42 });
    expect(() => commitSnapshots([encode(after)], forward.inverse, "i", true)).toThrow("changed since");
    // And a revert that finds the world unchanged still works.
    const clean = load(forward.result);
    expect(commitSnapshots([encode(clean)], forward.inverse, "i2", true).inverse).toBeDefined();
  });

  it("refuses a declaration with no expectation, rather than writing over whatever is there", () => {
    // The operation used to be able to arrive with no `expect` at all, in which case it took
    // whatever the document held and wrote over it. A colleague's declaration, made after the
    // proposal was written, vanished with nothing said. Failing closed is the point: `Naucto-AI`
    // fills the expectation in from the state it read.
    const doc = fixture();
    doc.getMap("net.permissions").set("players.score", { flags: 1 });
    expect(() => commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "players.score", clientWrite: true }], "x")).toThrow("must state what it expects");

    // Stating the declaration that has actually moved on is a conflict, and naming the one that is
    // really there applies cleanly.
    const stale = { kind: "net_permissions", path: "players.score", clientWrite: true, expect: { flags: 0 } };
    expect(() => commitSnapshots([encode(doc)], [stale], "y")).toThrow("changed since");
    expect(commitSnapshots([encode(doc)], [{ ...stale, expect: { flags: 1 } }], "z").inverse).toBeDefined();
    // And a declaration that is expected to be absent but is not, is the same conflict.
    expect(() => commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "players.score", clientWrite: true, expect: null }], "w")).toThrow("changed since");
  });

  it("refuses a removal that expected a different declaration, rather than deleting the new one", () => {
    // The remove branch is where this is easiest to lose: a removal deletes a key, so an expectation
    // that does not match means somebody re-declared that path since, and deleting it would take
    // their declaration with it.
    const doc = fixture();
    doc.getMap("net.permissions").set("secrets", { flags: 1, default: 7 });
    expect(() => commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "secrets", remove: true, expect: { flags: 0 } }], "x")).toThrow("changed since");
    // Removing a path that is not there is a no-op, refused on its own terms.
    expect(() => commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "absent", remove: true, expect: null }], "y")).toThrow("No such declaration");
  });

  it("records the category, so the receipt says the game changed for more than code", () => {
    const doc = fixture();
    const commit = commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "players.score", default: 0, expect: null }], "c");
    expect(commit.categories).toEqual(["MULTIPLAYER"]);
  });
});

describe("a path is a path", () => {
  const refuse = (op: unknown): void => {
    expect(() => commitSnapshots([encode(fixture())], [op], "x")).toThrow();
  };

  it("refuses a path the NET tab would not accept either", () => {
    // The Backend keeps its own validator on purpose: this is the trust boundary, and a proposal
    // is untrusted whether it came from the editor or from a key.
    for (const path of ["", ".players", "players.", "a..b", "players score", "players/score", "players.score;", "a".repeat(129)])
      refuse({ kind: "net_permissions", path, clientWrite: false });
  });

  it("refuses a path long enough to be a payload", () => {
    const long = `${"a".repeat(64)}.${"b".repeat(64)}`;
    refuse({ kind: "net_permissions", path: long, clientWrite: false });
  });

  it("refuses fields it would have to guess about", () => {
    const good = { kind: "net_permissions", path: "players.score" };
    refuse({ ...good, clientRead: "yes" });
    refuse({ ...good, default: { nested: true } });
    refuse({ ...good, remove: "yes" });
    refuse({ ...good, remove: true, clientWrite: false });
    refuse(good);
  });

  it("refuses the branch a lock or queue keeps its backing in", () => {
    // Seeding an owner there would deadlock the first acquisition permanently, and a permission
    // declared there is never consulted, so the name is not one a proposal may use.
    for (const path of ["__netobj__", "room.__netobj__", "room.__netobj__.owner", "a.__netobj__.b.q"])
      expect(() => commitSnapshots([encode(fixture())], [{ kind: "net_permissions", path, default: 1 }], "x")).toThrow("__netobj__");
  });

  it("answers a malformed declaration instead of throwing or reading it as open", () => {
    for (const bad of [null, "x", true, [], { default: 1 }, { flags: "no" }]) {
      const doc = fixture();
      doc.getMap("net.permissions").set("secrets", bad as never);
      // A peer can put anything in a collaborative map. Reading `null.flags` is a 500, and
      // treating the entry as absent would report the path as open when the host does not.
      expect(() => commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "secrets", clientWrite: true, expect: { flags: 0, default: 1 } }], "x")).toThrow("malformed");
    }
  });

  it("refuses a flags key, which would otherwise be dropped and leave the path open", () => {
    expect(() => commitSnapshots([encode(fixture())], [{ kind: "net_permissions", path: "secrets", flags: 0, default: 1 }], "x")).toThrow("clientRead");
  });

  it("refuses a starting value on a path that has children", () => {
    const doc = fixture();
    doc.getMap("net.permissions").set("players.score", { flags: 3 });
    // The engine reads a value before it reads a container, so a scalar here would shadow the
    // table and the game would index a number every frame.
    expect(() => commitSnapshots([encode(doc)], [{ kind: "net_permissions", path: "players", default: 0 }], "x")).toThrow("table");
  });

  it("bounds the starting value", () => {
    expect(() => commitSnapshots([encode(fixture())], [{ kind: "net_permissions", path: "title", default: "x".repeat(513) }], "x")).toThrow("too long");
    expect(() => commitSnapshots([encode(fixture())], [{ kind: "net_permissions", path: "n", default: Number.NaN }], "x")).toThrow("finite");
  });

  it("accepts the shapes a game actually uses", () => {
    const doc = fixture();
    const commit = commitSnapshots([encode(doc)], [
      { kind: "net_permissions", path: "players.score", default: 0, expect: null },
      { kind: "net_permissions", path: "room_theme2", clientWrite: false, expect: null },
      { kind: "net_permissions", path: "secrets", clientRead: false, clientWrite: false, expect: null },
      { kind: "net_permissions", path: "title", default: "Pip", expect: null },
      { kind: "net_permissions", path: "ready", default: true, expect: null },
    ], "ok");
    const written = (commit.result, load(commit.result).getMap("net.permissions").toJSON() as Record<string, unknown>);
    expect(written).toEqual({
      "players.score": { flags: 3, default: 0 },
      room_theme2: { flags: 1 },
      secrets: { flags: 0 },
      title: { flags: 3, default: "Pip" },
      ready: { flags: 3, default: true },
    });
  });
});
