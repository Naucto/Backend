import type { EnvKey } from '../src/config/env';

let original: NodeJS.ProcessEnv | undefined;

/**
 * Sets variables for the current test; `undefined` unsets one. The environment the test started
 * with comes back after it, so a spec never leaks values into the next.
 */
export function withEnv(values: Partial<Record<EnvKey, string | undefined>>): void {
  original ??= process.env;
  const next: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  process.env = next;
}

afterEach(() => {
  if (original) {
    process.env = original;
    original = undefined;
  }
});
