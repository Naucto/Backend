import * as Y from "yjs";
import { NON_INVERTIBLE_KINDS, OPERATION_KINDS, commitSnapshots } from "./ai-commit";

import { createHash } from "node:crypto";

const commitCodeSnapshots = (...args: Parameters<typeof commitSnapshots>): string => commitSnapshots(...args).result;

const encode = (doc: Y.Doc): string => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
function fixture(): Y.Doc {
  const doc = new Y.Doc();
  const file = new Y.Map<unknown>();
  doc.getMap("code.files").set("main", file);
  file.set("text", new Y.Text("old"));
  return doc;
}
const code = (doc: Y.Doc): string => (doc.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!).toString();

describe("the list of operations that cannot be undone", () => {
  // `NON_INVERTIBLE_KINDS` is written by hand, and `proposeRevert` trusts it: a kind that records
  // no inverse and is not on the list would be offered as a partial undo that restores what it can
  // and says nothing about what stayed gone.
  it("names only kinds the union actually has, so a rename cannot leave a stale entry", () => {
    for (const kind of NON_INVERTIBLE_KINDS) expect(OPERATION_KINDS).toContain(kind as (typeof OPERATION_KINDS)[number]);
  });

  it("covers the two operations that record no inverse", () => {
    // Both remove something the document no longer holds a description of. Putting them back would
    // mean inventing the content, so `prepare*` returns an empty inverse for them.
    const sound = fixture();
    sound.getMap<string>("sound.sfx").set("3", "[]");
    expect(commitSnapshots([encode(sound)], [{ kind: "delete_sound", category: "SFX", slot: 3, slotValue: "[]", instruments: [], patterns: [], samples: [] }], "d").inverse).toEqual([]);
    expect(NON_INVERTIBLE_KINDS.has("delete_sound")).toBe(true);
    expect(NON_INVERTIBLE_KINDS.has("delete_map")).toBe(true);
  });

  it("does not list a kind that does record one", () => {
    expect(NON_INVERTIBLE_KINDS.has("code")).toBe(false);
    expect(commitSnapshots([encode(fixture())], [{ kind: "code", fileId: "main", before: "old", after: "new" }], "c").inverse.length).toBeGreaterThan(0);
  });
});

describe("collaborative AI commit", () => {
  it("creates a second level without changing the first map", () => {
    const doc = fixture();
    doc.getMap("map.tiles").set("0,0", 3);
    const id = "12345678-1234-1234-1234-123456789abc";
    const result = commitCodeSnapshots([encode(doc)], [{ kind: "create_map", id, name: "Second", width: 2, height: 2, assets: [null, null, null, null], description: "Another level", profile: "top-down" }], "level");
    const after = new Y.Doc();
    Y.applyUpdate(after, Buffer.from(result, "base64"));
    expect(after.getMap("map.tiles").get("0,0")).toBe(3);
    expect(after.getMap("map.maps").size).toBe(2);
    expect(after.getMap("ai.levels").get(id)).toMatchObject({ name: "Second", gameplayValidated: false });
    expect(() => commitCodeSnapshots([Buffer.from(Y.encodeStateAsUpdate(after)).toString("base64")], [{ kind: "create_map", id, name: "Again", width: 1, height: 1, assets: [null], description: "", profile: "visual" }], "duplicate")).toThrow("occupied");
    doc.destroy(); after.destroy();
  });
  it("resolves catalog tiles and rejects stale asset references", () => {
    const doc = fixture();
    doc.getMap("gfx.sprites").set("8,0", 3);
    const pixels = new Uint8Array(64); pixels[0] = 3;
    const catalog = doc.getMap("ai.catalog");
    catalog.set("grass", { kind: "tile", resourceId: "0", x: 8, y: 0, width: 8, height: 8, contentHash: createHash("sha256").update(pixels).digest("hex") });
    const ops = [{ kind: "tiles", mapId: "0", changes: [{ x: 0, y: 0, before: 0, assetId: "grass" }] }];
    const result = new Y.Doc();
    Y.applyUpdate(result, Buffer.from(commitCodeSnapshots([encode(doc)], ops, "tiles"), "base64"));
    expect(result.getMap("map.tiles").get("0,0")).toBe(1);
    doc.getMap("gfx.sprites").set("8,0", 4);
    expect(() => commitCodeSnapshots([encode(doc)], ops, "other")).toThrow("Catalog tile changed");
    result.destroy(); doc.destroy();
  });

  it("applies pixels only within bounds and preserves rejected input", () => {
    const doc = fixture();
    expect(() => commitCodeSnapshots([encode(doc)], [{ kind: "pixels", sheetId: "0", changes: [{ x: 128, y: 0, before: 0, after: 3 }] }], "bad")).toThrow("Invalid asset");
    expect(doc.getMap("gfx.sprites").size).toBe(0);
    const result = new Y.Doc();
    Y.applyUpdate(result, Buffer.from(commitCodeSnapshots([encode(doc)], [{ kind: "pixels", sheetId: "0", changes: [{ x: 1, y: 2, before: 0, after: 3 }] }], "pixels"), "base64"));
    expect(result.getMap("gfx.sprites").get("1,2")).toBe(3);
    result.destroy(); doc.destroy();
  });
  it("merges every frozen editor before testing preconditions", () => {
    const a = fixture(), b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    b.getMap<Y.Map<Y.Text>>("code.files").get("main")!.get("text")!.insert(0, "human ");
    expect(() => commitCodeSnapshots([encode(a), encode(b)], [{ kind: "code", fileId: "main", before: "old", after: "new" }], "p")).toThrow("Code changed");
    expect(code(a)).toBe("old");
    expect(code(b)).toBe("human old");
  });

  it("preserves unrelated concurrent work and records the proposal once", () => {
    const a = fixture(), b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    b.getMap("gfx.sprites").set("0,0", 5);
    const result = commitCodeSnapshots([encode(a), encode(b)], [{ kind: "code", fileId: "main", before: "old", after: "new" }], "p");
    Y.applyUpdate(a, Buffer.from(result, "base64"));
    Y.applyUpdate(a, Buffer.from(result, "base64"));
    expect(code(a)).toBe("new");
    expect(a.getMap("gfx.sprites").get("0,0")).toBe(5);
    expect(a.getMap("ai.applied").size).toBe(1);
    expect(() => commitCodeSnapshots([encode(a)], [{ kind: "code", fileId: "main", before: "new", after: "oops" }], "p")).toThrow("Already applied");
  });

  it("does not silently accept non-code mutations", () => {
    expect(() => commitCodeSnapshots([encode(fixture())], [{ kind: "opaqueUpdate" }], "p")).toThrow("Unsupported operation");
  });
});
