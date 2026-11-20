/**
 * What the disk of a game may be given, besides its colours, which are free. The finishes and the
 * gradient directions mirror what the disk component of the Frontend draws: a value added there
 * is added here, or the API refuses it.
 */
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
