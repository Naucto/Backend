import * as Y from "yjs";

/**
 * Effective content size of a game document.
 *
 * Mirrors `packages/engine/src/game/size.ts` in the Frontend: the budget counts
 * the logical content of the decoded Yjs document (painted pixels, set tiles,
 * code text, sound data, palette), never the CRDT blob or its history, so both
 * ends of the API agree on the numbers shown in the size meter.
 */

/** 1 MiB ceiling on the logical content of a published game. */
export const PROJECT_CONTENT_MAX_BYTES = 1024 * 1024;
/** 16 MiB safety net on the raw uploaded blob (the CRDT update). */
export const PROJECT_BLOB_MAX_BYTES = 16 * 1024 * 1024;

/** Yjs keys of a v1 game document (see `packages/engine/src/game/keys.ts`). */
export const GAME_KEYS = {
  meta: "game.meta",
  codeFiles: "code.files",
  palette: "gfx.palette",
  sprites: "gfx.sprites",
  flags: "gfx.flags",
  tiles: "map.tiles",
  instruments: "sound.instruments",
  patterns: "sound.patterns",
  sfx: "sound.sfx",
  songs: "sound.songs",
  samples: "sound.samples"
} as const;

/** Yjs keys of a legacy (v0) game document. */
export const LEGACY_GAME_KEYS = {
  code: "monaco",
  sprites: "sprite",
  flags: "sprite_flags",
  tiles: "map",
  musics: "sound_musics",
  customInstruments: "sound_customInstruments"
} as const;

/** Bytes per palette entry (`#rrggbb` hex string). */
const PALETTE_ENTRY_BYTES = 7;
/** v0 games are migrated onto the fixed 16-colour PICO-8 palette. */
const LEGACY_PALETTE_SIZE = 16;

export const CONTENT_SIZE_CATEGORIES = [
  "code",
  "sprites",
  "flags",
  "map",
  "sound",
  "palette"
] as const;
export type ContentSizeCategory = (typeof CONTENT_SIZE_CATEGORIES)[number];

export type ContentSizeBreakdown = Record<ContentSizeCategory, number> & {
  total: number;
  /** Game document schema version the breakdown was computed from (0 = legacy). */
  schemaVersion: number;
};

const utf8 = (value: string): number => Buffer.byteLength(value, "utf8");

function countNonZero(map: Y.Map<unknown>): number {
  let count = 0;
  map.forEach((value) => {
    if (value !== 0 && value !== null && value !== undefined) {
      count++;
    }
  });
  return count;
}

function sumStringBytes(map: Y.Map<unknown>): number {
  let bytes = 0;
  map.forEach((value) => {
    if (typeof value === "string") {
      bytes += utf8(value);
    } else if (value !== null && value !== undefined) {
      bytes += utf8(JSON.stringify(value));
    }
  });
  return bytes;
}

function readSchemaVersion(doc: Y.Doc): number {
  const version = doc.getMap<unknown>(GAME_KEYS.meta).get("schemaVersion");
  return typeof version === "number" ? version : 0;
}

function codeBytes(doc: Y.Doc, schemaVersion: number): number {
  if (schemaVersion === 0) {
    return utf8(doc.getText(LEGACY_GAME_KEYS.code).toString());
  }

  let bytes = 0;
  doc.getMap<unknown>(GAME_KEYS.codeFiles).forEach((file) => {
    if (!(file instanceof Y.Map)) {
      return;
    }
    const text = file.get("text");
    if (text instanceof Y.Text) {
      bytes += utf8(text.toString());
    }
  });
  return bytes;
}

function soundBytes(doc: Y.Doc, schemaVersion: number): number {
  if (schemaVersion === 0) {
    let bytes = 0;
    doc.getArray<unknown>(LEGACY_GAME_KEYS.musics).forEach((music) => {
      bytes += utf8(
        typeof music === "string" ? music : JSON.stringify(music ?? null)
      );
    });
    return (
      bytes +
      sumStringBytes(doc.getMap<unknown>(LEGACY_GAME_KEYS.customInstruments))
    );
  }

  return [
    GAME_KEYS.instruments,
    GAME_KEYS.patterns,
    GAME_KEYS.songs,
    GAME_KEYS.sfx,
    GAME_KEYS.samples
  ].reduce((bytes, key) => bytes + sumStringBytes(doc.getMap<unknown>(key)), 0);
}

function paletteBytes(doc: Y.Doc, schemaVersion: number): number {
  if (schemaVersion === 0) {
    return LEGACY_PALETTE_SIZE * PALETTE_ENTRY_BYTES;
  }

  return doc.getArray<unknown>(GAME_KEYS.palette).length * PALETTE_ENTRY_BYTES;
}

/** Computes the size breakdown of an already decoded game document. */
export function computeContentSizeFromDoc(doc: Y.Doc): ContentSizeBreakdown {
  const schemaVersion = readSchemaVersion(doc);
  const legacy = schemaVersion === 0;

  const code = codeBytes(doc, schemaVersion);
  const sprites = countNonZero(
    doc.getMap<unknown>(legacy ? LEGACY_GAME_KEYS.sprites : GAME_KEYS.sprites)
  );
  const flags = countNonZero(
    doc.getMap<unknown>(legacy ? LEGACY_GAME_KEYS.flags : GAME_KEYS.flags)
  );
  const map = countNonZero(
    doc.getMap<unknown>(legacy ? LEGACY_GAME_KEYS.tiles : GAME_KEYS.tiles)
  );
  const sound = soundBytes(doc, schemaVersion);
  const palette = paletteBytes(doc, schemaVersion);

  return {
    code,
    sprites,
    flags,
    map,
    sound,
    palette,
    total: code + sprites + flags + map + sound + palette,
    schemaVersion
  };
}

/**
 * Decodes a saved project blob (a Yjs update, as produced by
 * `Y.encodeStateAsUpdate`) and computes its size breakdown.
 *
 * An empty blob is a valid, empty game.
 */
export function computeContentSize(blob: Uint8Array): ContentSizeBreakdown {
  const doc = new Y.Doc();
  try {
    if (blob.byteLength > 0) {
      Y.applyUpdate(doc, blob);
    }
    return computeContentSizeFromDoc(doc);
  } finally {
    doc.destroy();
  }
}

export function isContentSizeBreakdown(
  value: unknown
): value is ContentSizeBreakdown {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return [...CONTENT_SIZE_CATEGORIES, "total"].every(
    (key) => typeof record[key] === "number"
  );
}
