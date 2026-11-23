import { BadRequestException, Injectable } from '@nestjs/common';

import { pageWindow } from '../../common/page-window';
import { PresenceService } from '../../presence/presence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { HubGameDto } from '../project/dto/hub-game.dto';
import { HubService } from '../project/hub.service';
import { toHubGame } from '../project/hub-fields';
import {
  HubHeroSlotDto,
  HubResponseDto,
  HubShelfDto,
  HubShelfPageDto,
  HubShelfPageQueryDto,
} from './dto/hub.dto';
import { HUB_SHELF_SIZE } from './hub-limits';
import { formatShelfKey, HubShelfKey, parseShelfKey } from './hub-shelf-key';
import { HubSnapshotPayload, ShelfPool } from './hub-snapshot';
import { HubSnapshotService } from './hub-snapshot.service';
import { RecommendationsService } from './recommendations.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back a friend's play still puts a game on "your friends play". */
const FRIENDS_WINDOW_DAYS = 14;

/** How far back the reader's own plays are read for "because you played". */
const OWN_PLAYS_WINDOW_DAYS = 30;

/** New and rising games read for the hero: enough for its slots not to repeat a game. */
const HERO_RISING_DEPTH = 8;

type Viewer = number | null;

type FriendsGame = { id: number; live: boolean; friends: number; activeMs: bigint };

type HeroSource = Pick<HubHeroSlotDto, 'reason' | 'reasonGame'> & { games: HubGameDto[] };

function shelfHead(key: HubShelfKey): Pick<HubShelfDto, 'key' | 'kind' | 'tag'> {
  return {
    key: formatShelfKey(key),
    kind: key.kind,
    ...(key.kind === 'TAG' ? { tag: key.tag } : {}),
  };
}

/**
 * The hub as one reader gets it: the snapshot of the day, and over it what only this reader is
 * shown. Everything personal is read when asked and from two places only: the play history an
 * account has because its browser consented to analytics, and what friends already see of each
 * other live. An account without that history gets the slots anyone gets.
 */
@Injectable()
export class HubFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: HubSnapshotService,
    private readonly hubService: HubService,
    private readonly recommendations: RecommendationsService,
    private readonly friendsService: FriendsService,
    private readonly presence: PresenceService,
  ) {}

  private requireKey(raw: string): HubShelfKey {
    const key = parseShelfKey(raw);
    if (!key) {
      throw new BadRequestException(`"${raw}" names no shelf`);
    }

    return key;
  }

  private async gamesById(ids: number[]): Promise<Map<number, HubGameDto>> {
    const releases = await this.hubService.fetchReleasesByIds([...new Set(ids)]);

    return new Map(releases.map((release) => [release.id, toHubGame(release)]));
  }

  /**
   * Games the reader's friends are in right now, then those they played lately: the more friends
   * on a game, the earlier it comes.
   */
  private async friendsPool(userId: number, now: Date): Promise<ShelfPool> {
    const friendIds = await this.friendsService.friendIdsOf(userId);
    if (friendIds.length === 0) {
      return { total: 0, games: [] };
    }

    const played = await this.prisma.analyticsUserDaily.groupBy({
      by: ['releaseId', 'userId'],
      where: {
        userId: { in: friendIds },
        releaseId: { not: 0 },
        day: { gte: new Date(now.getTime() - FRIENDS_WINDOW_DAYS * DAY_MS) },
      },
      _sum: { activeMs: true },
    });

    const ranked = new Map<number, FriendsGame>();
    const entry = (id: number): FriendsGame => {
      const game = ranked.get(id) ?? { id, live: false, friends: 0, activeMs: 0n };
      ranked.set(id, game);
      return game;
    };
    for (const row of played) {
      const game = entry(row.releaseId);
      game.friends += 1;
      game.activeMs += row._sum.activeMs ?? 0n;
    }
    for (const friendId of friendIds) {
      const releaseId = this.presence.get(friendId)?.releaseId;
      if (releaseId) {
        entry(releaseId).live = true;
      }
    }

    const games = [...ranked.values()]
      .sort(
        (a, b) =>
          Number(b.live) - Number(a.live) ||
          b.friends - a.friends ||
          Number(b.activeMs - a.activeMs) ||
          a.id - b.id,
      )
      .map((game) => game.id);

    return { total: games.length, games };
  }

  /** The games a shelf holds today for this reader; none for a shelf the day does not have. */
  private async pool(
    key: HubShelfKey,
    payload: HubSnapshotPayload,
    viewer: Viewer,
    now: Date,
  ): Promise<ShelfPool> {
    switch (key.kind) {
      case 'POPULAR':
        return payload.popular;
      case 'TRENDING':
        return payload.trending;
      case 'FRIENDS':
        return viewer === null ? { total: 0, games: [] } : this.friendsPool(viewer, now);
      case 'TAG':
        return payload.tags.find((shelf) => shelf.tag === key.tag) ?? { total: 0, games: [] };
    }
  }

  /** The first page of a shelf, or nothing when no game of it is on the hub any more. */
  private toShelf(
    key: HubShelfKey,
    pool: ShelfPool,
    games: Map<number, HubGameDto>,
  ): HubShelfDto[] {
    const shown = pool.games.slice(0, HUB_SHELF_SIZE).flatMap((id) => games.get(id) ?? []);
    if (shown.length === 0) {
      return [];
    }

    return [{ ...shelfHead(key), total: pool.total, games: shown }];
  }

  /**
   * The game this reader played most over the last weeks, and the trending games carrying one of
   * its tags that they never opened; null for a reader without a play history.
   */
  private async becauseYouPlayed(
    userId: number,
    trending: HubGameDto[],
    now: Date,
  ): Promise<HeroSource | null> {
    const [most] = await this.prisma.analyticsUserDaily.groupBy({
      by: ['releaseId'],
      where: {
        userId,
        releaseId: { not: 0 },
        day: { gte: new Date(now.getTime() - OWN_PLAYS_WINDOW_DAYS * DAY_MS) },
      },
      _sum: { activeMs: true },
      orderBy: [{ _sum: { activeMs: 'desc' } }, { releaseId: 'asc' }],
      take: 1,
    });
    const [source] = most ? await this.hubService.fetchReleasesByIds([most.releaseId]) : [];
    if (!source) {
      return null;
    }

    const opened = new Set(
      (
        await this.prisma.analyticsUserDaily.findMany({
          where: { userId, releaseId: { not: 0 } },
          distinct: ['releaseId'],
          select: { releaseId: true },
        })
      ).map((row) => row.releaseId),
    );

    return {
      reason: 'BECAUSE_YOU_PLAYED',
      reasonGame: { id: source.id, name: source.name },
      games: trending.filter(
        (game) => !opened.has(game.id) && game.tags.some((tag) => source.tags.includes(tag)),
      ),
    };
  }

  async feed(viewer: Viewer, now = new Date()): Promise<HubResponseDto> {
    const { day, payload } = await this.snapshots.today(now);
    const [featured, lastEdited, friends] = await Promise.all([
      this.recommendations.getCurrent(),
      viewer === null ? null : this.hubService.fetchLastEdited(viewer),
      this.pool({ kind: 'FRIENDS' }, payload, viewer, now),
    ]);
    const games = await this.gamesById([
      ...payload.popular.games.slice(0, HUB_SHELF_SIZE),
      ...payload.trending.games,
      ...payload.rising.slice(0, HERO_RISING_DEPTH),
      ...friends.games.slice(0, HUB_SHELF_SIZE),
    ]);
    const listed = (ids: number[]): HubGameDto[] => ids.flatMap((id) => games.get(id) ?? []);

    const trending: HeroSource = { reason: 'TRENDING', games: listed(payload.trending.games) };
    const rising: HeroSource = { reason: 'NEW_AND_RISING', games: listed(payload.rising) };
    const because =
      viewer === null ? null : await this.becauseYouPlayed(viewer, trending.games, now);

    // Each slot takes the first game no earlier slot took, from the first of its sources with one.
    const slots: HeroSource[][] = [
      [
        { reason: 'GAME_OF_THE_WEEK', games: featured ? [toHubGame(featured.project)] : [] },
        trending,
        rising,
      ],
      [{ reason: 'CONTINUE', games: lastEdited ? [toHubGame(lastEdited)] : [] }, trending, rising],
      [trending, rising],
      [
        { reason: 'FRIENDS_PLAY', games: listed(friends.games) },
        ...(because ? [because] : []),
        rising,
        trending,
      ],
    ];
    const taken = new Set<number>();
    const hero = slots.flatMap((sources): HubHeroSlotDto[] => {
      for (const { reason, reasonGame, games: candidates } of sources) {
        const game = candidates.find((candidate) => !taken.has(candidate.id));
        if (game) {
          taken.add(game.id);
          return [{ reason, ...(reasonGame ? { reasonGame } : {}), game }];
        }
      }
      return [];
    });

    return {
      day,
      hero,
      shelves: [
        ...this.toShelf({ kind: 'POPULAR' }, payload.popular, games),
        ...this.toShelf({ kind: 'FRIENDS' }, friends, games),
        ...this.toShelf({ kind: 'TRENDING' }, payload.trending, games),
      ],
      more: payload.tags.map(({ tag }) => formatShelfKey({ kind: 'TAG', tag })),
    };
  }

  /** The shelves `rawKeys` name, in that order, for a page that fetches them as it scrolls. */
  async shelves(rawKeys: string[], viewer: Viewer, now = new Date()): Promise<HubShelfDto[]> {
    const keys = rawKeys.map((raw) => this.requireKey(raw));
    const { payload } = await this.snapshots.today(now);
    const asked = await Promise.all(
      keys.map(async (key) => ({ key, pool: await this.pool(key, payload, viewer, now) })),
    );
    const games = await this.gamesById(
      asked.flatMap(({ pool }) => pool.games.slice(0, HUB_SHELF_SIZE)),
    );

    return asked.flatMap(({ key, pool }) => this.toShelf(key, pool, games));
  }

  /**
   * One page of a shelf's "see all". Without a sort, a shelf drawn for the day keeps that order;
   * a shelf that lists a whole part of the catalogue (every game, a tag) is paged from the
   * catalogue itself, the most played first.
   */
  async shelfPage(
    rawKey: string,
    viewer: Viewer,
    query: HubShelfPageQueryDto,
    now = new Date(),
  ): Promise<HubShelfPageDto> {
    const key = this.requireKey(rawKey);
    const shelf = shelfHead(key);
    const drawn =
      key.kind === 'POPULAR' || key.kind === 'TAG'
        ? null
        : await this.pool(key, (await this.snapshots.today(now)).payload, viewer, now);

    if (drawn && !query.sort) {
      const window = pageWindow(query.page, query.limit, HUB_SHELF_SIZE);
      const releases = await this.hubService.fetchReleasesByIds(
        drawn.games.slice(window.skip, window.skip + window.take),
      );

      return {
        ...shelf,
        total: drawn.total,
        page: window.page,
        limit: window.limit,
        games: releases.map(toHubGame),
      };
    }

    const page = await this.hubService.fetchPublishedGamesPaginated(
      query.page,
      query.limit ?? HUB_SHELF_SIZE,
      drawn ? { ids: drawn.games } : key.kind === 'TAG' ? { tags: [key.tag] } : {},
      query.sort ?? 'popular',
    );

    return {
      ...shelf,
      total: page.total,
      page: page.page,
      limit: page.limit,
      games: page.projects.map(toHubGame),
    };
  }
}
