import { createHash } from 'crypto';

/** Days after which something a player did weighs half as much. */
const HALF_LIFE_DAYS = 3;

/** Whole days of signals behind "trending" and "new and rising". */
export const TRENDING_WINDOW_DAYS = 7;

/** A game stops being new this many days after it first reached the hub. */
export const RISING_MAX_AGE_DAYS = 30;

/** What the game that opened a shelf yesterday keeps of its weight today. */
export const REPEAT_OPENER_WEIGHT = 0.5;

export interface Signals {
  plays: number;
  likes: number;
  comments: number;
  forks: number;
}

/** The signals of one UTC day, `ageDays` days before the day being computed. */
export type DailySignals = Signals & { ageDays: number };

/** One number for what players did with a game: the rarer the gesture, the more it says. */
export function engagement({ plays, likes, comments, forks }: Signals): number {
  return plays + 3 * likes + 4 * comments + 6 * forks;
}

/** Engagement over the days given, each weighing half of what a day three days later weighs. */
export function activity(days: DailySignals[]): number {
  return days.reduce(
    (sum, day) => sum + engagement(day) * 0.5 ** (day.ageDays / HALF_LIFE_DAYS),
    0,
  );
}

/** Activity against the time a game has been out: a newer game rises on less. */
export function risingScore(activityScore: number, daysOut: number): number {
  return activityScore / Math.sqrt(Math.max(daysOut, 1));
}

/**
 * A number strictly between 0 and 1, fixed by the seed and the key: every run of a day, on any
 * instance, draws the same one, and no draw depends on the order the others were made in.
 */
export function draw(seed: string, key: string): number {
  const digest = createHash('sha256').update(`${seed}\n${key}`).digest();

  return (digest.readUIntBE(0, 6) + 1) / (2 ** 48 + 1);
}

/**
 * A weighted sampling without replacement, drawn to the last item: an order in which a heavier
 * item tends to come earlier without ever being sure to (Efraimidis-Spirakis, rank = ln(u) / w).
 * Items without weight come after every other, in the order of their own draw.
 */
export function weightedOrder<T>(
  items: T[],
  seed: string,
  keyOf: (item: T) => string,
  weightOf: (item: T) => number,
): T[] {
  return items
    .map((item) => {
      const drawn = draw(seed, keyOf(item));
      const weight = weightOf(item);

      return { item, drawn, rank: weight > 0 ? Math.log(drawn) / weight : -Infinity };
    })
    .sort((a, b) => (a.rank === b.rank ? b.drawn - a.drawn : b.rank - a.rank))
    .map(({ item }) => item);
}

/**
 * Reorders so that a page holds at most `maxPerAuthor` games of one author: the surplus waits for
 * the next page with room. A page the catalogue cannot fill that way is completed with what
 * waits, in order, rather than left short.
 */
export function spreadAuthors<T extends { authorId: string }>(
  items: T[],
  pageSize: number,
  maxPerAuthor: number,
): T[] {
  const laidOut: T[] = [];
  let waiting = items;

  while (waiting.length > 0) {
    const held = new Map<string, number>();
    const page: T[] = [];
    const deferred: T[] = [];

    for (const item of waiting) {
      const count = held.get(item.authorId) ?? 0;
      if (page.length < pageSize && count < maxPerAuthor) {
        page.push(item);
        held.set(item.authorId, count + 1);
      } else {
        deferred.push(item);
      }
    }

    const room = pageSize - page.length;
    laidOut.push(...page, ...deferred.slice(0, room));
    waiting = deferred.slice(room);
  }

  return laidOut;
}

/**
 * Keeps a shelf off what the shelves before it show. With a page of other games to open on, its
 * first page avoids their first pages; without one, only its opener avoids theirs, so a small
 * catalogue still opens each shelf on a different game without burying its best ones.
 */
export function keepApart<T extends { id: string }>(
  ordered: T[],
  taken: { firstPages: ReadonlySet<string>; openers: ReadonlySet<string> },
  pageSize: number,
): T[] {
  const unseen = ordered.filter((item) => !taken.firstPages.has(item.id));
  if (unseen.length >= pageSize) {
    return [...unseen, ...ordered.filter((item) => taken.firstPages.has(item.id))];
  }

  const opener = ordered.findIndex((item) => !taken.openers.has(item.id));
  if (opener <= 0) {
    return ordered;
  }

  return [
    ...ordered.slice(opener, opener + 1),
    ...ordered.slice(0, opener),
    ...ordered.slice(opener + 1),
  ];
}
