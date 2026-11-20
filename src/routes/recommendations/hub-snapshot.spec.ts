import { HUB_COLLECTIONS_SIZE, HUB_SHELF_SIZE } from './hub-limits';
import {
  composeSnapshot,
  HubCandidate,
  HubCollectionCandidate,
  HubSnapshotPayload,
} from './hub-snapshot';

const DAY = '2026-11-20';
const NEXT_DAY = '2026-11-21';

/** A game on the hub with an author of its own, a little activity and no tag. */
const game = (id: number, overrides: Partial<HubCandidate> = {}): HubCandidate => ({
  id,
  authorId: 1000 + id,
  tags: [],
  lifetime: 50,
  activity: 5,
  daysOut: 200,
  ...overrides,
});

const catalogue = (
  count: number,
  overrides: (id: number) => Partial<HubCandidate> = () => ({}),
): HubCandidate[] =>
  Array.from({ length: count }, (_, index) => game(index + 1, overrides(index + 1)));

const firstPage = (games: number[]): number[] => games.slice(0, HUB_SHELF_SIZE);

/** A public collection of three games on the hub, with an owner of its own. */
const collection = (
  index: number,
  overrides: Partial<HubCollectionCandidate> = {},
): HubCollectionCandidate => ({
  id: `c${index}`,
  ownerId: 2000 + index,
  games: [1, 2, 3],
  ...overrides,
});

/** The snapshots of `days` consecutive days, each composed over the one before. */
function consecutiveDays(
  games: HubCandidate[],
  days: number,
  collections: HubCollectionCandidate[] = [],
): HubSnapshotPayload[] {
  const snapshots: HubSnapshotPayload[] = [];
  const start = Date.UTC(2026, 0, 1);

  for (let offset = 0; offset < days; offset++) {
    const day = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
    snapshots.push(composeSnapshot(games, collections, day, snapshots[offset - 1] ?? null));
  }

  return snapshots;
}

describe('composeSnapshot', () => {
  it('draws a day the same way however often it is composed', () => {
    const games = catalogue(60, (id) => ({ tags: [id % 2 ? 'arcade' : 'puzzle'] }));

    expect(composeSnapshot(games, [], DAY, null)).toEqual(composeSnapshot(games, [], DAY, null));
  });

  it('opens every shelf on other games the next day, when the pool is larger than a page', () => {
    const games = catalogue(60, () => ({ tags: ['arcade'], daysOut: 10 }));

    const today = composeSnapshot(games, [], DAY, null);
    const tomorrow = composeSnapshot(games, [], NEXT_DAY, today);

    expect(firstPage(tomorrow.popular.games)).not.toEqual(firstPage(today.popular.games));
    expect(firstPage(tomorrow.trending.games)).not.toEqual(firstPage(today.trending.games));
    expect(firstPage(tomorrow.rising)).not.toEqual(firstPage(today.rising));
    expect(firstPage(tomorrow.tags[0]!.games)).not.toEqual(firstPage(today.tags[0]!.games));
    expect([...firstPage(tomorrow.popular.games)].sort()).not.toEqual(
      [...firstPage(today.popular.games)].sort(),
    );
  });

  it('draws within the three best pages of a shelf, never below', () => {
    const games = catalogue(100, (id) => ({ lifetime: id }));

    const { popular } = composeSnapshot(games, [], DAY, null);

    expect(popular.games).toHaveLength(3 * HUB_SHELF_SIZE);
    expect(Math.min(...popular.games)).toBe(100 - 3 * HUB_SHELF_SIZE + 1);
    expect(popular.total).toBe(100);
  });

  it('holds at most two games of an author on a page, however many of them lead the scores', () => {
    const games = catalogue(120, (id) =>
      id <= 20 ? { authorId: 7, lifetime: 500, activity: 500 } : {},
    );
    const authorOf = new Map(games.map((candidate) => [candidate.id, candidate.authorId]));

    const { popular, trending } = composeSnapshot(games, [], DAY, null);

    for (const shelf of [popular.games, trending.games]) {
      expect(shelf).toHaveLength(3 * HUB_SHELF_SIZE);
      for (let start = 0; start < shelf.length; start += HUB_SHELF_SIZE) {
        const prolific = shelf
          .slice(start, start + HUB_SHELF_SIZE)
          .filter((id) => authorOf.get(id) === 7);
        expect(prolific.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('halves the chances of the game that opened a shelf the day before', () => {
    const openers = consecutiveDays(catalogue(2), 600).map((snapshot) => snapshot.popular.games[0]);
    const repeats = openers.filter(
      (opener, index) => index > 0 && opener === openers[index - 1],
    ).length;

    // Two games of equal weight: one opens again a day in two without the penalty, one in three
    // with it.
    expect(repeats).toBeGreaterThan(160);
    expect(repeats).toBeLessThan(240);
  });

  describe('trending and popular', () => {
    it('never open on the same game', () => {
      for (const snapshot of consecutiveDays(catalogue(10), 60)) {
        expect(snapshot.trending.games[0]).not.toBe(snapshot.popular.games[0]);
      }
    });

    it('show a first page each, without a game in common, when the catalogue has two pages', () => {
      const { popular, trending } = composeSnapshot(catalogue(60), [], DAY, null);
      const popularFirst = new Set(firstPage(popular.games));

      expect(firstPage(trending.games).filter((id) => popularFirst.has(id))).toEqual([]);
    });

    it('keep the best trending games on the first page of a small catalogue', () => {
      const games = catalogue(30, (id) => ({ activity: id === 30 ? 10_000 : 1 }));

      for (const snapshot of consecutiveDays(games, 20)) {
        expect(firstPage(snapshot.trending.games)).toContain(30);
      }
    });
  });

  it('lists as trending only the games something happened to', () => {
    const games = [game(1, { activity: 0 }), game(2), game(3, { activity: 0 }), game(4)];

    const { trending, popular } = composeSnapshot(games, [], DAY, null);

    expect([...trending.games].sort()).toEqual([2, 4]);
    expect(trending.total).toBe(2);
    expect(popular.games).toHaveLength(4);
  });

  it('lists as new and rising only the games out for thirty days at most', () => {
    const games = [game(1, { daysOut: 30 }), game(2, { daysOut: 30.5 }), game(3, { daysOut: 2 })];

    expect([...composeSnapshot(games, [], DAY, null).rising].sort()).toEqual([1, 3]);
  });

  it('puts a new game that rises ahead of one that does not', () => {
    const games = [
      game(1, { daysOut: 4, activity: 0 }),
      game(2, { daysOut: 4, activity: 40 }),
      game(3, { daysOut: 4, activity: 0 }),
    ];

    for (const snapshot of consecutiveDays(games, 20)) {
      expect(snapshot.rising[0]).toBe(2);
    }
  });

  describe('tag shelves', () => {
    it('exist for a tag three games carry, and hold only its games', () => {
      const games = [
        game(1, { tags: ['arcade', 'solo'] }),
        game(2, { tags: ['arcade'] }),
        game(3, { tags: ['arcade', 'solo'] }),
        game(4, { tags: ['puzzle'] }),
        game(5, { tags: ['puzzle', 'puzzle'] }),
      ];

      const { tags } = composeSnapshot(games, [], DAY, null);

      expect(tags).toHaveLength(1);
      expect(tags[0]).toMatchObject({ tag: 'arcade', total: 3 });
      expect([...tags[0]!.games].sort()).toEqual([1, 2, 3]);
    });

    it('come in another order the next day, the busiest tags first more often', () => {
      const names = ['arcade', 'puzzle', 'race', 'solo', 'duel', 'story'];
      const games = catalogue(36, (id) => ({
        tags: [names[id % 6]!],
        activity: id % 6 === 0 ? 400 : 1,
      }));

      const days = consecutiveDays(games, 200).map((snapshot) =>
        snapshot.tags.map((shelf) => shelf.tag),
      );

      expect(days[0]).toHaveLength(6);
      expect(new Set(days.map((order) => order.join())).size).toBeGreaterThan(20);
      expect(days.filter(([first]) => first === 'arcade').length).toBeGreaterThan(150);
    });

    it('open on the game something happens to most days, and on a quiet one now and then', () => {
      const games = catalogue(6, (id) => ({
        tags: ['arcade'],
        activity: id === 6 ? 300 : 0,
        lifetime: 10,
      }));

      const openers = consecutiveDays(games, 200).map((snapshot) => snapshot.tags[0]!.games[0]);
      const busy = openers.filter((opener) => opener === 6).length;

      expect(busy).toBeGreaterThan(160);
      expect(busy).toBeLessThan(200);
    });
  });

  it('answers empty shelves for an empty hub', () => {
    expect(composeSnapshot([], [], DAY, null)).toEqual({
      popular: { total: 0, games: [] },
      trending: { total: 0, games: [] },
      rising: [],
      tags: [],
      collections: { total: 0, ids: [] },
    });
  });

  describe('collections', () => {
    const games = catalogue(12);
    const idsOf = (collections: HubCollectionCandidate[], day = DAY): string[] =>
      composeSnapshot(games, collections, day, null).collections.ids;

    it('are put forward from three games on the hub, and all counted', () => {
      const { collections } = composeSnapshot(
        games,
        [collection(1), collection(2, { games: [1, 2] }), collection(3, { games: [4, 5, 6, 7] })],
        DAY,
        null,
      );

      expect([...collections.ids].sort()).toEqual(['c1', 'c3']);
      expect(collections.total).toBe(3);
    });

    it('come one per owner, an owner of several showing another of theirs on other days', () => {
      const collections = [
        ...[1, 2, 3, 4].map((index) => collection(index, { ownerId: 7 })),
        collection(5),
        collection(6),
      ];

      const days = consecutiveDays(games, 60, collections).map((snapshot) =>
        snapshot.collections.ids.filter((id) => id <= 'c4'),
      );

      expect(days.every((ofOwner) => ofOwner.length === 1)).toBe(true);
      expect(new Set(days.flat()).size).toBe(4);
    });

    it('are drawn the same way however often a day is composed, and otherwise the next day', () => {
      const collections = Array.from({ length: 10 }, (_, index) => collection(index));

      expect(idsOf(collections)).toEqual(idsOf(collections));
      expect(idsOf(collections, NEXT_DAY)).not.toEqual(idsOf(collections));
    });

    it('open on the one whose games move most days, and on a quiet one now and then', () => {
      const moving = catalogue(12, (id) => ({ activity: id <= 3 ? 100 : 0 }));
      const collections = [
        collection(1),
        ...[2, 3, 4, 5].map((index) => collection(index, { games: [4, 5, 6] })),
      ];

      const openers = consecutiveDays(moving, 200, collections).map(
        (snapshot) => snapshot.collections.ids[0],
      );
      const busy = openers.filter((opener) => opener === 'c1').length;

      expect(busy).toBeGreaterThan(160);
      expect(busy).toBeLessThan(200);
    });

    it('open less often on the one that opened the shelf the day before', () => {
      const openers = consecutiveDays(games, 300, [collection(1), collection(2)]).map(
        (snapshot) => snapshot.collections.ids[0],
      );

      // Two of equal weight would repeat every other day; at half weight, one day in three.
      const repeats = openers.filter((opener, index) => index > 0 && opener === openers[index - 1]);
      expect(repeats.length).toBeGreaterThan(70);
      expect(repeats.length).toBeLessThan(130);
    });

    it('keep twice what the shelf shows', () => {
      const collections = Array.from({ length: 60 }, (_, index) => collection(index));

      expect(idsOf(collections)).toHaveLength(2 * HUB_COLLECTIONS_SIZE);
    });
  });
});
