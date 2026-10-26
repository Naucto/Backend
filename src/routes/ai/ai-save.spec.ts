import * as Y from "yjs";
import { Game, aiContext } from "@naucto/engine/headless";
import { decodeSave, differences, encodeSave, mergeSave, overlaySave, reviewSave, saveHash, saveUnits } from "./ai-save";

const save = (files: Record<string, string>, music = "original"): string => {
  const doc = new Y.Doc();
  try {
    for (const [id, text] of Object.entries(files)) {
      const entry = new Y.Map<unknown>(); doc.getMap("code.files").set(id, entry);
      entry.set("name", id); entry.set("text", new Y.Text(text));
    }
    const song = { id: "song", patterns: [music] };
    doc.getMap("sound.songs").set("song", JSON.stringify(song));
    doc.getMap("sound.samples").set("sample", "AQID");
    return encodeSave(doc);
  } finally { doc.destroy(); }
};
const texts = (snapshot: string): Record<string, string> => {
  const doc = decodeSave(snapshot);
  try { return Object.fromEntries((aiContext(new Game(doc))["code"] as { id: string; text: string }[]).map(f => [f.id, f.text])); }
  finally { doc.destroy(); }
};

describe("AI saves: semantic three-way merge", () => {
  it("merges independent files from unrelated Yjs histories without concatenating code", () => {
    const base = save({ main: "original", helper: "old" });
    const ai = save({ main: "AI", helper: "old" });
    const user = save({ main: "original", helper: "user" });
    const merged = mergeSave(base, ai, user);
    expect(merged.conflicts).toEqual([]);
    expect(texts(merged.snapshot)).toEqual({ main: "AI", helper: "user" });
  });
  it("reports conflicts without silently choosing a side and resolves explicitly", () => {
    const base = save({ main: "base" }), ai = save({ main: "AI" }), user = save({ main: "human" });
    expect(mergeSave(base, ai, user).conflicts.map(d => d.id)).toEqual(["code:main"]);
    expect(texts(mergeSave(base, ai, user, { "code:main": "latest" }).snapshot)).toEqual({ main: "human" });
    expect(texts(mergeSave(base, ai, user, { "code:main": "draft" }).snapshot)).toEqual({ main: "AI" });
    expect(() => mergeSave(base, ai, user, { wrong: "draft" })).toThrow();
  });
  it("takes a complete large imported sound bank, including binary samples, without manual merging", () => {
    const base = save({ main: "base" }), ai = save({ main: "AI" }, "ai-theme"), user = save({ main: "base" }, "user-import".repeat(10000));
    expect(mergeSave(base, ai, user).conflicts.map(d => d.id)).toEqual(["sound"]);
    const merged = mergeSave(base, ai, user, { sound: "latest" });
    expect(saveUnits(merged.snapshot)["sound"]).toEqual(saveUnits(user)["sound"]);
    expect(texts(merged.snapshot)).toEqual({ main: "AI" });
    const doc = decodeSave(merged.snapshot);
    try { expect(Buffer.from(String(doc.getMap("sound.samples").get("sample")), "base64")).toEqual(Buffer.from([1, 2, 3])); } finally { doc.destroy(); }
  });
  it("handles delete/change conflicts and deletion without resurrecting a file", () => {
    const base = save({ main: "base", other: "old" }), ai = save({ main: "base" }), user = save({ main: "base", other: "new" });
    expect(mergeSave(base, ai, user).conflicts.map(d => d.id)).toEqual(["code:other"]);
    expect(texts(mergeSave(base, ai, user, { "code:other": "draft" }).snapshot)).toEqual({ main: "base" });
  });
  it("accepts some units, rejects others and preserves unreviewed work with its old conflict base", () => {
    const base = save({ main: "base", other: "base", todo: "base" });
    const ai = save({ main: "AI", other: "reject", todo: "pending" });
    const user = save({ main: "base", other: "base", todo: "human" });
    const reviewed = reviewSave(base, ai, user, ["code:main"], ["code:other"], {});
    expect(texts(reviewed.result)).toEqual({ main: "AI", other: "base", todo: "human" });
    expect(texts(reviewed.remaining)).toEqual({ main: "AI", other: "base", todo: "pending" });
    expect(differences(reviewed.nextBase, reviewed.remaining, reviewed.result).filter(d => d.conflict).map(d => d.id)).toEqual(["code:todo"]);
    expect(reviewed.categories).toEqual(["CODE"]);
  });
  it("resets the entire draft to the user state after rejecting everything", () => {
    const base = save({ main: "base" }), ai = save({ main: "AI" }), user = save({ main: "user" });
    const reviewed = reviewSave(base, ai, user, [], ["code:main"], {});
    expect(saveHash(saveUnits(reviewed.remaining))).toBe(saveHash(saveUnits(user)));
    expect(reviewed.categories).toEqual([]);
  });
  it("does not import AI receipts or locks through raw game-content overlays", () => {
    const original = save({ main: "base" }), doc = decodeSave(save({ main: "AI" }));
    doc.getMap("ai.applied").set("forged", true); doc.getMap("ai.locks").set("forged", true);
    const result = overlaySave(original, saveUnits(encodeSave(doc))); doc.destroy();
    const output = decodeSave(result);
    try { expect(output.getMap("ai.applied").size).toBe(0); expect(output.getMap("ai.locks").size).toBe(0); } finally { output.destroy(); }
  });
  it("rejects malformed snapshots and invalid review selections", () => {
    expect(() => decodeSave("not base64")).toThrow();
    const base = save({ main: "base" }), ai = save({ main: "AI" });
    expect(() => reviewSave(base, ai, base, ["code:main"], ["code:main"], {})).toThrow();
    expect(() => reviewSave(base, ai, save({ main: "user" }), ["code:main"], [], {})).toThrow();
  });
  it("reads multi-megabyte native saves without recursive base64 validation", () => {
    const original = save({ main: "large" }, "music".repeat(300000));
    const doc = decodeSave(original);
    try { expect(doc.getMap("sound.songs").get("song")).toContain("music"); }
    finally { doc.destroy(); }
  });

  it("does not mark catalog annotations as generated artwork", () => {
    const base = save({ main: "base" }), draft = decodeSave(base);
    draft.getMap("ai.catalog").set("tile", { id: "tile", description: "Annotated existing artwork" });
    const edited = encodeSave(draft); draft.destroy();
    expect(reviewSave(base, edited, base, ["graphics"], [], {}).categories).toEqual([]);
  });

});
