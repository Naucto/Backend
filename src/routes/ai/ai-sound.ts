import { ConflictException } from "@nestjs/common";
import * as Y from "yjs";
import type { Operation, Prepared } from "./ai-assets";

/** The console's sample budget: signed 8-bit mono at 8 kHz, one second at most. */
const MAX_SAMPLE_BYTES = 8192;

const fail = (): never => { throw new ConflictException("Invalid native sound proposal"); };
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function range(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return fail();
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) return fail();
  return value;
}

function validateInstrument(instrument: Record<string, unknown>, samples: Set<string>, library: Y.Map<string>): void {
  if (typeof instrument["name"] !== "string" || instrument["name"].length > 100 || !["square", "sine", "triangle", "saw", "noise", "sample"].includes(String(instrument["osc"]))) fail();
  range(instrument["duty"], 0, 1); range(instrument["detune"], -12, 12); range(instrument["glide"], 0, 10);
  range(instrument["volume"], 0, 1); range(instrument["pan"], -1, 1); range(instrument["colour"], 0, 15);
  const env = obj(instrument["env"]), vibrato = obj(instrument["vibrato"]), arp = obj(instrument["arp"]), filter = obj(instrument["filter"]);
  for (const field of ["attack", "decay", "release"]) range(env[field], 0, 10);
  range(env["sustain"], 0, 1);
  range(vibrato["rate"], 0, 100); range(vibrato["depth"], 0, 24); range(vibrato["delay"], 0, 10);
  range(arp["rate"], 0, 100);
  if (!["off", "lp", "hp", "bp"].includes(String(filter["type"]))) fail();
  range(filter["cutoff"], 0, 24000); range(filter["resonance"], 0, 1); range(filter["envAmount"], -1, 10);
  if (instrument["osc"] === "sample") {
    const sample = id(instrument["sampleId"]);
    if (!samples.has(sample)) throw new ConflictException("Missing sample");
    range(instrument["sampleRoot"], 0, 127);
  }
  void library;
}

/** New sound bundles only: occupied resources and slots are never overwritten. */
export function prepareSound(doc: Y.Doc, operation: Operation, touch: (key: string) => void): Prepared {
  const category = operation["category"];
  if (category !== "MUSIC" && category !== "SFX") return fail();
  const instruments = operation["instruments"], patterns = operation["patterns"], samples = operation["samples"] ?? [];
  if (!Array.isArray(instruments) || !Array.isArray(patterns) || !patterns.length || !Array.isArray(samples)) return fail();
  const library = doc.getMap<string>("sound.instruments"), bank = doc.getMap<string>("sound.patterns"), store = doc.getMap<string>("sound.samples");
  const writes: (() => void)[] = [];
  const created = { instruments: [] as string[], patterns: [] as string[], samples: [] as string[] };
  const sampleIds = new Set<string>(store.keys());
  for (const raw of samples as unknown[]) {
    const sample = obj(raw), key = id(sample["id"]), data = sample["data"];
    touch(`sample:${key}`);
    if (store.has(key)) throw new ConflictException("Sample ID occupied");
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || Buffer.from(data, "base64").length > MAX_SAMPLE_BYTES || !Buffer.from(data, "base64").length) {
      throw new ConflictException("Samples are base64 signed 8-bit mono at 8 kHz, at most 8192 bytes");
    }
    sampleIds.add(key); created.samples.push(key);
    writes.push(() => { store.set(key, data); });
  }
  const made = new Set<string>();
  for (const raw of instruments as unknown[]) {
    const instrument = obj(raw), key = id(instrument["id"]);
    touch(`instrument:${key}`);
    if (library.has(key) || made.has(key)) throw new ConflictException("Instrument ID occupied");
    validateInstrument(instrument, sampleIds, library);
    made.add(key); created.instruments.push(key);
    writes.push(() => { library.set(key, JSON.stringify(instrument)); });
  }
  const patternIds = new Set<string>();
  const slots = new Set<number>();
  bank.forEach(value => { try { const p = obj(JSON.parse(value)); if (typeof p["slot"] === "number") slots.add(p["slot"]); } catch { /* a malformed legacy entry has no usable slot */ } });
  for (const raw of patterns as unknown[]) {
    const pattern = obj(raw), key = id(pattern["id"]);
    touch(`pattern:${key}`);
    if (bank.has(key) || patternIds.has(key)) throw new ConflictException("Pattern ID occupied");
    const slot = range(pattern["slot"], 0, 255), steps = range(pattern["steps"], 16, 64);
    if (!Number.isInteger(slot) || slots.has(slot) || steps % 16) return fail();
    slots.add(slot); patternIds.add(key); created.patterns.push(key);
    range(pattern["bpm"], 40, 240);
    if (![1, 2, 4, 8].includes(Number(pattern["stepsPerBeat"])) || typeof pattern["name"] !== "string" || pattern["name"].length > 100) return fail();
    const notes = pattern["notes"];
    if (!Array.isArray(notes)) return fail();
    for (const rawNote of notes as unknown[]) {
      const note = obj(rawNote);
      const step = range(note["step"], 0, steps - 0.125), length = range(note["length"], 0.125, 1024), pitch = range(note["pitch"], 0, 127);
      if (!Number.isInteger(pitch) || !Number.isInteger(step * 8) || !Number.isInteger(length * 8)) return fail();
      range(note["volume"], 0, 1);
      const instrument = id(note["instrument"]);
      if (!made.has(instrument) && !library.has(instrument)) throw new ConflictException("Missing instrument");
    }
    writes.push(() => { bank.set(key, JSON.stringify(pattern)); });
  }
  const slot = range(operation["slot"], 0, category === "MUSIC" ? 15 : 255);
  if (!Number.isInteger(slot)) return fail();
  const target = doc.getMap<string>(category === "MUSIC" ? "sound.songs" : "sound.sfx");
  touch(`${category}:${slot}`);
  if (target.has(String(slot))) throw new ConflictException("Sound slot occupied");
  let slotValue: string;
  if (category === "SFX") {
    if (patterns.length !== 1) return fail();
    slotValue = id(obj(patterns[0])["id"]);
  } else {
    const song = obj(operation["song"]), sequence = song["sequence"];
    if (!Array.isArray(sequence) || !sequence.length || typeof song["name"] !== "string" || typeof song["loop"] !== "boolean") return fail();
    if (sequence.some(key => typeof key !== "string" || !patternIds.has(key))) return fail();
    const loopStart = range(song["loopStart"], 0, sequence.length - 1);
    if (!Number.isInteger(loopStart)) return fail();
    slotValue = JSON.stringify(song);
  }
  writes.push(() => { target.set(String(slot), slotValue); });
  // Removing the bundle later is allowed only while every part of it is still exactly as created.
  const snapshot = (map: Y.Map<string>, keys: string[], values: Map<string, string>): { id: string; value: string }[] =>
    keys.map(key => ({ id: key, value: values.get(key) ?? map.get(key) ?? "" }));
  const values = new Map<string, string>();
  for (const raw of [...(instruments as unknown[]), ...(patterns as unknown[])]) { const item = obj(raw); values.set(String(item["id"]), JSON.stringify(item)); }
  for (const raw of samples as unknown[]) { const item = obj(raw); values.set(String(item["id"]), String(item["data"])); }
  return {
    category,
    writes,
    inverse: [{
      kind: "delete_sound", category, slot, slotValue,
      instruments: snapshot(library, created.instruments, values),
      patterns: snapshot(bank, created.patterns, values),
      samples: snapshot(store, created.samples, values),
    }],
  };
}

export function prepareSoundRemoval(doc: Y.Doc, operation: Operation, touch: (key: string) => void): Prepared {
  const category = operation["category"];
  if (category !== "MUSIC" && category !== "SFX") return fail();
  const slot = String(range(operation["slot"], 0, 255));
  const target = doc.getMap<string>(category === "MUSIC" ? "sound.songs" : "sound.sfx");
  const changed = (): never => { throw new ConflictException("The sound was edited after it was added; remove it manually"); };
  if (target.get(slot) !== operation["slotValue"]) changed();
  touch(`${category}:${slot}`);
  const removals: (() => void)[] = [(): void => { target.delete(slot); }];
  const groups: [string, Y.Map<string>][] = [["instruments", doc.getMap("sound.instruments")], ["patterns", doc.getMap("sound.patterns")], ["samples", doc.getMap("sound.samples")]];
  for (const [field, map] of groups) {
    const items = operation[field];
    if (!Array.isArray(items) || items.length > 32) return fail();
    for (const raw of items as unknown[]) {
      const item = obj(raw), key = id(item["id"]);
      if (map.get(key) !== item["value"]) changed();
      touch(`${field}:${key}`);
      removals.push(() => { map.delete(key); });
    }
  }
  // Something else still playing a removed instrument or pattern would be left pointing at nothing.
  const removedPatterns = new Set((operation["patterns"] as { id: string }[]).map(p => p.id));
  const removedInstruments = new Set((operation["instruments"] as { id: string }[]).map(i => i.id));
  doc.getMap<string>("sound.patterns").forEach((value, key) => {
    if (removedPatterns.has(key)) return;
    if ([...removedInstruments].some(instrument => value.includes(`"instrument":"${instrument}"`))) throw new ConflictException("Another pattern uses an instrument this revert would remove");
  });
  for (const bankName of ["sound.songs", "sound.sfx"]) {
    doc.getMap<string>(bankName).forEach((value, key) => {
      if (bankName === (category === "MUSIC" ? "sound.songs" : "sound.sfx") && key === slot) return;
      if ([...removedPatterns].some(pattern => value === pattern || value.includes(`"${pattern}"`))) throw new ConflictException("Another song or effect uses a pattern this revert would remove");
    });
  }
  return { category, writes: removals, inverse: [] };
}
