import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CollectionVisibility, Prisma } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { PrismaService } from '../../prisma/prisma.service';
import { HubService } from '../project/hub.service';
import { toHubGame } from '../project/hub-fields';
import { ProjectHiddenException } from '../project/project.error';
import { CREATOR_SELECT, PUBLISHED, PUBLISHED_SQL, RELEASED } from '../project/project-select';
import { CollectionHiddenException, CollectionLimitException } from './collection.error';
import {
  COLLECTION_GAMES_MAX,
  COLLECTION_PREVIEW_GAMES,
  COLLECTIONS_PAGE_SIZE,
  COLLECTIONS_PER_USER_MAX,
} from './collection-limits';
import {
  CollectionDto,
  CollectionHeaderDto,
  CollectionPreviewDto,
  CollectionSort,
  CollectionsPageDto,
  CollectionsQueryDto,
  CreateCollectionDto,
  MyCollectionDto,
  UpdateCollectionDto,
} from './dto/collection.dto';

const WITH_OWNER = { owner: { select: CREATOR_SELECT } } satisfies Prisma.CollectionInclude;

type CollectionRow = Prisma.CollectionGetPayload<{ include: typeof WITH_OWNER }>;

type Viewer = string | null;

/** A game added twice at one position, by two requests at once, still has one place. */
export const ITEM_ORDER: Prisma.CollectionItemOrderByWithRelationInput[] = [
  { position: 'asc' },
  { addedAt: 'asc' },
  { projectId: 'asc' },
];

const NEWEST_FIRST: Prisma.CollectionOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

/** Not withheld by moderation. A collection that is withheld is read by its owner alone. */
const STANDING: Prisma.CollectionWhereInput = { hiddenAt: null };

/**
 * What the public list holds: a collection anyone may read, with a game to show. One whose games
 * all left the hub would be an empty box.
 */
const LISTED: Prisma.CollectionWhereInput = {
  ...STANDING,
  visibility: CollectionVisibility.PUBLIC,
  items: { some: { project: PUBLISHED } },
};

/** Orders of the public list, over the games of a collection that are on the hub. */
const LISTED_ORDER: Record<CollectionSort, Prisma.Sql> = {
  popular: Prisma.sql`SUM("Project"."viewCount") DESC`,
  recent: Prisma.sql`"Collection"."createdAt" DESC`,
  games: Prisma.sql`COUNT(*) DESC`,
};

/** A term typed in the search box, found in the title or the description, whatever its case. */
const matchingTerm = (term: string): Prisma.CollectionWhereInput => {
  const contains = { contains: term, mode: 'insensitive' } as const;

  return { OR: [{ title: contains }, { description: contains }] };
};

/** The twin of `matchingTerm` for the raw query; `strpos` takes the term as text, never as a pattern. */
const matchingTermSql = (term: string): Prisma.Sql =>
  Prisma.sql`AND (strpos(lower("Collection"."title"), lower(${term})) > 0
          OR strpos(lower(coalesce("Collection"."description", '')), lower(${term})) > 0)`;

const toHeader = (row: CollectionRow, gameCount: number): CollectionHeaderDto => ({
  id: row.id,
  title: row.title,
  description: row.description,
  visibility: row.visibility,
  hiddenAt: row.hiddenAt,
  owner: row.owner,
  gameCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Collections: a person's lists of games. Who reads one is decided here and nowhere else: PUBLIC
 * by anyone, UNLISTED by whoever holds its id, PRIVATE by its owner, and one moderation withholds
 * by its owner alone. A game shows in one only while it is on the hub; its row stays, so its owner
 * can see it left and remove it.
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hubService: HubService,
  ) {}

  /**
   * The collection as `viewer` may read it. A private one and a withheld one answer a stranger as
   * a gap does.
   */
  private async requireReadable(id: string, viewer: Viewer): Promise<CollectionRow> {
    const row = await this.prisma.collection.findUnique({ where: { id }, include: WITH_OWNER });
    const ownerOnly = row?.visibility === CollectionVisibility.PRIVATE || Boolean(row?.hiddenAt);

    if (!row || (ownerOnly && row.ownerId !== viewer)) {
      throw new NotFoundException(`Collection ${id} not found`);
    }

    return row;
  }

  private async requireOwned(id: string, userId: string): Promise<CollectionRow> {
    const row = await this.requireReadable(id, userId);

    if (row.ownerId !== userId) {
      throw new ForbiddenException('Only its owner changes a collection');
    }

    return row;
  }

  /**
   * Passes for a change to what the collection would show. A withheld one takes none: what a
   * restore puts back is what staff withheld. Its owner still deletes it, or removes a game from it.
   */
  private async requireChangeable(id: string, userId: string): Promise<void> {
    if ((await this.requireOwned(id, userId)).hiddenAt) {
      throw new CollectionHiddenException();
    }
  }

  private async toDetail(row: CollectionRow, viewer: Viewer): Promise<CollectionDto> {
    const items = await this.prisma.collectionItem.findMany({
      where: { collectionId: row.id },
      select: { projectId: true },
      orderBy: ITEM_ORDER,
    });
    const listed = items.map((item) => item.projectId);
    const games = (await this.hubService.fetchReleasesByIds(listed)).map(toHubGame);
    const onHub = new Set(games.map((game) => game.id));

    return {
      ...toHeader(row, games.length),
      games,
      unavailableGameIds: viewer === row.ownerId ? listed.filter((id) => !onHub.has(id)) : [],
    };
  }

  /** Each collection with the first games of it on the hub, and how many of them there are. */
  private async toPreviews(rows: CollectionRow[]): Promise<CollectionPreviewDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const items = await this.prisma.collectionItem.findMany({
      where: { collectionId: { in: rows.map((row) => row.id) }, project: PUBLISHED },
      select: { collectionId: true, projectId: true },
      orderBy: ITEM_ORDER,
    });
    const held = new Map<string, string[]>();
    for (const { collectionId, projectId } of items) {
      const games = held.get(collectionId) ?? [];
      games.push(projectId);
      held.set(collectionId, games);
    }

    const shown = (id: string): string[] => (held.get(id) ?? []).slice(0, COLLECTION_PREVIEW_GAMES);
    const releases = await this.hubService.fetchReleasesByIds([
      ...new Set(rows.flatMap((row) => shown(row.id))),
    ]);
    const games = new Map(releases.map((release) => [release.id, toHubGame(release)]));

    return rows.map((row) => ({
      ...toHeader(row, held.get(row.id)?.length ?? 0),
      games: shown(row.id).flatMap((id) => games.get(id) ?? []),
    }));
  }

  async create(ownerId: string, dto: CreateCollectionDto): Promise<CollectionDto> {
    if ((await this.prisma.collection.count({ where: { ownerId } })) >= COLLECTIONS_PER_USER_MAX) {
      throw new CollectionLimitException('COLLECTIONS_LIMIT');
    }

    const row = await this.prisma.collection.create({
      data: {
        ownerId,
        title: dto.title,
        description: dto.description || null,
        ...(dto.visibility ? { visibility: dto.visibility } : {}),
      },
      include: WITH_OWNER,
    });

    return { ...toHeader(row, 0), games: [], unavailableGameIds: [] };
  }

  async findOne(id: string, viewer: Viewer): Promise<CollectionDto> {
    return this.toDetail(await this.requireReadable(id, viewer), viewer);
  }

  async update(id: string, userId: string, dto: UpdateCollectionDto): Promise<CollectionDto> {
    await this.requireChangeable(id, userId);

    const row = await this.prisma.collection.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.description === undefined ? {} : { description: dto.description || null }),
        ...(dto.visibility ? { visibility: dto.visibility } : {}),
      },
      include: WITH_OWNER,
    });

    return this.toDetail(row, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.requireOwned(id, userId);
    await this.prisma.collection.delete({ where: { id } });
  }

  /** Lists a game of the hub last; a game already listed keeps its place. */
  async addGame(id: string, userId: string, projectId: string): Promise<void> {
    await this.requireChangeable(id, userId);
    if ((await this.prisma.project.count({ where: { id: projectId, ...PUBLISHED } })) === 0) {
      // Said only to who works on the game: to anyone else a withheld game reads as a gap here.
      const ownWithheld = await this.prisma.project.count({
        where: {
          id: projectId,
          ...RELEASED,
          hiddenAt: { not: null },
          collaborators: { some: { id: userId } },
        },
      });

      throw ownWithheld > 0
        ? new ProjectHiddenException()
        : new NotFoundException(`Published project with ID ${projectId} not found`);
    }

    const items = await this.prisma.collectionItem.findMany({
      where: { collectionId: id },
      select: { projectId: true, position: true },
    });
    if (items.some((item) => item.projectId === projectId)) {
      return;
    }
    if (items.length >= COLLECTION_GAMES_MAX) {
      throw new CollectionLimitException('COLLECTION_GAMES_LIMIT');
    }

    const position = Math.max(-1, ...items.map((item) => item.position)) + 1;
    await this.prisma.$transaction([
      this.prisma.collectionItem.createMany({
        data: [{ collectionId: id, projectId, position }],
        skipDuplicates: true,
      }),
      this.prisma.collection.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
  }

  /**
   * Works on a game that left the hub too: that is how its owner clears it. Works on a withheld
   * collection as well, where it can only take away from what staff withheld.
   */
  async removeGame(id: string, userId: string, projectId: string): Promise<void> {
    await this.requireOwned(id, userId);
    await this.prisma.$transaction([
      this.prisma.collectionItem.deleteMany({ where: { collectionId: id, projectId } }),
      this.prisma.collection.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
  }

  /**
   * Puts the games named first, in that order. A game the caller did not name (one that left the
   * hub, one added meanwhile from another tab) follows them in the order it had.
   */
  async reorder(id: string, userId: string, projectIds: string[]): Promise<void> {
    await this.requireChangeable(id, userId);

    const items = await this.prisma.collectionItem.findMany({
      where: { collectionId: id },
      select: { projectId: true },
      orderBy: ITEM_ORDER,
    });
    const listed = new Set(items.map((item) => item.projectId));
    const stranger = projectIds.find((projectId) => !listed.has(projectId));
    if (stranger !== undefined) {
      throw new BadRequestException(`Project ${stranger} is not in collection ${id}`);
    }

    const named = new Set(projectIds);
    const order = [...projectIds, ...[...listed].filter((projectId) => !named.has(projectId))];
    await this.prisma.$transaction([
      ...order.map((projectId, position) =>
        this.prisma.collectionItem.update({
          where: { collectionId_projectId: { collectionId: id, projectId } },
          data: { position },
        }),
      ),
      this.prisma.collection.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
  }

  /** A person's own collections, newest first, each saying whether it lists `projectId`. */
  async listMine(userId: string, projectId?: string): Promise<MyCollectionDto[]> {
    const previews = await this.toPreviews(
      await this.prisma.collection.findMany({
        where: { ownerId: userId },
        include: WITH_OWNER,
        orderBy: NEWEST_FIRST,
      }),
    );
    if (projectId === undefined) {
      return previews;
    }

    const holding = new Set(
      (
        await this.prisma.collectionItem.findMany({
          where: { projectId, collection: { ownerId: userId } },
          select: { collectionId: true },
        })
      ).map((item) => item.collectionId),
    );

    return previews.map((preview) => ({ ...preview, contains: holding.has(preview.id) }));
  }

  /** What a profile shows of a person's collections: the public ones, empty ones included. */
  async listPublicOf(ownerId: string): Promise<CollectionPreviewDto[]> {
    return this.toPreviews(
      await this.prisma.collection.findMany({
        where: { ...STANDING, ownerId, visibility: CollectionVisibility.PUBLIC },
        include: WITH_OWNER,
        orderBy: NEWEST_FIRST,
      }),
    );
  }

  /** The collections of the public list among `ids`, in the order given. */
  async listedByIds(ids: string[]): Promise<CollectionPreviewDto[]> {
    const rows = await this.prisma.collection.findMany({
      where: { id: { in: ids }, ...LISTED },
      include: WITH_OWNER,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    return this.toPreviews(ids.flatMap((id) => byId.get(id) ?? []));
  }

  async listPublic(query: CollectionsQueryDto): Promise<CollectionsPageDto> {
    const window = pageWindow(query.page, query.limit, COLLECTIONS_PAGE_SIZE);
    const term = query.search?.trim();
    const [total, page] = await Promise.all([
      this.prisma.collection.count({ where: term ? { ...LISTED, ...matchingTerm(term) } : LISTED }),
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "Collection"."id"
        FROM "Collection"
        JOIN "CollectionItem" ON "CollectionItem"."collectionId" = "Collection"."id"
        JOIN "Project" ON "Project"."id" = "CollectionItem"."projectId" AND ${PUBLISHED_SQL}
        WHERE "Collection"."visibility" = 'PUBLIC' AND "Collection"."hiddenAt" IS NULL
        ${term ? matchingTermSql(term) : Prisma.empty}
        GROUP BY "Collection"."id"
        ORDER BY ${LISTED_ORDER[query.sort ?? 'popular']}, "Collection"."id"
        LIMIT ${window.take} OFFSET ${window.skip}`,
    ]);

    return {
      collections: await this.listedByIds(page.map((row) => row.id)),
      total,
      page: window.page,
      limit: window.limit,
    };
  }

  /** Every collection of the public list, with the games of it that are on the hub. */
  async listedWithGames(): Promise<{ id: string; ownerId: string; games: string[] }[]> {
    const rows = await this.prisma.collection.findMany({
      where: LISTED,
      select: {
        id: true,
        ownerId: true,
        items: { where: { project: PUBLISHED }, select: { projectId: true } },
      },
    });

    return rows.map(({ id, ownerId, items }) => ({
      id,
      ownerId,
      games: items.map((item) => item.projectId),
    }));
  }
}
