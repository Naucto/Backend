import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DISK_COLORS } from './disk-style-limits';

/** The engine's defaults, when the Frontend repository is checked out next to this one. */
const ENGINE_DEFAULTS = join(
  __dirname,
  ...Array<string>(5).fill('..'),
  'Frontend',
  'packages',
  'engine',
  'src',
  'game',
  'defaults.ts',
);

describe('disk colours', () => {
  it('are sixteen distinct colours, spelled as six lowercase hex digits', () => {
    expect(new Set(DISK_COLORS).size).toBe(16);
    for (const colour of DISK_COLORS) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // CI checks this repository out alone, so the mirror is only compared where both are there.
  (existsSync(ENGINE_DEFAULTS) ? it : it.skip)('mirror the default palette of the engine', () => {
    const [, palette] =
      /BUBBLEGUM_16 = \[([^\]]*)\]/.exec(readFileSync(ENGINE_DEFAULTS, 'utf8')) ?? [];

    expect(palette?.match(/#[0-9a-f]{6}/gi)).toEqual([...DISK_COLORS]);
  });
});
