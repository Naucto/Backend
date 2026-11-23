import { uuidOf } from '../../../test/uuid';
import {
  activity,
  draw,
  engagement,
  keepApart,
  risingScore,
  spreadAuthors,
  weightedOrder,
} from './hub-scoring';

const none = { plays: 0, likes: 0, comments: 0, forks: 0 };
const ids = (items: { id: string }[]): string[] => items.map((item) => item.id);
const games = (...numbers: number[]): string[] => numbers.map(uuidOf);

describe('hub scoring', () => {
  describe('engagement', () => {
    it('counts a play once, a like three times, a comment four times and a fork six times', () => {
      expect(engagement({ plays: 5, likes: 2, comments: 1, forks: 1 })).toBe(5 + 6 + 4 + 6);
    });
  });

  describe('activity', () => {
    it('halves what a day weighs every three days', () => {
      const today = activity([{ ...none, plays: 8, ageDays: 0 }]);

      expect(today).toBe(8);
      expect(activity([{ ...none, plays: 8, ageDays: 3 }])).toBeCloseTo(today / 2);
      expect(activity([{ ...none, plays: 8, ageDays: 6 }])).toBeCloseTo(today / 4);
    });

    it('adds the days of a window, and is nothing without any', () => {
      expect(
        activity([
          { ...none, likes: 1, ageDays: 3 },
          { ...none, plays: 2, ageDays: 6 },
        ]),
      ).toBeCloseTo(1.5 + 0.5);
      expect(activity([])).toBe(0);
    });
  });

  describe('risingScore', () => {
    it('divides the activity by the square root of the days a game has been out', () => {
      expect(risingScore(12, 9)).toBe(4);
    });

    it('treats a game out for less than a day as out for one', () => {
      expect(risingScore(12, 0.2)).toBe(12);
    });
  });

  describe('draw', () => {
    it('is the same for the same seed and key, strictly between 0 and 1', () => {
      for (let key = 0; key < 200; key++) {
        const drawn = draw('2026-11-20:popular', uuidOf(key));

        expect(drawn).toBe(draw('2026-11-20:popular', uuidOf(key)));
        expect(drawn).toBeGreaterThan(0);
        expect(drawn).toBeLessThan(1);
      }
    });

    it('changes with the seed and with the key', () => {
      expect(draw('2026-11-20:popular', uuidOf(1))).not.toBe(draw('2026-11-21:popular', uuidOf(1)));
      expect(draw('2026-11-20:popular', uuidOf(1))).not.toBe(
        draw('2026-11-20:trending', uuidOf(1)),
      );
      expect(draw('2026-11-20:popular', uuidOf(1))).not.toBe(draw('2026-11-20:popular', uuidOf(2)));
    });
  });

  describe('weightedOrder', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: uuidOf(index + 1), weight: 1 }));
    const order = (seed: string, weighted = items): string[] =>
      ids(
        weightedOrder(
          weighted,
          seed,
          (item) => item.id,
          (item) => item.weight,
        ),
      );

    it('keeps every item, once', () => {
      expect([...order('a')].sort()).toEqual(ids(items));
    });

    it('gives the same order for the same seed and another for another seed', () => {
      expect(order('a')).toEqual(order('a'));
      expect(order('a')).not.toEqual(order('b'));
    });

    it('does not depend on the order the items came in', () => {
      expect(order('a', [...items].reverse())).toEqual(order('a'));
    });

    it('puts a heavier item first more often, in proportion to its weight', () => {
      const pair = [
        { id: uuidOf(1), weight: 9 },
        { id: uuidOf(2), weight: 1 },
      ];
      const heavyFirst = Array.from({ length: 1000 }, (_, seed) =>
        order(`seed-${seed}`, pair),
      ).filter(([first]) => first === uuidOf(1)).length;

      expect(heavyFirst).toBeGreaterThan(850);
      expect(heavyFirst).toBeLessThan(950);
    });

    it('puts the items without weight after every other', () => {
      const weighted = [
        { id: uuidOf(1), weight: 0 },
        { id: uuidOf(2), weight: 0.001 },
        { id: uuidOf(3), weight: 0 },
        { id: uuidOf(4), weight: 5 },
      ];

      for (let seed = 0; seed < 50; seed++) {
        expect(order(`seed-${seed}`, weighted).slice(0, 2).sort()).toEqual(games(2, 4));
      }
    });
  });

  describe('spreadAuthors', () => {
    const game = (id: number, authorId: number): { id: string; authorId: string } => ({
      id: uuidOf(id),
      authorId: uuidOf(authorId),
    });

    it('leaves an order that already fits as it is', () => {
      const laid = [game(1, 1), game(2, 2), game(3, 1), game(4, 3)];

      expect(spreadAuthors(laid, 4, 2)).toEqual(laid);
    });

    it("moves an author's third game of a page to the next one, keeping the rest in order", () => {
      const laid = [game(1, 9), game(2, 9), game(3, 9), game(4, 1), game(5, 2), game(6, 3)];

      expect(ids(spreadAuthors(laid, 3, 2))).toEqual(games(1, 2, 4, 3, 5, 6));
    });

    it('holds at most two games of an author on every page the catalogue can fill otherwise', () => {
      const laid = [
        ...Array.from({ length: 6 }, (_, index) => game(index + 1, 9)),
        ...Array.from({ length: 12 }, (_, index) => game(index + 100, index + 100)),
      ];

      const laidOut = spreadAuthors(laid, 6, 2);

      expect(laidOut).toHaveLength(laid.length);
      for (let start = 0; start < laidOut.length; start += 6) {
        const prolific = laidOut
          .slice(start, start + 6)
          .filter((item) => item.authorId === uuidOf(9));
        expect(prolific.length).toBeLessThanOrEqual(2);
      }
    });

    it('fills a page with what waits rather than leave it short of games', () => {
      const laid = [game(1, 9), game(2, 9), game(3, 9), game(4, 9), game(5, 1)];

      expect(ids(spreadAuthors(laid, 4, 2))).toEqual(games(1, 2, 5, 3, 4));
    });
  });

  describe('keepApart', () => {
    const shelf = games(1, 2, 3, 4, 5, 6).map((id) => ({ id }));

    it('opens on games the earlier shelves do not show, when it has a page of them', () => {
      const taken = { firstPages: new Set(games(1, 3)), openers: new Set(games(1)) };

      expect(ids(keepApart(shelf, taken, 4))).toEqual(games(2, 4, 5, 6, 1, 3));
    });

    it('only moves its opener when it has less than a page of other games', () => {
      const taken = { firstPages: new Set(games(1, 2, 3, 4)), openers: new Set(games(1)) };

      expect(ids(keepApart(shelf, taken, 4))).toEqual(games(2, 1, 3, 4, 5, 6));
    });

    it('stays as drawn when it already opens on a game of its own', () => {
      const taken = { firstPages: new Set(games(2, 3, 4, 5)), openers: new Set(games(2)) };

      expect(ids(keepApart(shelf, taken, 4))).toEqual(ids(shelf));
    });

    it('stays as drawn when every game it has opens an earlier shelf', () => {
      const taken = { firstPages: new Set(games(1, 2)), openers: new Set(games(1, 2)) };

      expect(ids(keepApart(shelf.slice(0, 2), taken, 4))).toEqual(games(1, 2));
    });
  });
});
