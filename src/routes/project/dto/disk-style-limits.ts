/**
 * What the disk of a game may be given.
 *
 * The colours mirror `BUBBLEGUM_16`, the default palette of the engine, in the Frontend repository
 * (`packages/engine/src/game/defaults.ts`), spelled as they are there. The finishes and the
 * gradient directions mirror what the disk component of the Frontend draws. A value added there
 * is added here, or the API refuses it.
 */
export const DISK_COLORS = [
  '#16171a',
  '#7f0622',
  '#d62411',
  '#ff8426',
  '#ffd100',
  '#fafdff',
  '#ff80a4',
  '#ff2674',
  '#94216a',
  '#430067',
  '#234975',
  '#68aed4',
  '#bfff3c',
  '#10d275',
  '#007899',
  '#002859',
] as const;
export type DiskColor = (typeof DISK_COLORS)[number];

export const DISK_FINISHES = [
  'solid',
  'stripes',
  'checker',
  'dots',
  'gradient',
  'gold',
  'silver',
  'holo',
] as const;
export type DiskFinish = (typeof DISK_FINISHES)[number];

export const DISK_GRAD_DIRS = ['h', 'v', 'd', 'd2', 'r'] as const;
export type DiskGradDir = (typeof DISK_GRAD_DIRS)[number];
