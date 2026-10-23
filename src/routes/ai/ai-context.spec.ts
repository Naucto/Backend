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

  it("preserves named sheets, geometry, locks, audio and network declarations", () => {
    const context = buildContext(state((doc) => {
      doc.getMap("game.meta").set("mapWidth", 12);
      const sheet = new Y.Map<unknown>();
      doc.getMap("gfx.sheets").set("art", sheet);
      sheet.set("name", "Characters");
      sheet.set("w", 16);
      sheet.set("h", 8);
      sheet.set("pixels", new Y.Map([["0,0", 7]]));
      doc.getMap("ai.locks").set("protected", { target: "sheet", resourceId: "art", x: 0, y: 0, width: 8, height: 8 });
      doc.getMap("sound.patterns").set("p", JSON.stringify({ id: "p", notes: [] }));
      doc.getMap("net.permissions").set("players.score", { flags: 1, default: 0 });
    }));
    expect(context["sheets"]).toEqual([
      expect.objectContaining({ id: "art", name: "Characters", width: 16, height: 8, pixels: "7" + "0".repeat(127) }),
    ]);
    expect(context["maps"]).toEqual([expect.objectContaining({ width: 12 })]);
    expect(context["locks"]).toEqual({ protected: { target: "sheet", resourceId: "art", x: 0, y: 0, width: 8, height: 8 } });
    expect(context["patterns"]).toEqual({ p: JSON.stringify({ id: "p", notes: [] }) });
    expect(context["netPermissions"]).toEqual({ "players.score": { flags: 1, default: 0 } });
  });

});
