import { HUB_SHELF_SIZE } from './hub-limits';
import {
  keepApart,
  REPEAT_OPENER_WEIGHT,
  RISING_MAX_AGE_DAYS,
  risingScore,
  spreadAuthors,
  weightedOrder,
} from './hub-scoring';

/** Pages of a shelf the day's draw is made in: enough to rotate, few enough to stay the best. */
const POOL_PAGES = 3;

const MAX_GAMES_PER_AUTHOR = 2;

/** A tag gets a shelf once this many games on the hub carry it. */
const TAG_SHELF_MIN_GAMES = 3;

/** Tag shelves a day offers; the draw decides which when more tags qualify. */
const TAG_SHELVES_MAX = 60;

/** What the engine knows of a game on the hub when it composes a day. */
export interface HubCandidate {
  id: number;
  authorId: number;
  tags: string[];
  /** Engagement since the game was released. */
  lifetime: number;
  /** Decayed engagement over the trending window. */
  activity: number;
  /** Days since the game first reached the hub. */
  daysOut: number;
}

/** A shelf as a snapshot keeps it: the day's order of its pool, and how many games it lists. */
export interface ShelfPool {
  total: number;
  games: number[];
}

/** One UTC day of the hub, as project ids. */
export interface HubSnapshotPayload {
  popular: ShelfPool;
  trending: ShelfPool;
  /** New and rising, which only the hero draws from. */
  rising: number[];
  /** The tag shelves of the day, in the order the page offers them. */
  tags: (ShelfPool & { tag: string })[];
}

type Scored = { id: number; authorId: number; score: number };

/**
 * The day's order of one shelf: its best pages by score, drawn by weight, the game that opened
 * the shelf yesterday at a reduced weight. The pool takes no more of an author than its pages can
 * show, so a prolific author does not crowd the others out of it.
 */
function drawPool(
  candidates: Scored[],
  seed: string,
  yesterdayOpener: number | undefined,
): Scored[] {
  const size = POOL_PAGES * HUB_SHELF_SIZE;
  const pool = spreadAuthors(
    [...candidates].sort((a, b) => b.score - a.score || a.id - b.id),
    size,
    POOL_PAGES * MAX_GAMES_PER_AUTHOR,
  ).slice(0, size);

  return weightedOrder(
    pool,
    seed,
    (game) => game.id,
    (game) => (game.id === yesterdayOpener ? game.score * REPEAT_OPENER_WEIGHT : game.score),
  );
}

/**
 * The shelves of `day` (`YYYY-MM-DD`) over the games on the hub. The day and the shelf seed every
 * draw, so composing a day again gives the same shelves, and the next day gives others.
 */
export function composeSnapshot(
  games: HubCandidate[],
  day: string,
  yesterday: HubSnapshotPayload | null,
): HubSnapshotPayload {
  const seed = (shelf: string): string => `${day}:${shelf}`;
  const paged = (ordered: Scored[]): number[] =>
    spreadAuthors(ordered, HUB_SHELF_SIZE, MAX_GAMES_PER_AUTHOR).map((game) => game.id);

  const popular = paged(
    drawPool(
      games.map((game) => ({ ...game, score: game.lifetime })),
      seed('popular'),
      yesterday?.popular.games[0],
    ),
  );
  const trending = paged(
    keepApart(
      drawPool(
        games
          .filter((game) => game.activity > 0)
          .map((game) => ({ ...game, score: game.activity })),
        seed('trending'),
        yesterday?.trending.games[0],
      ),
      {
        firstPages: new Set(popular.slice(0, HUB_SHELF_SIZE)),
        openers: new Set(popular.slice(0, 1)),
      },
      HUB_SHELF_SIZE,
    ),
  );
  const rising = paged(
    drawPool(
      games
        .filter((game) => game.daysOut <= RISING_MAX_AGE_DAYS)
        .map((game) => ({ ...game, score: risingScore(game.activity, game.daysOut) })),
      seed('rising'),
      yesterday?.rising[0],
    ),
  );

  const tagged = new Map<string, HubCandidate[]>();
  for (const game of games) {
    for (const tag of new Set(game.tags)) {
      const carriers = tagged.get(tag) ?? [];
      carriers.push(game);
      tagged.set(tag, carriers);
    }
  }
  const tags = weightedOrder(
    [...tagged].filter(([, carriers]) => carriers.length >= TAG_SHELF_MIN_GAMES),
    seed('tags'),
    ([tag]) => tag,
    // Every tag keeps a chance to open the list; a busy one gets more of them.
    ([, carriers]) => 1 + carriers.reduce((sum, game) => sum + game.activity, 0),
  )
    .slice(0, TAG_SHELVES_MAX)
    .map(([tag, carriers]) => ({
      tag,
      total: carriers.length,
      games: paged(
        drawPool(
          // What moves now leads; what was played over the years orders the quiet games.
          carriers.map((game) => ({ ...game, score: game.activity + Math.log1p(game.lifetime) })),
          seed(`tag:${tag}`),
          yesterday?.tags.find((shelf) => shelf.tag === tag)?.games[0],
        ),
      ),
    }));

  return {
    popular: { total: games.length, games: popular },
    trending: { total: trending.length, games: trending },
    rising,
    tags,
  };
}
