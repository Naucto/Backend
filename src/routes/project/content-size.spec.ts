import * as Y from "yjs";
import {
  GAME_KEYS,
  LEGACY_GAME_KEYS,
  computeContentSize,
  documentIdFor,
  mergeStates,
  isContentSizeBreakdown
} from "./content-size";

describe("computeContentSize", () => {
  it("treats an empty blob as an empty legacy game", () => {
    const size = computeContentSize(new Uint8Array());

    expect(size).toEqual({
      code: 0,
      sprites: 0,
      flags: 0,
      map: 0,
      sound: 0,
      palette: 16 * 7,
      total: 16 * 7,
      schemaVersion: 0
    });
  });

  it("measures the logical content of a v1 document", () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>(GAME_KEYS.meta).set("schemaVersion", 1);

    const file = new Y.Map<unknown>();
    const text = new Y.Text();
    doc.getMap<unknown>(GAME_KEYS.codeFiles).set("main", file);
    file.set("name", "main.lua");
    file.set("text", text);
    text.insert(0, "print('héllo')");

    const sprites = doc.getMap<number>(GAME_KEYS.sprites);
    sprites.set("0,0", 3);
    sprites.set("1,0", 0);
    sprites.set("2,0", 7);
    doc.getMap<number>(GAME_KEYS.flags).set("1", 4);
    const tiles = doc.getMap<number>(GAME_KEYS.tiles);
    tiles.set("0,0", 1);
    tiles.set("5,5", 2);
    tiles.set("6,6", 0);
    doc.getMap<string>(GAME_KEYS.instruments).set("a", "{\"id\":\"a\"}");
    doc.getMap<string>(GAME_KEYS.sfx).set("0", "p1");
    doc.getArray<string>(GAME_KEYS.palette).insert(0, ["#000000", "#ffffff"]);

    const size = computeContentSize(Y.encodeStateAsUpdate(doc));

    expect(size.schemaVersion).toBe(1);
    expect(size.code).toBe(Buffer.byteLength("print('héllo')", "utf8"));
    expect(size.sprites).toBe(2);
    expect(size.flags).toBe(1);
    expect(size.map).toBe(2);
    expect(size.sound).toBe("{\"id\":\"a\"}".length + "p1".length);
    expect(size.palette).toBe(2 * 7);
    expect(size.total).toBe(
      size.code + size.sprites + size.flags + size.map + size.sound + size.palette
    );
  });

  it("measures the legacy (v0) keys", () => {
    const doc = new Y.Doc();
    doc.getText(LEGACY_GAME_KEYS.code).insert(0, "function _update() end");
    doc.getMap<number>(LEGACY_GAME_KEYS.sprites).set("3,3", 9);
    doc.getMap<number>(LEGACY_GAME_KEYS.flags).set("2", 1);
    doc.getMap<number>(LEGACY_GAME_KEYS.tiles).set("1,1", 5);
    doc.getArray<string>(LEGACY_GAME_KEYS.musics).insert(0, ["{\"bpm\":120}"]);
    doc
      .getMap<string>(LEGACY_GAME_KEYS.customInstruments)
      .set("x", "{\"osc\":\"sine\"}");

    const size = computeContentSize(Y.encodeStateAsUpdate(doc));

    expect(size).toEqual({
      code: "function _update() end".length,
      sprites: 1,
      flags: 1,
      map: 1,
      sound: "{\"bpm\":120}".length + "{\"osc\":\"sine\"}".length,
      palette: 16 * 7,
      total:
        "function _update() end".length +
        3 +
        "{\"bpm\":120}".length +
        "{\"osc\":\"sine\"}".length +
        16 * 7,
      schemaVersion: 0
    });
  });
});

describe("isContentSizeBreakdown", () => {
  it("accepts a stored breakdown and rejects anything else", () => {
    expect(
      isContentSizeBreakdown({
        code: 1,
        sprites: 0,
        flags: 0,
        map: 0,
        sound: 0,
        palette: 0,
        total: 1,
        schemaVersion: 1
      })
    ).toBe(true);
    expect(isContentSizeBreakdown(null)).toBe(false);
    expect(isContentSizeBreakdown({ total: 1 })).toBe(false);
  });
});

describe("mergeStates", () => {
  const docWith = (text: string): Y.Doc => {
    const doc = new Y.Doc();
    doc.getMap("code.files").set("main", new Y.Map());
    (doc.getMap("code.files").get("main") as Y.Map<Y.Text>).set("text", new Y.Text(text));
    return doc;
  };
  const read = (blob: Buffer): string => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, blob);
    const text = (doc.getMap("code.files").get("main") as Y.Map<Y.Text>).get("text") as Y.Text;
    const value = text.toString();
    doc.destroy();
    return value;
  };

  it("keeps both editors' work when two saves land in the same slot", () => {
    // The case this exists for: a save is one editor's view, and two can be written in the same
    // instant with neither having seen the other's latest keystrokes. Writing one over the other
    // would erase the first writer's work entirely.
    const host = docWith("local player = {}\n");
    const assistant = new Y.Doc();
    Y.applyUpdate(assistant, Y.encodeStateAsUpdate(host));
    (assistant.getMap("code.files").get("main") as Y.Map<Y.Text>).get("text")!.insert(0, "-- from the assistant\n");

    const stored = Buffer.from(Y.encodeStateAsUpdate(host));
    const incoming = Buffer.from(Y.encodeStateAsUpdate(assistant));
    const merged = mergeStates(stored, incoming);
    expect(read(merged)).toContain("-- from the assistant");
    expect(read(merged)).toContain("local player");
  });

  it("does not care which of the two is newer", () => {
    const first = docWith("one\n");
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    (second.getMap("code.files").get("main") as Y.Map<Y.Text>).get("text")!.insert(0, "two\n");
    const a = Buffer.from(Y.encodeStateAsUpdate(first));
    const b = Buffer.from(Y.encodeStateAsUpdate(second));
    expect(read(mergeStates(a, b))).toBe(read(mergeStates(b, a)));
  });

  it("takes the incoming save when there is nothing stored, or what is stored cannot be read", () => {
    const next = Buffer.from(Y.encodeStateAsUpdate(docWith("only\n")));
    expect(mergeStates(null, next)).toEqual(next);
    expect(mergeStates(Buffer.alloc(0), next)).toEqual(next);
    // A blob from an older format is replaced, not merged: there is nothing in it to merge with, and
    // keeping it would leave a file nothing can open.
    expect(mergeStates(Buffer.from("not a document at all"), next)).toEqual(next);
  });

  it("refuses to merge a file from a different project", () => {
    // A Yjs update carries no identity of its own, so nothing downstream could tell that the result
    // of this merge was a document belonging to neither project — it would load as a project, with
    // both files in it, and no trace of how it got that way.
    const identified = (id: string, text: string): Buffer => {
      const doc = docWith(text);
      doc.getMap("game.meta").set("docId", id);
      return Buffer.from(Y.encodeStateAsUpdate(doc));
    };
    const mine = identified("alpha", "mine");
    const yours = identified("beta", "yours");
    expect(() => mergeStates(mine, yours)).toThrow(/different project/);
    expect(() => mergeStates(yours, mine)).toThrow(/different project/);
    // The same identity merges as before — two independent editors' writes at the same offset, so
    // only one of them is visible in the text; both are in the document either way.
    const merged = read(mergeStates(identified("alpha", "one"), identified("alpha", "two")));
    expect(merged === "one" || merged === "two").toBe(true);
  });

  it("merges as usual when one of the two states declares no identity", () => {
    // Every project saved before the identity existed has none, and "no identity" is not evidence of
    // a mismatch — refusing those would make every one of them unsaveable.
    const legacy = Buffer.from(Y.encodeStateAsUpdate(docWith("old\n")));
    const merged = read(mergeStates(legacy, Buffer.from(Y.encodeStateAsUpdate(docWith("new\n")))));
    expect(merged.length).toBeGreaterThan(0);
    // And the result really is a document, not a refusal.
    expect(() => read(mergeStates(legacy, Buffer.from(Y.encodeStateAsUpdate(docWith("new\n")))))).not.toThrow();
  });

  it("stamps a document with the identity its project derives", () => {
    // Derived rather than generated, so every editor of a project computes the same value before
    // writing anything. Generated per editor, two people opening the same project would each write
    // a different one and a save would be refused as belonging to another project — a refusal that
    // would be indistinguishable from a real mismatch.
    expect(documentIdFor(139)).toBe("p139");
    expect(documentIdFor(140)).not.toBe(documentIdFor(139));
  });

  it("refuses an incoming save that cannot be read even when there is nothing stored", () => {
    // "Nothing to merge with" is reached by a new window, a legacy blob and an oversized one, and
    // the check used to live only on the path that merges. So bytes that were not a document could
    // be written as the newest slot — after which the project no longer opens, and there is no
    // editor open to repair it. Checked first, so the answer does not depend on what is stored.
    expect(() => mergeStates(null, Buffer.from("not a document at all"))).toThrow();
    expect(() => mergeStates(Buffer.alloc(0), Buffer.from("not a document at all"))).toThrow();
  });

  it("refuses an incoming save that cannot be read, rather than writing it over a good one", () => {
    // The two sides fail for the same reason and mean opposite things. What is stored can be
    // discarded because the incoming save replaces it; an incoming save that is not a document is
    // bytes from nowhere, and keeping it would trade a recoverable state for an unrecoverable one —
    // the stored document is gone and the slot now holds something nothing can open.
    const stored = Buffer.from(Y.encodeStateAsUpdate(docWith("-- a real document\n")));
    expect(() => mergeStates(stored, Buffer.from("not a document at all"))).toThrow();
  });
});
