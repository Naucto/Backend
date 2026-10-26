import { BadRequestException, ConflictException } from "@nestjs/common";
import { Game, KEYS, aiContext } from "@naucto/engine/headless";
import { createHash } from "node:crypto";
import * as Y from "yjs";

export const MAX_SAVE_BYTES = 16 * 1024 * 1024;
type Node = { kind: "map"; entries: [string, Node][] } | { kind: "array"; items: Node[] } | { kind: "text"; text: string } | { kind: "value"; value: unknown };
export type Units = Record<string, Node>;
export type Choice = "draft" | "latest";
export interface SaveDifference { id: string; baseHash: string | null; draftHash: string | null; latestHash: string | null; draftChanged: boolean; latestChanged: boolean; conflict: boolean }
const GRAPHICS = [KEYS.meta, KEYS.palette, KEYS.sheets, KEYS.sprites, KEYS.flags, KEYS.maps, KEYS.tiles, "ai.catalog", "ai.levels"];
const SOUND = [KEYS.instruments, KEYS.patterns, KEYS.songs, KEYS.sfx, KEYS.samples];
const TEXTS = [KEYS.projectName, KEYS.shortDescription, KEYS.longDescription, KEYS.iconUrl, KEYS.projectTags];
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
};
export const saveHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const equal = (a: unknown, b: unknown): boolean => saveHash(a ?? null) === saveHash(b ?? null);

export function decodeSave(snapshot: string): Y.Doc {
  if (!snapshot || snapshot.length > Math.ceil(MAX_SAVE_BYTES / 3) * 4 || snapshot.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(snapshot)) throw new BadRequestException("Invalid or oversized save");
  const bytes = Buffer.from(snapshot, "base64");
  if (bytes.length > MAX_SAVE_BYTES || bytes.toString("base64") !== snapshot) throw new BadRequestException("Invalid or oversized save");
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, bytes); aiContext(new Game(doc)); return doc; }
  catch { doc.destroy(); throw new BadRequestException("Unreadable game save"); }
}
export const encodeSave = (doc: Y.Doc): string => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
const nodeOf = (value: unknown): Node => {
  if (value instanceof Y.Text) return { kind: "text", text: value.toString() };
  if (value instanceof Y.Map) return { kind: "map", entries: [...value.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, nodeOf(v)]) };
  if (value instanceof Y.Array) return { kind: "array", items: value.toArray().map(nodeOf) };
  return { kind: "value", value };
};
const valueOf = (node: Node): unknown => {
  switch (node.kind) {
  case "map": return new Y.Map(node.entries.map(([k, v]) => [k, valueOf(v)]));
  case "array": { const array = new Y.Array(); array.push(node.items.map(valueOf)); return array; }
  case "text": return new Y.Text(node.text);
  case "value": return node.value;
  }
};
const root = (doc: Y.Doc, key: string): Y.Map<unknown> | Y.Array<unknown> | Y.Text => key === KEYS.palette ? doc.getArray(key) : TEXTS.includes(key as typeof TEXTS[number]) ? doc.getText(key) : doc.getMap(key);
const group = (doc: Y.Doc, keys: string[]): Node => ({ kind: "map", entries: keys.map(key => [key, nodeOf(root(doc, key))]) });

/** Logical merge units. Sound and graphics banks stay atomic to preserve cross-resource references. */
export function saveUnits(snapshot: string): Units {
  const doc = decodeSave(snapshot);
  try {
    const units: Units = Object.create(null) as Units;
    for (const [id, file] of doc.getMap(KEYS.codeFiles)) units[`code:${id}`] = nodeOf(file);
    units["graphics"] = group(doc, GRAPHICS);
    units["sound"] = group(doc, SOUND);
    units["network"] = nodeOf(doc.getMap(KEYS.netPermissions));
    units["metadata"] = group(doc, [KEYS.codeMeta, ...TEXTS]);
    return units;
  } finally { doc.destroy(); }
}
export function differences(base: string, draft: string, latest: string): SaveDifference[] {
  const b = saveUnits(base), d = saveUnits(draft), l = saveUnits(latest);
  return [...new Set([...Object.keys(b), ...Object.keys(d), ...Object.keys(l)])].sort().map(id => {
    const draftChanged = !equal(b[id], d[id]), latestChanged = !equal(b[id], l[id]);
    return { id, baseHash: b[id] ? saveHash(b[id]) : null, draftHash: d[id] ? saveHash(d[id]) : null, latestHash: l[id] ? saveHash(l[id]) : null, draftChanged, latestChanged, conflict: draftChanged && latestChanged && !equal(d[id], l[id]) };
  }).filter(diff => diff.draftChanged || diff.latestChanged);
}
function setRoot(doc: Y.Doc, key: string, node: Node): void {
  const target = root(doc, key);
  if (target instanceof Y.Map && node.kind === "map") {
    target.clear(); for (const [k, v] of node.entries) target.set(k, valueOf(v));
  } else if (target instanceof Y.Text && node.kind === "text") { target.delete(0, target.length); target.insert(0, node.text); }
  else if (target instanceof Y.Array && node.kind === "array") { target.delete(0, target.length); target.insert(0, node.items.map(valueOf)); }
  else throw new BadRequestException("Save root has an incompatible type");
}
/** Write semantic content through Game.restoreFrom, never merge a stale CRDT history into the user document. */
export function overlaySave(snapshot: string, changes: Record<string, Node | null>): string {
  const doc = decodeSave(snapshot), target = decodeSave(snapshot);
  try {
    for (const [id, node] of Object.entries(changes)) {
      if (id.startsWith("code:")) {
        const files = target.getMap(KEYS.codeFiles), key = id.slice(5);
        if (node) files.set(key, valueOf(node)); else files.delete(key);
      } else if (id === "network" && node) setRoot(target, KEYS.netPermissions, node);
      else if (node?.kind === "map" && ["graphics", "sound", "metadata"].includes(id)) for (const [key, child] of node.entries) setRoot(target, key, child);
      else throw new BadRequestException("Unknown save unit");
    }
    new Game(doc).restoreFrom(Y.encodeStateAsUpdate(target));
    const result = encodeSave(doc);
    if (Buffer.from(result, "base64").length > MAX_SAVE_BYTES) throw new BadRequestException("Save exceeds 16 MiB");
    return result;
  } finally { doc.destroy(); target.destroy(); }
}
export function mergeSave(base: string, draft: string, latest: string, resolutions: Record<string, Choice> = {}): { snapshot: string; conflicts: SaveDifference[] } {
  const diffs = differences(base, draft, latest), d = saveUnits(draft);
  const conflicts = diffs.filter(diff => diff.conflict && !Object.prototype.hasOwnProperty.call(resolutions, diff.id));
  for (const [id, choice] of Object.entries(resolutions)) if (!diffs.some(diff => diff.id === id && diff.conflict) || !["draft", "latest"].includes(choice)) throw new BadRequestException("Resolution does not name a current conflict");
  if (conflicts.length) return { snapshot: draft, conflicts };
  const changes: Record<string, Node | null> = Object.create(null) as Record<string, Node | null>;
  for (const diff of diffs) if (diff.draftChanged && (!diff.latestChanged || !diff.conflict || resolutions[diff.id] === "draft")) changes[diff.id] = d[diff.id] ?? null;
  return { snapshot: overlaySave(latest, changes), conflicts: [] };
}
/** Derive provenance from actual accepted content, never catalog annotations or client labels. */
function acceptedCategories(before: string, after: string): string[] {
  const left = saveUnits(before), right = saveUnits(after), categories = new Set<string>();
  for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (equal(left[id], right[id])) continue;
    if (id.startsWith("code:")) categories.add("CODE");
    if (id === "network") categories.add("MULTIPLAYER");
    if (id !== "graphics" && id !== "sound") continue;
    const old = left[id], next = right[id];
    if (old?.kind !== "map" || next?.kind !== "map") continue;
    const a = new Map(old.entries), b = new Map(next.entries);
    const changed = (keys: string[]): boolean => keys.some(key => !equal(a.get(key), b.get(key)));
    if (id === "graphics") {
      if (changed([KEYS.meta, KEYS.palette, KEYS.sheets, KEYS.sprites, KEYS.flags])) categories.add("SPRITES");
      if (changed([KEYS.meta, KEYS.maps, KEYS.tiles])) categories.add("MAPS");
    } else {
      const shared = changed([KEYS.instruments, KEYS.patterns, KEYS.samples]);
      const occupied = (key: string): boolean => [a.get(key), b.get(key)].some(node => node?.kind === "map" && node.entries.length > 0);
      if (changed([KEYS.songs]) || (shared && occupied(KEYS.songs))) categories.add("MUSIC");
      if (changed([KEYS.sfx]) || (shared && occupied(KEYS.sfx))) categories.add("SFX");
    }
  }
  return [...categories].sort();
}
export function reviewSave(base: string, draft: string, latest: string, accepted: string[], rejected: string[], resolutions: Record<string, Choice>): { result: string; remaining: string; nextBase: string; categories: string[] } {
  const diffs = differences(base, draft, latest).filter(d => d.draftChanged), ids = new Set(diffs.map(d => d.id));
  if (new Set([...accepted, ...rejected]).size !== accepted.length + rejected.length || [...accepted, ...rejected].some(id => !ids.has(id))) throw new BadRequestException("Review units are stale, duplicated or unknown");
  const d = saveUnits(draft), chosen: Record<string, Node | null> = Object.create(null) as Record<string, Node | null>;
  for (const id of accepted) {
    const diff = diffs.find(item => item.id === id)!;
    if (diff.conflict && !Object.prototype.hasOwnProperty.call(resolutions, id)) throw new ConflictException(`Resolve ${id} before accepting it`);
    if (!diff.conflict || resolutions[id] === "draft") chosen[id] = d[id] ?? null;
  }
  for (const [id, choice] of Object.entries(resolutions)) if (!accepted.includes(id) || !diffs.some(diff => diff.id === id && diff.conflict) || !["draft", "latest"].includes(choice)) throw new BadRequestException("Invalid review resolution");
  const result = overlaySave(latest, chosen), b = saveUnits(base), baseChanges: Record<string, Node | null> = Object.create(null) as Record<string, Node | null>, remaining: Record<string, Node | null> = Object.create(null) as Record<string, Node | null>;
  for (const diff of diffs) if (!accepted.includes(diff.id) && !rejected.includes(diff.id)) { remaining[diff.id] = d[diff.id] ?? null; baseChanges[diff.id] = b[diff.id] ?? null; }
  const categories = acceptedCategories(latest, result);
  return { result, remaining: overlaySave(result, remaining), nextBase: overlaySave(result, baseChanges), categories };
}
