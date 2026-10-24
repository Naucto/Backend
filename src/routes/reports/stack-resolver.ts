import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { Injectable, Logger } from '@nestjs/common';

import { getOptionalEnv } from '../../config/env';

const FETCH_TIMEOUT_MS = 5_000;
const MAP_MAX_BYTES = 30 * 1024 * 1024;
const MAPS_CACHED = 24;
/** A map that could not be read is asked for again after this long, in case it was deployed late. */
const MISSING_RETRY_MS = 10 * 60 * 1000;
const FRAMES_RESOLVED = 30;

interface CachedMap {
  map: TraceMap | null;
  at: number;
}

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
  private readonly maps = new Map<string, CachedMap>();

  async resolve(stack: string, now = Date.now()): Promise<string> {
    let resolved = 0;
    const lines: string[] = [];
    for (const line of stack.split('\n')) {
      if (resolved >= FRAMES_RESOLVED) {
        lines.push(line);
        continue;
      }
      const tokens = line.split(/([\s()@]+)/);
      for (let i = 0; i < tokens.length; i++) {
        const location = locationOf(tokens[i] ?? '');
        if (!location || !this.isOurs(location.url)) {
          continue;
        }
        const original = await this.original(location, now);
        if (original) {
          tokens[i] = original;
          resolved++;
        }
      }
      lines.push(tokens.join(''));
    }
    return lines.join('\n');
  }

  private isOurs(url: string): boolean {
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }

  private async original(location: Location, now: number): Promise<string | null> {
    const map = await this.mapOf(location.url, now);
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

  private async mapOf(url: string, now: number): Promise<TraceMap | null> {
    const cached = this.maps.get(url);
    if (cached && (cached.map || now - cached.at < MISSING_RETRY_MS)) {
      return cached.map;
    }
    const map = await this.fetchMap(`${url}.map`);
    this.maps.delete(url);
    this.maps.set(url, { map, at: now });
    for (const oldest of this.maps.keys()) {
      if (this.maps.size <= MAPS_CACHED) {
        break;
      }
      this.maps.delete(oldest);
    }
    return map;
  }

  private async fetchMap(url: string): Promise<TraceMap | null> {
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
        `Could not read the source map ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
