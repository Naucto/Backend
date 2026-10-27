import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { Injectable, Logger } from '@nestjs/common';

import { getOptionalEnv } from '../../config/env';

const FETCH_TIMEOUT_MS = 5_000;
const MAP_MAX_BYTES = 30 * 1024 * 1024;
const MAPS_CACHED = 24;
/** A map that could not be read is asked for again after this long, in case it was deployed late. */
const MISSING_RETRY_MS = 10 * 60 * 1000;
const MISSING_REMEMBERED = 256;
/** A real stack spans a handful of the build's bundles. Past that, a report names made-up ones. */
const BUNDLES_PER_STACK = 8;
/** Maps fetched a minute across every report, so made-up names cannot keep the backend fetching. */
const FETCHES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;
const FRAMES_RESOLVED = 30;
const STACK_MAX_LENGTH = 8_000;
const LINES_READ = 200;
const TOKENS_READ_PER_LINE = 64;
/** A bundle the production build writes at the root of the web app, as `main-B45ANGGH.js`. */
const BUNDLE_NAME = /^[A-Za-z0-9_-]{1,100}[.]m?js$/;

interface Location {
  url: string;
  line: number;
  column: number;
}

/** `https://host/chunk-X.js:12:34` split into its file and position, or null for anything else. */
export function locationOf(token: string): Location | null {
  const column = token.lastIndexOf(':');
  const line = token.lastIndexOf(':', column - 1);
  if (line <= 0) {
    return null;
  }
  const url = token.slice(0, line);
  const lineNumber = Number(token.slice(line + 1, column));
  const columnNumber = Number(token.slice(column + 1));
  if (!/\.m?js$/.test(url) || !Number.isInteger(lineNumber) || !Number.isInteger(columnNumber)) {
    return null;
  }
  return { url, line: lineNumber, column: columnNumber };
}

/**
 * The bundle a frame points at, when it is one the web app serves from its own origin. Only its
 * name is kept, so the map is fetched from an address the backend builds itself.
 */
export function bundleOf(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const name = parsed.pathname.slice(1);
  return parsed.origin === origin && BUNDLE_NAME.test(name) ? name : null;
}

/** A source path of a map without the bundler's prefixes, as a reader of the repository knows it. */
function sourcePath(source: string): string {
  return source.replace(/^webpack:\/\/\/?/, '').replace(/^(?:\.\.?\/)+/, '');
}

/**
 * Maps the frames of the web app's minified bundles back to their sources, through the hidden
 * source maps the production build publishes beside each bundle. It only asks the web app's own
 * origin, so a public crash report cannot make the backend fetch anything else.
 */
@Injectable()
export class StackResolver {
  private readonly logger = new Logger(StackResolver.name);
  private readonly origin = new URL(getOptionalEnv('FRONTEND_URL', 'http://localhost:3001')).origin;
  /** Maps read, by bundle, the least recently used first. */
  private readonly maps = new Map<string, TraceMap>();
  /** When each bundle without a map was last asked for, the oldest first. */
  private readonly missing = new Map<string, number>();
  private fetchedAt: number[] = [];

  async resolve(stack: string, now = Date.now()): Promise<string> {
    const lines = stack.slice(0, STACK_MAX_LENGTH).split('\n');
    const lineCount = Math.min(lines.length, LINES_READ);
    const bundles = new Set<string>();
    let resolved = 0;
    for (let i = 0; i < lineCount && resolved < FRAMES_RESOLVED; i++) {
      const tokens = (lines[i] ?? '').split(/([\s()@]+)/);
      const tokenCount = Math.min(tokens.length, TOKENS_READ_PER_LINE);
      let changed = false;
      for (let j = 0; j < tokenCount; j++) {
        const location = locationOf(tokens[j] ?? '');
        const bundle = location ? bundleOf(location.url, this.origin) : null;
        if (!location || !bundle) {
          continue;
        }
        if (!bundles.has(bundle) && bundles.size >= BUNDLES_PER_STACK) {
          continue;
        }
        bundles.add(bundle);
        const original = await this.original(bundle, location, now);
        if (original) {
          tokens[j] = original;
          changed = true;
          resolved++;
        }
      }
      if (changed) {
        lines[i] = tokens.join('');
      }
    }
    return lines.join('\n');
  }

  private async original(bundle: string, location: Location, now: number): Promise<string | null> {
    const map = await this.mapOf(bundle, now);
    if (!map) {
      return null;
    }
    const position = originalPositionFor(map, {
      line: location.line,
      column: Math.max(0, location.column - 1),
    });
    if (position.source === null || position.line === null || position.column === null) {
      return null;
    }
    return `${sourcePath(position.source)}:${String(position.line)}:${String(position.column + 1)}`;
  }

  private async mapOf(bundle: string, now: number): Promise<TraceMap | null> {
    const cached = this.maps.get(bundle);
    if (cached) {
      this.remember(this.maps, bundle, cached, MAPS_CACHED);
      return cached;
    }
    const missedAt = this.missing.get(bundle);
    if (missedAt !== undefined && now - missedAt < MISSING_RETRY_MS) {
      return null;
    }
    this.fetchedAt = this.fetchedAt.filter((at) => now - at < MINUTE_MS);
    if (this.fetchedAt.length >= FETCHES_PER_MINUTE) {
      return null;
    }
    this.fetchedAt.push(now);

    const map = await this.fetchMap(new URL(`/${bundle}.map`, this.origin));
    if (map) {
      this.missing.delete(bundle);
      this.remember(this.maps, bundle, map, MAPS_CACHED);
    } else {
      this.remember(this.missing, bundle, now, MISSING_REMEMBERED);
    }
    return map;
  }

  /** Puts an entry last, and drops the oldest past the limit. */
  private remember<T>(entries: Map<string, T>, key: string, value: T, limit: number): void {
    entries.delete(key);
    entries.set(key, value);
    for (const oldest of entries.keys()) {
      if (entries.size <= limit) {
        break;
      }
      entries.delete(oldest);
    }
  }

  private async fetchMap(url: URL): Promise<TraceMap | null> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const length = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || length > MAP_MAX_BYTES) {
        return null;
      }
      const text = await response.text();
      return text.length > MAP_MAX_BYTES ? null : new TraceMap(text);
    } catch (error) {
      this.logger.warn(
        `Could not read the source map ${url.href}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
