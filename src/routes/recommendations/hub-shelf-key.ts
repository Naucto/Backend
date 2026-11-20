export const HUB_SHELF_KINDS = ['POPULAR', 'TRENDING', 'FRIENDS', 'TAG', 'COLLECTIONS'] as const;
export type HubShelfKind = (typeof HUB_SHELF_KINDS)[number];

type FixedGameShelf = Exclude<HubShelfKind, 'TAG' | 'COLLECTIONS'>;

/**
 * A shelf of games as a client names it: `popular`, `trending`, `friends`, or `tag:<tag>`. The
 * shelf of collections has no key here: it holds no game, and its "see all" is the public list
 * of collections.
 */
export type HubShelfKey = { kind: FixedGameShelf } | { kind: 'TAG'; tag: string };

/** What the shelf of collections is named by in an answer. */
export const COLLECTIONS_SHELF_KEY = 'collections';

const TAG_PREFIX = 'tag:';

const FIXED_KEYS: Record<string, FixedGameShelf> = {
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
