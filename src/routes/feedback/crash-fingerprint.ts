import { CrashSource } from '@prisma/client';
import { createHash } from 'crypto';

const FRAMES_IN_FINGERPRINT = 3;

/**
 * A message with what varies between two occurrences of one crash taken out: addresses, long hex
 * or numeric ids and counts.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/(?:https?|blob|file):\/\/\S+/gi, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * One stack frame without what a deploy changes: the origin, the content hash of a chunk name, the
 * query, and the line and column.
 */
export function normalizeFrame(frame: string): string {
  return frame
    .trim()
    .replace(/^at\s+/, '')
    .replace(/(?:https?|blob|file):\/\/[^/\s)]+/gi, '')
    .replace(/-[A-Z0-9]{8,}(\.m?js)/g, '$1')
    .replace(/\?[^:\s)]*/g, '')
    .replace(/(?::\d+){1,2}(?=\)?$)/, '')
    .replace(/\s+/g, ' ');
}

/** The frames of a V8 (`at fn (file:1:2)`) or a Gecko and WebKit (`fn@file:1:2`) stack. */
export function stackFrames(stack: string): string[] {
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') || /^[^\s]*@\S+:\d+/.test(line));
}

export function crashFingerprint(
  source: CrashSource,
  name: string,
  message: string,
  stack: string,
): string {
  const frames = stackFrames(stack).slice(0, FRAMES_IN_FINGERPRINT).map(normalizeFrame);
  return createHash('sha256')
    .update([source, name.trim(), normalizeMessage(message), ...frames].join('\n'))
    .digest('hex')
    .slice(0, 40);
}
