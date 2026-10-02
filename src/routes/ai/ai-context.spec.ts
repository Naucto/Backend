import * as Y from "yjs";
import { buildContext } from "./ai-context";

describe("buildContext", () => {
  const state = (build: (doc: Y.Doc) => void): Uint8Array => {
    const doc = new Y.Doc();
    build(doc);
    return Y.encodeStateAsUpdate(doc);
  };

  it("reads a document that declares nothing as one default sheet and map", () => {
    const context = buildContext(state(() => undefined));
    expect(context["sheets"]).toEqual([expect.objectContaining({ id: "0", width: 128, height: 128, base: 0 })]);
    expect(context["maps"]).toEqual([expect.objectContaining({ id: "0", width: 128, height: 32 })]);
    expect(context["palette"]).toHaveLength(16);
  });

  it("reads the first sheet and map from the document's own roots, and code in order", () => {
    const context = buildContext(state((doc) => {
      doc.getMap<number>("gfx.sprites").set("1,0", 5);
      doc.getMap<number>("gfx.flags").set("2", 3);
      doc.getMap<number>("map.tiles").set("3,1", 70000 & 0xffff);
      const files = doc.getMap<Y.Map<unknown>>("code.files");
      for (const [id, order, text] of [["b", 1, "two"], ["a", 0, "one"]] as const) {
        const file = new Y.Map<unknown>();
        files.set(id, file);
        file.set("name", id);
        file.set("order", order);
        file.set("text", new Y.Text(text));
      }
    }));
    const [sheet] = context["sheets"] as { pixels: string; flags: number[] }[];
    expect(sheet!.pixels.slice(0, 3)).toBe("050");
    expect(sheet!.flags[2]).toBe(3);
    const [map] = context["maps"] as { width: number; tiles: number[] }[];
    expect(map!.tiles[1 * map!.width + 3]).toBe(70000 & 0xffff);
    expect((context["code"] as { text: string }[]).map((file) => file.text)).toEqual(["one", "two"]);
  });

  it("numbers later sheets after the sprites of the ones before", () => {
    const context = buildContext(state((doc) => {
      const sheets = doc.getMap<Y.Map<unknown>>("gfx.sheets");
      for (const [id, order] of [["0", 0], ["x", 1]] as const) {
        const entry = new Y.Map<unknown>();
        sheets.set(id, entry);
        entry.set("order", order);
        entry.set("w", 64);
        entry.set("h", 64);
      }
    }));
    expect((context["sheets"] as { id: string; base: number }[]).map((s) => [s.id, s.base])).toEqual([["0", 0], ["x", 64]]);
  });
});
