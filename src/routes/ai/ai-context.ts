import * as Y from "yjs";

/**
 * What the MCP reads of a project: the engine's `aiContext`, rebuilt from a stored document.
 *
 * Built here from the saved bytes rather than shared by an open editor, because the assistant works
 * whether or not anybody has the project open. The shape is the engine's, field for field, since the
 * MCP service parses it and `snapshotHash` is a hash of it.
 */

const FIRST_ID = "0";
const SPRITE_SIZE = 8;

/** The 16 colours a game has when it declares none, as the engine's BUBBLEGUM_16. */
const DEFAULT_PALETTE = ["#16171a", "#7f0622", "#d62411", "#ff8426", "#ffd100", "#fafdff", "#ff80a4", "#ff2674", "#94216a", "#430067", "#234975", "#68aed4", "#bfff3c", "#10d275", "#007899", "#002859"];

const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const order = (entry: Y.Map<unknown>): number => finite(entry.get("order")) ?? 0;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function entries(collection: Y.Map<Y.Map<unknown>>): [string, Y.Map<unknown>][] {
  const out: [string, Y.Map<unknown>][] = [];
  collection.forEach((entry, id) => {
    if (entry instanceof Y.Map) out.push([id, entry]);
  });
  return out.sort((a, b) => order(a[1]) - order(b[1]) || a[0].localeCompare(b[0]));
}

/** An entry standing in for the first sheet or map of a document that declares none. */
const bare = (): Y.Map<unknown> => new Y.Doc().getMap("entry");

const coord = (key: string): [number, number] => {
  const [x, y] = key.split(",");
  return [Number(x), Number(y)];
};

function geometry(meta: Y.Map<unknown>): { sheetWidth: number; sheetHeight: number; mapWidth: number; mapHeight: number } {
  const sheet = (key: string, fallback: number): number => clamp(Math.round((finite(meta.get(key)) ?? fallback) / SPRITE_SIZE) * SPRITE_SIZE, SPRITE_SIZE, 256);
  const map = (key: string, fallback: number): number => clamp(Math.round(finite(meta.get(key)) ?? fallback), 1, 256);
  return { sheetWidth: sheet("sheetWidth", 128), sheetHeight: sheet("sheetHeight", 128), mapWidth: map("mapWidth", 128), mapHeight: map("mapHeight", 32) };
}

function sheets(doc: Y.Doc, geo: ReturnType<typeof geometry>): Record<string, unknown>[] {
  const collection = doc.getMap<Y.Map<unknown>>("gfx.sheets");
  const list = entries(collection);
  if (!list.length) list.push([FIRST_ID, bare()]);
  let base = 0;
  return list.map(([id, entry]) => {
    const width = clamp(Math.round((finite(entry.get("w")) ?? geo.sheetWidth) / SPRITE_SIZE) * SPRITE_SIZE, SPRITE_SIZE, 256);
    const height = clamp(Math.round((finite(entry.get("h")) ?? geo.sheetHeight) / SPRITE_SIZE) * SPRITE_SIZE, SPRITE_SIZE, 256);
    const count = (width / SPRITE_SIZE) * (height / SPRITE_SIZE);
    const pixels = new Uint8Array(width * height);
    const flags = new Array<number>(count).fill(0);
    const held = (key: "pixels" | "flags"): Y.Map<number> | null => {
      const cells = id === FIRST_ID ? doc.getMap<number>(key === "pixels" ? "gfx.sprites" : "gfx.flags") : entry.get(key);
      return cells instanceof Y.Map ? (cells as Y.Map<number>) : null;
    };
    held("pixels")?.forEach((value, key) => {
      const [x, y] = coord(key);
      if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = value & 0xf;
    });
    held("flags")?.forEach((value, key) => {
      const index = Number(key);
      if (index >= 0 && index < count) flags[index] = value & 0xff;
    });
    const out = { id, name: typeof entry.get("name") === "string" ? entry.get("name") : "", width, height, base, pixels: Array.from(pixels, (p) => p.toString(16)).join(""), flags };
    base += count;
    return out;
  });
}

function maps(doc: Y.Doc, geo: ReturnType<typeof geometry>): Record<string, unknown>[] {
  const list = entries(doc.getMap<Y.Map<unknown>>("map.maps"));
  if (!list.length) list.push([FIRST_ID, bare()]);
  return list.map(([id, entry]) => {
    const width = clamp(Math.round(finite(entry.get("w")) ?? geo.mapWidth), 1, 256);
    const height = clamp(Math.round(finite(entry.get("h")) ?? geo.mapHeight), 1, 256);
    const tiles = new Array<number>(width * height).fill(0);
    const cells = id === FIRST_ID ? doc.getMap<number>("map.tiles") : entry.get("tiles");
    if (cells instanceof Y.Map) {
      (cells as Y.Map<number>).forEach((value, key) => {
        const [x, y] = coord(key);
        if (x >= 0 && x < width && y >= 0 && y < height) tiles[y * width + x] = value & 0xffff;
      });
    }
    return { id, name: typeof entry.get("name") === "string" ? entry.get("name") : "", width, height, tiles };
  });
}

function code(doc: Y.Doc): Record<string, unknown>[] {
  const out: { id: string; name: string; order: number; text: string }[] = [];
  doc.getMap<Y.Map<unknown>>("code.files").forEach((file, id) => {
    const text = file instanceof Y.Map ? file.get("text") : null;
    if (!(text instanceof Y.Text)) return;
    out.push({ id, name: typeof file.get("name") === "string" ? (file.get("name") as string) : id, order: Number(file.get("order") ?? 0), text: text.toString() });
  });
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(({ id, name, text }) => ({ id, name, text }));
}

/** The engine's `aiContext` of a stored document. */
export function buildContext(state: Uint8Array): Record<string, unknown> {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const geo = geometry(doc.getMap("game.meta"));
    const palette = doc.getArray<string>("gfx.palette").toArray();
    const json = (name: string): unknown => doc.getMap(name).toJSON();
    return {
      schemaVersion: doc.getMap("game.meta").get("schemaVersion") ?? 2,
      palette: palette.length === 16 ? palette : DEFAULT_PALETTE,
      encoding: { sheetPixels: "one hex digit per pixel, row-major" },
      code: code(doc),
      sheets: sheets(doc, geo),
      maps: maps(doc, geo),
      catalog: json("ai.catalog"),
      levels: json("ai.levels"),
      locks: json("ai.locks"),
      instruments: json("sound.instruments"),
      patterns: json("sound.patterns"),
      songs: json("sound.songs"),
      sfx: json("sound.sfx"),
      samples: Object.keys(doc.getMap("sound.samples").toJSON()),
      netPermissions: Object.fromEntries(doc.getMap("net.permissions").entries()),
    };
  } finally {
    doc.destroy();
  }
}
