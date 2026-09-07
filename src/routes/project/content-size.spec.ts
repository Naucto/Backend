import * as Y from "yjs";
import {
  GAME_KEYS,
  LEGACY_GAME_KEYS,
  computeContentSize,
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
