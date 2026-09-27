import * as Y from "yjs";
import { commitSnapshots } from "./ai-commit";

const commitCodeSnapshots = (...args: Parameters<typeof commitSnapshots>): string => commitSnapshots(...args).result;

const sound = {
  kind: "sound", category: "SFX", slot: 4,
  instruments: [{ id: "coin", name: "coin", osc: "square", duty: 0.5, detune: 0, glide: 0,
    volume: 0.5, pan: 0, colour: 4, env: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.02 },
    vibrato: { rate: 0, depth: 0, delay: 0 }, arp: { rate: 0 }, filter: { type: "off", cutoff: 8000, resonance: 0, envAmount: 0 } }],
  patterns: [{ id: "coin-pattern", slot: 3, name: "coin", steps: 16, stepsPerBeat: 4, bpm: 120,
    notes: [{ step: 0, length: 1, pitch: 84, volume: 0.5, instrument: "coin" }] }]
};
const encode = (doc: Y.Doc): string => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");

describe("native sound proposals", () => {
  it("creates editable resources and never overwrites an occupied slot", () => {
    const doc = new Y.Doc();
    const result = commitCodeSnapshots([encode(doc)], [sound], "sfx");
    Y.applyUpdate(doc, Buffer.from(result, "base64"));
    expect(doc.getMap("sound.sfx").get("4")).toBe("coin-pattern");
    expect(JSON.parse(String(doc.getMap("sound.patterns").get("coin-pattern"))).notes[0].pitch).toBe(84);
    expect(doc.getMap("ai.applied").get("sfx")).toEqual({ categories: ["SFX"] });
    expect(() => commitCodeSnapshots([encode(doc)], [sound], "other")).toThrow("occupied");
    doc.destroy();
  });

  it("rejects malformed envelopes and missing instruments", () => {
    const doc = new Y.Doc();
    const bad = structuredClone(sound);
    bad.instruments[0]!.env.attack = -1;
    expect(() => commitCodeSnapshots([encode(doc)], [bad], "bad")).toThrow("Invalid native sound");
    const missing = structuredClone(sound);
    missing.patterns[0]!.notes[0]!.instrument = "missing";
    expect(() => commitCodeSnapshots([encode(doc)], [missing], "bad")).toThrow("Missing instrument");
    expect(doc.getMap("sound.instruments").size).toBe(0);
    doc.destroy();
  });
});
