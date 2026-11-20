export const HUB_SHELF_KINDS = ['POPULAR', 'TRENDING', 'FRIENDS', 'TAG'] as const;
export type HubShelfKind = (typeof HUB_SHELF_KINDS)[number];

/** A shelf as a client names it: `popular`, `trending`, `friends`, or `tag:<tag>`. */
export type HubShelfKey = { kind: Exclude<HubShelfKind, 'TAG'> } | { kind: 'TAG'; tag: string };

const TAG_PREFIX = 'tag:';

const FIXED_KEYS: Record<string, Exclude<HubShelfKind, 'TAG'>> = {
  popular: 'POPULAR',
  trending: 'TRENDING',
  friends: 'FRIENDS',
};

export function formatShelfKey(key: HubShelfKey): string {
  return key.kind === 'TAG' ? `${TAG_PREFIX}${key.tag}` : key.kind.toLowerCase();
}

/** The shelf a key names, or null when it names none. A tag is taken as written, case included. */
export function parseShelfKey(raw: string): HubShelfKey | null {
  const fixed = FIXED_KEYS[raw];
  if (fixed) {
    return { kind: fixed };
  }

  const tag = raw.startsWith(TAG_PREFIX) ? raw.slice(TAG_PREFIX.length).trim() : '';

  return tag ? { kind: 'TAG', tag } : null;
}
