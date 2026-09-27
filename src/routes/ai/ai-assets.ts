import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { prepareSound, prepareSoundRemoval } from "./ai-sound";

export type Operation = Record<string, unknown>;
export interface Prepared {
  category: string | null;
  writes: (() => void)[];
  /** Operations that undo these writes, computed from the merged state before writing. */
  inverse: Operation[];
}

const CATALOG_KINDS = ["sprite", "tile", "animation", "section", "music", "sfx"];
const SEMANTICS = ["unconfirmed", "walkable", "solid", "hazard"];

export function number(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) throw new ConflictException("Invalid asset coordinate/value");
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("Invalid asset operation");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, name: string): string {
  if (typeof value !== "string" || value.length > max) throw new ConflictException(`Invalid ${name}`);
  return value;
}
export const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function dimension(entry: Y.Map<unknown> | undefined, meta: Y.Map<unknown>, key: string, fallback: number, sheet: boolean): number {
  const value = (entry?.doc ? entry.get(key === "sheetWidth" || key === "mapWidth" ? "w" : "h") : undefined) ?? meta.get(key) ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ConflictException("Invalid geometry");
  return sheet ? Math.max(8, Math.min(256, Math.round(value / 8) * 8)) : Math.max(1, Math.min(256, Math.round(value)));
}

interface Resource { width: number; height: number; cells: Y.Map<number> | null; entry: Y.Map<unknown> | undefined }

/** A sheet or map, with the cells map it keeps (null for one nobody has written to yet). */
export function resource(doc: Y.Doc, kind: "sheet" | "map", id: string): Resource {
  const collection = doc.getMap<Y.Map<unknown>>(kind === "sheet" ? "gfx.sheets" : "map.maps");
  const entry = collection.get(id);
  if ((collection.size && !entry) || (!collection.size && id !== "0")) throw new ConflictException("Resource no longer exists");
  const meta = doc.getMap("game.meta");
  const sheet = kind === "sheet";
  const width = dimension(entry, meta, sheet ? "sheetWidth" : "mapWidth", 128, sheet);
  const height = dimension(entry, meta, sheet ? "sheetHeight" : "mapHeight", sheet ? 128 : 32, sheet);
  const held = id === "0" ? doc.getMap<number>(sheet ? "gfx.sprites" : "map.tiles") : entry?.get(sheet ? "pixels" : "tiles");
  return { width, height, entry, cells: held instanceof Y.Map ? held as Y.Map<number> : null };
}

function cellsFor(doc: Y.Doc, kind: "sheet" | "map", id: string): Y.Map<number> {
  const found = resource(doc, kind, id);
  if (found.cells) return found.cells;
  if (!found.entry) throw new ConflictException("Resource cells unavailable");
  const made = new Y.Map<number>();
  found.entry.set(kind === "sheet" ? "pixels" : "tiles", made);
  return made;
}

/** Sheets in the order sprite numbers run across them. */
function sheetOrder(doc: Y.Doc): { id: string; entry: Y.Map<unknown>; width: number; height: number; base: number }[] {
  const sheets = doc.getMap<Y.Map<unknown>>("gfx.sheets");
  const entries = [...sheets.entries()].sort((a, b) => Number(a[1].get("order") ?? 0) - Number(b[1].get("order") ?? 0) || a[0].localeCompare(b[0]));
  if (!entries.length) entries.push(["0", new Y.Map()]);
  const meta = doc.getMap("game.meta");
  let base = 0;
  return entries.map(([id, entry]) => {
    const width = dimension(entry, meta, "sheetWidth", 128, true), height = dimension(entry, meta, "sheetHeight", 128, true);
    const shape = { id, entry, width, height, base };
    base += width * height / 64;
    return shape;
  });
}

export function spriteTotal(doc: Y.Doc): number {
  return sheetOrder(doc).reduce((sum, sheet) => sum + sheet.width * sheet.height / 64, 0);
}

/** Palette indices of a sheet region, row-major. */
export function regionPixels(doc: Y.Doc, sheetId: string, x: number, y: number, width: number, height: number): Uint8Array {
  const { cells } = resource(doc, "sheet", sheetId);
  return Uint8Array.from(Array.from({ length: width * height }, (_, i) => Number(cells?.get(`${x + i % width},${y + Math.floor(i / width)}`) ?? 0)));
}

/** Tile numbers of a map region, row-major, as little-endian 16-bit words for hashing. */
export function regionTiles(doc: Y.Doc, mapId: string, x: number, y: number, width: number, height: number): Uint8Array {
  const { cells } = resource(doc, "map", mapId);
  const out = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    const value = Number(cells?.get(`${x + i % width},${y + Math.floor(i / width)}`) ?? 0);
    out[i * 2] = value & 255; out[i * 2 + 1] = value >> 8;
  }
  return out;
}

/** Human-owned regions an AI proposal may not write inside. */
function assertUnlocked(doc: Y.Doc, target: "sheet" | "map", id: string, x: number, y: number): void {
  for (const raw of doc.getMap("ai.locks").values()) {
    if (!raw || typeof raw !== "object") continue;
    const lock = raw as Record<string, unknown>;
    if (lock["target"] !== target || lock["resourceId"] !== id) continue;
    const lx = Number(lock["x"]), ly = Number(lock["y"]), lw = Number(lock["width"]), lh = Number(lock["height"]);
    if (x >= lx && y >= ly && x < lx + lw && y < ly + lh) throw new ConflictException(`Region locked: ${String(lock["name"] ?? "locked region")}`);
  }
}

/** The sprite number a catalog tile stands for, refusing one whose pixels changed since it was named. */
export function resolveTile(doc: Y.Doc, id: string): number {
  const asset = object(doc.getMap("ai.catalog").get(id));
  if (asset["kind"] !== "tile" || asset["width"] !== 8 || asset["height"] !== 8) throw new ConflictException("Map requires an 8×8 catalog tile");
  const sheet = sheetOrder(doc).find(value => value.id === asset["resourceId"]);
  if (!sheet) throw new ConflictException("Catalog sheet missing");
  const x = number(asset["x"], sheet.width - 8), y = number(asset["y"], sheet.height - 8);
  if (x % 8 || y % 8) throw new ConflictException("Unaligned tile");
  if (hashBytes(regionPixels(doc, sheet.id, x, y, 8, 8)) !== asset["contentHash"]) throw new ConflictException("Catalog tile changed; confirm its annotation again");
  return number(sheet.base + y / 8 * (sheet.width / 8) + x / 8, 65535);
}

/** Every field a catalog entry may carry, per kind. The annotation never asserts provenance. */
export function validateCatalogEntry(doc: Y.Doc, asset: Record<string, unknown>): void {
  const id = text(asset["id"], 100, "asset id"), name = text(asset["name"], 100, "asset name");
  if (!id || !name) throw new ConflictException("Asset needs an identity");
  const kind = String(asset["kind"]);
  if (!CATALOG_KINDS.includes(kind)) throw new ConflictException("Invalid asset kind");
  const tags = asset["tags"];
  if (!Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== "string" || tag.length > 60)) throw new ConflictException("Invalid tags");
  text(asset["description"], 2000, "description");
  if (!SEMANTICS.includes(String(asset["semantics"]))) throw new ConflictException("Invalid semantics");
  if (asset["connects"] !== undefined) {
    const connects = object(asset["connects"]);
    for (const side of Object.keys(connects)) {
      const list = connects[side];
      if (!["n", "e", "s", "w"].includes(side) || !Array.isArray(list) || list.length > 16 || list.some(value => typeof value !== "string" || value.length > 40)) throw new ConflictException("Invalid adjacency");
    }
  }
  const hash = String(asset["contentHash"]);
  if (kind === "tile" || kind === "sprite") {
    const sheet = resource(doc, "sheet", text(asset["resourceId"], 100, "sheet"));
    const width = number(asset["width"], 64), height = number(asset["height"], 64);
    const x = number(asset["x"], sheet.width - width), y = number(asset["y"], sheet.height - height);
    if (!width || !height || x % 8 || y % 8 || width % 8 || height % 8 || (kind === "tile" && (width !== 8 || height !== 8))) throw new ConflictException("Sprite regions are whole 8×8 cells");
    if (hashBytes(regionPixels(doc, String(asset["resourceId"]), x, y, width, height)) !== hash) throw new ConflictException("Catalog fingerprint does not match the artwork");
  } else if (kind === "section") {
    const map = resource(doc, "map", text(asset["resourceId"], 100, "map"));
    const width = number(asset["width"], 64), height = number(asset["height"], 64);
    const x = number(asset["x"], map.width - width), y = number(asset["y"], map.height - height);
    if (!width || !height) throw new ConflictException("Empty section");
    if (hashBytes(regionTiles(doc, String(asset["resourceId"]), x, y, width, height)) !== hash) throw new ConflictException("Section fingerprint does not match the map");
  } else if (kind === "animation") {
    const frames = asset["frames"];
    if (!Array.isArray(frames) || !frames.length || frames.length > 64) throw new ConflictException("Animations need 1–64 frames");
    const catalog = doc.getMap("ai.catalog");
    for (const frame of frames) {
      const target = catalog.get(text(frame, 100, "frame"));
      if (!target || typeof target !== "object" || !["sprite", "tile"].includes(String((target as Record<string, unknown>)["kind"]))) throw new ConflictException("Animation frames must be catalog sprites");
    }
    const fps = asset["fps"];
    if (typeof fps !== "number" || fps <= 0 || fps > 60) throw new ConflictException("Invalid animation rate");
  } else {
    const slot = text(asset["resourceId"], 10, "sound slot");
    const bank = doc.getMap(kind === "music" ? "sound.songs" : "sound.sfx");
    if (!bank.has(slot)) throw new ConflictException("Catalogued sound slot is empty");
  }
}

/** Prepare native writes on the merged scratch document. Never accepts opaque Yjs updates. */
export function prepareAsset(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  switch (op["kind"]) {
  case "sound": return prepareSound(doc, op, touch);
  case "delete_sound": return prepareSoundRemoval(doc, op, touch);
  case "create_map": return createMap(doc, op, touch);
  case "delete_map": return deleteMap(doc, op, touch);
  case "resize_map": return resizeMap(doc, op, touch);
  case "catalog": return catalogEdit(doc, op, touch);
  case "pixels": return pixels(doc, op, touch);
  case "tiles": return tiles(doc, op, touch);
  default: throw new ConflictException("Unsupported operation");
  }
}

function catalogEdit(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  const after = op["after"] === null ? null : object(op["after"]);
  const before = op["before"] === null || op["before"] === undefined ? null : object(op["before"]);
  const id = String(after?.["id"] ?? before?.["id"] ?? "");
  if (!id || id.length > 100 || (after && before && after["id"] !== before["id"])) throw new ConflictException("Invalid catalog identity");
  const catalog = doc.getMap("ai.catalog");
  const current = catalog.get(id) ?? null;
  if (JSON.stringify(current) !== JSON.stringify(before)) throw new ConflictException("Catalog changed");
  if (after) validateCatalogEntry(doc, after);
  touch(`catalog:${id}`);
  const copy = after ? JSON.parse(JSON.stringify(after)) as unknown : null;
  return {
    category: null,
    writes: [(): void => { if (copy) catalog.set(id, copy); else catalog.delete(id); }],
    inverse: [{ kind: "catalog", before: copy, after: current }],
  };
}

function pixels(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  const id = text(op["sheetId"], 100, "sheet");
  const found = resource(doc, "sheet", id);
  const changes = op["changes"];
  if (!Array.isArray(changes) || !changes.length || changes.length > 65536) throw new ConflictException("Invalid change count");
  const writes: (() => void)[] = [];
  const undo: Record<string, number>[] = [];
  for (const raw of changes as unknown[]) {
    const change = object(raw);
    const x = number(change["x"], found.width - 1), y = number(change["y"], found.height - 1);
    const before = number(change["before"], 15), after = number(change["after"], 15);
    const key = `${x},${y}`;
    touch(`pixels:${id}:${key}`);
    assertUnlocked(doc, "sheet", id, x, y);
    if ((found.cells?.get(key) ?? 0) !== before) throw new ConflictException("Pixels changed since review");
    if (before === after) throw new ConflictException("Proposal contains no-op pixels");
    writes.push(() => { const cells = cellsFor(doc, "sheet", id); if (after === 0) cells.delete(key); else cells.set(key, after); });
    undo.push({ x, y, before: after, after: before });
  }
  return { category: "SPRITES", writes, inverse: [{ kind: "pixels", sheetId: id, changes: undo }] };
}

function tiles(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  const id = text(op["mapId"], 100, "map");
  const found = resource(doc, "map", id);
  const changes = op["changes"];
  if (!Array.isArray(changes) || !changes.length || changes.length > 65536) throw new ConflictException("Invalid change count");
  const total = spriteTotal(doc);
  const writes: (() => void)[] = [];
  const undo: Record<string, number>[] = [];
  for (const raw of changes as unknown[]) {
    const change = object(raw);
    const x = number(change["x"], found.width - 1), y = number(change["y"], found.height - 1);
    const before = number(change["before"], 65535);
    // A catalog reference is re-resolved against today's artwork; a raw number (copied from a
    // catalogued section, or an inverse) must name a sprite the sheets still hold.
    const after = change["assetId"] !== undefined ? resolveTile(doc, text(change["assetId"], 100, "asset")) : number(change["sprite"], Math.max(0, total - 1));
    const key = `${x},${y}`;
    touch(`tiles:${id}:${key}`);
    assertUnlocked(doc, "map", id, x, y);
    if ((found.cells?.get(key) ?? 0) !== before) throw new ConflictException("Map changed since review");
    if (before === after) continue;
    writes.push(() => { const cells = cellsFor(doc, "map", id); if (after === 0) cells.delete(key); else cells.set(key, after); });
    undo.push({ x, y, before: after, sprite: before });
  }
  if (!writes.length) throw new ConflictException("Proposal contains no map change");
  return { category: "MAPS", writes, inverse: [{ kind: "tiles", mapId: id, changes: undo }] };
}

function resizeMap(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  const id = text(op["mapId"], 100, "map");
  const found = resource(doc, "map", id);
  const width = number(op["width"], 256), height = number(op["height"], 256);
  if (!width || !height) throw new ConflictException("Invalid map size");
  if (found.width !== op["beforeWidth"] || found.height !== op["beforeHeight"]) throw new ConflictException("Map size changed since review");
  if (width === found.width && height === found.height) throw new ConflictException("Map size unchanged");
  touch(`map-size:${id}`);
  // A resize may only drop empty cells: tiles a person placed are never cut off by a proposal.
  found.cells?.forEach((value, key) => {
    const [x = 0, y = 0] = key.split(",").map(Number);
    if (value && (x >= width || y >= height)) throw new ConflictException("Resize would remove placed tiles");
  });
  return {
    category: "MAPS",
    writes: [(): void => {
      const maps = doc.getMap<Y.Map<unknown>>("map.maps");
      if (id === "0") {
        const meta = doc.getMap("game.meta");
        if (!maps.size) {
          const first = new Y.Map<unknown>();
          maps.set("0", first); first.set("order", 0);
        }
        meta.set("mapWidth", width); meta.set("mapHeight", height);
      }
      const entry = maps.get(id);
      if (entry) { entry.set("w", width); entry.set("h", height); }
    }],
    inverse: [{ kind: "resize_map", mapId: id, beforeWidth: width, beforeHeight: height, width: found.width, height: found.height }],
  };
}

function createMap(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  const id = op["id"], name = op["name"], description = op["description"];
  const width = number(op["width"], 256), height = number(op["height"], 256);
  if (!width || !height || typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || typeof name !== "string" || !name || name.length > 100 || typeof description !== "string" || description.length > 4000 || !["top-down", "platformer", "visual"].includes(String(op["profile"]))) throw new ConflictException("Invalid level definition");
  const maps = doc.getMap<Y.Map<unknown>>("map.maps");
  if (maps.has(id)) throw new ConflictException("Map ID occupied");
  touch("map-collection");
  const assets = op["assets"];
  if (!Array.isArray(assets) || assets.length !== width * height) throw new ConflictException("Map data must match dimensions");
  const resolved = new Map<string, number>();
  const cells = assets.map((asset: unknown) => {
    if (asset === null) return 0;
    if (typeof asset !== "string") throw new ConflictException("Invalid catalog reference");
    if (!resolved.has(asset)) resolved.set(asset, resolveTile(doc, asset));
    return resolved.get(asset)!;
  });
  const words = new Uint8Array(cells.length * 2);
  cells.forEach((value, i) => { words[i * 2] = value & 255; words[i * 2 + 1] = value >> 8; });
  return {
    category: "MAPS",
    writes: [(): void => {
      if (!maps.size) {
        const first = new Y.Map<unknown>();
        maps.set("0", first); first.set("name", "map"); first.set("order", 0);
      }
      const order = Math.max(...[...maps.values()].map(entry => Number(entry.get("order") ?? 0))) + 1;
      const entry = new Y.Map<unknown>(), tileMap = new Y.Map<number>();
      maps.set(id, entry);
      entry.set("name", name); entry.set("order", order); entry.set("w", width); entry.set("h", height); entry.set("tiles", tileMap);
      cells.forEach((sprite, index) => { if (sprite) tileMap.set(`${index % width},${Math.floor(index / width)}`, sprite); });
      doc.getMap("ai.levels").set(id, { id, name, description, profile: op["profile"], catalogAssets: [...resolved.keys()], gameplayValidated: false });
    }],
    // The level is removed only while it still holds exactly what was created.
    inverse: [{ kind: "delete_map", id, width, height, contentHash: hashBytes(words) }],
  };
}

function deleteMap(doc: Y.Doc, op: Operation, touch: (key: string) => void): Prepared {
  const id = text(op["id"], 100, "map");
  if (id === "0") throw new ConflictException("The first map cannot be removed");
  const maps = doc.getMap<Y.Map<unknown>>("map.maps");
  if (!maps.has(id) || maps.size <= 1) throw new ConflictException("Map unavailable");
  const found = resource(doc, "map", id);
  if (found.width !== op["width"] || found.height !== op["height"] || hashBytes(regionTiles(doc, id, 0, 0, found.width, found.height)) !== op["contentHash"]) {
    throw new ConflictException("The level was edited after it was created; remove it manually");
  }
  touch("map-collection");
  return {
    category: "MAPS",
    writes: [(): void => { maps.delete(id); doc.getMap("ai.levels").delete(id); }],
    inverse: [],
  };
}
