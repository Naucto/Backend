import { BadRequestException } from '@nestjs/common';

import { aProject } from '../../../test/project-mocks';
import { PresenceService } from '../../presence/presence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { HubService } from '../project/hub.service';
import { ReleaseProject } from '../project/project-select';
import { HubFeedService } from './hub-feed.service';
import { HubSnapshotPayload } from './hub-snapshot';
import { HubSnapshotService } from './hub-snapshot.service';
import { RecommendationsService } from './recommendations.service';

const NOW = new Date('2026-11-20T12:00:00Z');
const ME = 1;

/** A game on the hub as the project module hands it over, private fields included. */
const release = (id: number, overrides: Partial<ReleaseProject> = {}): ReleaseProject => ({
  ...aProject({ id, name: `Game ${id}`, publishedAt: new Date('2026-10-01T00:00:00Z') }),
  tags: [],
  contentSize: { code: 12 },
  releaseContentHash: 'hash',
  releaseRevision: 3,
  commentCount: 0,
  forkCount: 0,
  coverUrl: `https://cdn.test/projects/${id}/image?v=1`,
  ...overrides,
});

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('HubFeedService', () => {
  /** The games on the hub; an id missing from it reads as a game that left. */
  let onHub: Map<number, ReleaseProject>;
  let payload: HubSnapshotPayload;

  const prisma = {
    analyticsUserDaily: { groupBy: jest.fn(), findMany: jest.fn() },
  };
  const snapshots = { today: jest.fn() };
  const hubService = {
    fetchReleasesByIds: jest.fn(),
    fetchLastEdited: jest.fn(),
    fetchPublishedGamesPaginated: jest.fn(),
  };
  const recommendations = { getCurrent: jest.fn() };
  const friendsService = { friendIdsOf: jest.fn() };
  const presence = { get: jest.fn() };
  let service: HubFeedService;

  /** What friends played lately, as the grouping by game and friend answers it. */
  const friendsPlayed = (
    ...rows: [releaseId: number, userId: number, activeMs?: bigint][]
  ): void => {
    prisma.analyticsUserDaily.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by.includes('userId')
        ? rows.map(([releaseId, userId, activeMs]) => ({
            releaseId,
            userId,
            _sum: { activeMs: activeMs ?? 60_000n },
          }))
        : [],
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    onHub = new Map(range(1, 60).map((id) => [id, release(id)]));
    payload = {
      popular: { total: 60, games: range(1, 30) },
      trending: { total: 12, games: range(31, 42) },
      rising: range(51, 60),
      tags: [
        { tag: 'arcade', total: 4, games: [3, 33, 35, 52] },
        { tag: 'puzzle', total: 3, games: [5, 6, 7] },
      ],
    };
    snapshots.today.mockImplementation(async () => ({ day: '2026-11-20', payload }));
    hubService.fetchReleasesByIds.mockImplementation(async (ids: number[]) =>
      ids.flatMap((id) => onHub.get(id) ?? []),
    );
    hubService.fetchLastEdited.mockResolvedValue(null);
    recommendations.getCurrent.mockResolvedValue(null);
    friendsService.friendIdsOf.mockResolvedValue([]);
    presence.get.mockReturnValue(null);
    prisma.analyticsUserDaily.groupBy.mockResolvedValue([]);
    prisma.analyticsUserDaily.findMany.mockResolvedValue([]);

    service = new HubFeedService(
      prisma as unknown as PrismaService,
      snapshots as unknown as HubSnapshotService,
      hubService as unknown as HubService,
      recommendations as unknown as RecommendationsService,
      friendsService as unknown as FriendsService,
      presence as unknown as PresenceService,
    );
  });

  const heroOf = async (viewer: number | null): Promise<[string, number][]> =>
    (await service.feed(viewer, NOW)).hero.map((slot) => [slot.reason, slot.game.id]);

  describe('feed, signed out', () => {
    it('stacks the game of the week, two trending games and a new one', async () => {
      recommendations.getCurrent.mockResolvedValue({ project: release(9) });

      await expect(heroOf(null)).resolves.toEqual([
        ['GAME_OF_THE_WEEK', 9],
        ['TRENDING', 31],
        ['TRENDING', 32],
        ['NEW_AND_RISING', 51],
      ]);
    });

    it('never shows a game twice in the hero', async () => {
      recommendations.getCurrent.mockResolvedValue({ project: release(31) });
      payload.rising = [32, 33, 55];

      await expect(heroOf(null)).resolves.toEqual([
        ['GAME_OF_THE_WEEK', 31],
        ['TRENDING', 32],
        ['TRENDING', 33],
        ['NEW_AND_RISING', 55],
      ]);
    });

    it('fills the slot of a week without a pick with the next trending game', async () => {
      await expect(heroOf(null)).resolves.toEqual([
        ['TRENDING', 31],
        ['TRENDING', 32],
        ['TRENDING', 33],
        ['NEW_AND_RISING', 51],
      ]);
    });

    it('stacks fewer games rather than repeat one on a nearly empty hub', async () => {
      payload.trending = { total: 1, games: [31] };
      payload.rising = [31];

      await expect(heroOf(null)).resolves.toEqual([['TRENDING', 31]]);
    });

    it('opens on popular then trending, a page each, and names the tag shelves to fetch', async () => {
      const feed = await service.feed(null, NOW);

      expect(feed.day).toBe('2026-11-20');
      expect(feed.shelves.map(({ key, kind, total }) => [key, kind, total])).toEqual([
        ['popular', 'POPULAR', 60],
        ['trending', 'TRENDING', 12],
      ]);
      expect(feed.shelves[0]?.games.map((game) => game.id)).toEqual(range(1, 24));
      expect(feed.more).toEqual(['tag:arcade', 'tag:puzzle']);
    });

    it('leaves out a shelf with nothing to show', async () => {
      payload.trending = { total: 0, games: [] };

      const feed = await service.feed(null, NOW);

      expect(feed.shelves.map((shelf) => shelf.key)).toEqual(['popular']);
    });

    it('leaves out a shelf whose games all left the hub since the day was drawn', async () => {
      payload.trending.games.forEach((id) => onHub.delete(id));
      onHub.delete(2);

      const feed = await service.feed(null, NOW);

      expect(feed.shelves.map((shelf) => shelf.key)).toEqual(['popular']);
      expect(feed.shelves[0]?.games.map((game) => game.id)).not.toContain(2);
    });

    it('reads nothing about anyone', async () => {
      await service.feed(null, NOW);

      expect(prisma.analyticsUserDaily.groupBy).not.toHaveBeenCalled();
      expect(prisma.analyticsUserDaily.findMany).not.toHaveBeenCalled();
      expect(friendsService.friendIdsOf).not.toHaveBeenCalled();
      expect(hubService.fetchLastEdited).not.toHaveBeenCalled();
      expect(presence.get).not.toHaveBeenCalled();
    });

    it('hands out the card of a game, not what only its authors may read', async () => {
      const feed = await service.feed(null, NOW);
      const cards = [
        ...feed.hero.map((slot) => slot.game),
        ...feed.shelves.flatMap((shelf) => shelf.games),
      ];

      expect(cards).not.toHaveLength(0);
      for (const card of cards) {
        expect(card).not.toHaveProperty('contentSize');
        expect(card).not.toHaveProperty('contentSizeTotal');
        expect(card).not.toHaveProperty('releaseContentHash');
        expect(card).not.toHaveProperty('releaseRevision');
        expect(card.coverUrl).toBe(`https://cdn.test/projects/${card.id}/image?v=1`);
      }
    });
  });

  describe('feed, signed in', () => {
    it('puts the project the reader last worked on second, released or not', async () => {
      hubService.fetchLastEdited.mockResolvedValue(release(77, { publishedAt: null }));

      const hero = await heroOf(ME);

      expect(hero[1]).toEqual(['CONTINUE', 77]);
      expect(hubService.fetchLastEdited).toHaveBeenCalledWith(ME);
    });

    it('puts what friends play fourth and on a shelf of its own, the most shared first', async () => {
      friendsService.friendIdsOf.mockResolvedValue([2, 3, 4]);
      friendsPlayed([12, 2], [14, 2], [14, 3], [14, 4], [12, 3], [16, 4, 999_000n]);

      const feed = await service.feed(ME, NOW);

      expect(feed.hero[3]).toMatchObject({ reason: 'FRIENDS_PLAY', game: { id: 14 } });
      expect(feed.shelves.map((shelf) => shelf.key)).toEqual(['popular', 'friends', 'trending']);
      expect(feed.shelves[1]).toMatchObject({ kind: 'FRIENDS', total: 3 });
      expect(feed.shelves[1]?.games.map((game) => game.id)).toEqual([14, 12, 16]);
    });

    it('puts first the games friends are in right now', async () => {
      friendsService.friendIdsOf.mockResolvedValue([2, 3]);
      friendsPlayed([14, 2], [14, 3]);
      presence.get.mockImplementation((userId: number) =>
        userId === 3 ? { kind: 'PLAYING', releaseId: 20 } : { kind: 'BUILDING', releaseId: null },
      );

      const feed = await service.feed(ME, NOW);

      expect(feed.shelves[1]?.games.map((game) => game.id)).toEqual([20, 14]);
    });

    it('reads the play history of friends only, over two weeks', async () => {
      friendsService.friendIdsOf.mockResolvedValue([2, 3]);

      await service.feed(ME, NOW);

      expect(friendsService.friendIdsOf).toHaveBeenCalledWith(ME);
      expect(prisma.analyticsUserDaily.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['releaseId', 'userId'],
          where: {
            userId: { in: [2, 3] },
            releaseId: { not: 0 },
            day: { gte: new Date('2026-11-06T12:00:00Z') },
          },
        }),
      );
    });

    it('shows no friends shelf when no friend has a play history, which only consent creates', async () => {
      friendsService.friendIdsOf.mockResolvedValue([2, 3]);

      const feed = await service.feed(ME, NOW);

      expect(feed.shelves.map((shelf) => shelf.key)).toEqual(['popular', 'trending']);
      expect(feed.hero.map((slot) => slot.reason)).not.toContain('FRIENDS_PLAY');
    });

    describe('because you played', () => {
      const iPlayedMost = (releaseId: number, opened: number[] = [releaseId]): void => {
        prisma.analyticsUserDaily.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
          by.includes('userId') ? [] : [{ releaseId, _sum: { activeMs: 500_000n } }],
        );
        prisma.analyticsUserDaily.findMany.mockResolvedValue(
          opened.map((id) => ({ releaseId: id })),
        );
      };

      beforeEach(() => {
        // The first three slots filled otherwise, so only the first trending game is taken.
        recommendations.getCurrent.mockResolvedValue({ project: release(9) });
        hubService.fetchLastEdited.mockResolvedValue(release(77));
        onHub.set(3, release(3, { name: 'Snake', tags: ['arcade', 'solo'] }));
        onHub.set(33, release(33, { tags: ['arcade'] }));
        onHub.set(35, release(35, { tags: ['solo', 'retro'] }));
        onHub.set(36, release(36, { tags: ['puzzle'] }));
      });

      it('puts fourth a trending game sharing a tag with the game the reader played most', async () => {
        iPlayedMost(3);

        const feed = await service.feed(ME, NOW);

        expect(feed.hero[3]).toEqual({
          reason: 'BECAUSE_YOU_PLAYED',
          reasonGame: { id: 3, name: 'Snake' },
          game: expect.objectContaining({ id: 33 }),
        });
      });

      it('skips the games the reader already opened', async () => {
        iPlayedMost(3, [3, 33]);

        const feed = await service.feed(ME, NOW);

        expect(feed.hero[3]).toMatchObject({ reason: 'BECAUSE_YOU_PLAYED', game: { id: 35 } });
      });

      it('reads the history of the reader alone, over thirty days for the game played most', async () => {
        iPlayedMost(3);

        await service.feed(ME, NOW);

        expect(prisma.analyticsUserDaily.groupBy).toHaveBeenCalledWith(
          expect.objectContaining({
            by: ['releaseId'],
            where: {
              userId: ME,
              releaseId: { not: 0 },
              day: { gte: new Date('2026-10-21T12:00:00Z') },
            },
            take: 1,
          }),
        );
        expect(prisma.analyticsUserDaily.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { userId: ME, releaseId: { not: 0 } } }),
        );
      });

      it('gives way to what friends play', async () => {
        iPlayedMost(3);
        friendsService.friendIdsOf.mockResolvedValue([2]);
        prisma.analyticsUserDaily.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
          by.includes('userId')
            ? [{ releaseId: 14, userId: 2, _sum: { activeMs: 1n } }]
            : [{ releaseId: 3, _sum: { activeMs: 500_000n } }],
        );

        const feed = await service.feed(ME, NOW);

        expect(feed.hero[3]).toMatchObject({ reason: 'FRIENDS_PLAY', game: { id: 14 } });
      });

      it('falls back on a new game for a reader without a play history', async () => {
        const feed = await service.feed(ME, NOW);

        expect(feed.hero[3]).toMatchObject({ reason: 'NEW_AND_RISING', game: { id: 51 } });
        expect(prisma.analyticsUserDaily.findMany).not.toHaveBeenCalled();
      });

      it('falls back on a new game when the game played most left the hub', async () => {
        iPlayedMost(999);

        const feed = await service.feed(ME, NOW);

        expect(feed.hero[3]).toMatchObject({ reason: 'NEW_AND_RISING' });
      });

      it('falls back on a new game when no trending game shares a tag', async () => {
        onHub.set(3, release(3, { tags: ['story'] }));
        iPlayedMost(3);

        const feed = await service.feed(ME, NOW);

        expect(feed.hero[3]).toMatchObject({ reason: 'NEW_AND_RISING' });
      });
    });
  });

  describe('shelves', () => {
    it('answers the shelves asked for, in the order asked, a page each', async () => {
      const shelves = await service.shelves(['tag:puzzle', 'trending', 'tag:arcade'], null, NOW);

      expect(shelves).toEqual([
        expect.objectContaining({ key: 'tag:puzzle', kind: 'TAG', tag: 'puzzle', total: 3 }),
        expect.objectContaining({ key: 'trending', kind: 'TRENDING', total: 12 }),
        expect.objectContaining({ key: 'tag:arcade', kind: 'TAG', tag: 'arcade', total: 4 }),
      ]);
      expect(shelves[0]?.games.map((game) => game.id)).toEqual([5, 6, 7]);
      expect(shelves[1]).not.toHaveProperty('tag');
      expect(hubService.fetchReleasesByIds).toHaveBeenCalledTimes(1);
    });

    it('leaves out a tag the day has no shelf for, and the friends of nobody', async () => {
      const shelves = await service.shelves(['tag:unknown', 'friends', 'popular'], null, NOW);

      expect(shelves.map((shelf) => shelf.key)).toEqual(['popular']);
    });

    it('answers the friends shelf to a reader who has one', async () => {
      friendsService.friendIdsOf.mockResolvedValue([2]);
      friendsPlayed([14, 2]);

      const shelves = await service.shelves(['friends'], ME, NOW);

      expect(shelves).toEqual([expect.objectContaining({ key: 'friends', total: 1 })]);
    });

    it('refuses a key that names no shelf', async () => {
      await expect(service.shelves(['popular', 'tag:'], null, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.shelves(['staff-picks'], null, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('shelfPage', () => {
    const page = { projects: [release(4), release(8)], total: 57, page: 2, limit: 2 };

    beforeEach(() => hubService.fetchPublishedGamesPaginated.mockResolvedValue(page));

    it('pages every game on the hub for popular, the most played first', async () => {
      const result = await service.shelfPage('popular', null, { page: 2, limit: 2 }, NOW);

      expect(hubService.fetchPublishedGamesPaginated).toHaveBeenCalledWith(2, 2, {}, 'popular');
      expect(result).toMatchObject({
        key: 'popular',
        kind: 'POPULAR',
        total: 57,
        page: 2,
        limit: 2,
      });
      expect(result.games.map((game) => game.id)).toEqual([4, 8]);
      expect(result.games[0]).not.toHaveProperty('releaseContentHash');
      expect(snapshots.today).not.toHaveBeenCalled();
    });

    it('pages every game carrying the tag for a tag, in the order asked', async () => {
      const result = await service.shelfPage('tag:Action RPG', null, { sort: 'fresh' }, NOW);

      expect(hubService.fetchPublishedGamesPaginated).toHaveBeenCalledWith(
        undefined,
        24,
        { tags: ['Action RPG'] },
        'fresh',
      );
      expect(result).toMatchObject({ key: 'tag:Action RPG', kind: 'TAG', tag: 'Action RPG' });
    });

    it('pages the draw of the day for trending', async () => {
      const result = await service.shelfPage('trending', null, { page: 2, limit: 5 }, NOW);

      expect(result).toMatchObject({ key: 'trending', total: 12, page: 2, limit: 5 });
      expect(result.games.map((game) => game.id)).toEqual(range(36, 40));
      expect(hubService.fetchPublishedGamesPaginated).not.toHaveBeenCalled();
    });

    it('orders the games of the draw as asked when a sort is given', async () => {
      await service.shelfPage('trending', null, { sort: 'name' }, NOW);

      expect(hubService.fetchPublishedGamesPaginated).toHaveBeenCalledWith(
        undefined,
        24,
        { ids: range(31, 42) },
        'name',
      );
    });

    it('answers an empty friends page to a reader who is signed out', async () => {
      const result = await service.shelfPage('friends', null, {}, NOW);

      expect(result).toMatchObject({ key: 'friends', kind: 'FRIENDS', total: 0, games: [] });
      expect(friendsService.friendIdsOf).not.toHaveBeenCalled();
    });

    it('refuses a key that names no shelf', async () => {
      await expect(service.shelfPage('nope', null, {}, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
