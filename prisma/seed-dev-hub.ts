/**
 * Gives the hub something to rank on a local database: views, likes and comments on the published
 * games, spread over the last thirty days, and a play history for the seeded people, so the
 * shelves differ from one another and the personal slots have a reason to show. Every value comes
 * from a seeded draw, so two runs on the same day write the same thing. Re-running it replaces
 * what it wrote, and has the hub of the day drawn again. Run by `seed:dev`.
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { keepEditTime } from '../src/routes/project/keep-edit-time';
import { PUBLISHED } from '../src/routes/project/project-select';
import { draw } from '../src/routes/recommendations/hub-scoring';

const DAYS = 30;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Every synthetic viewer key starts with this; a real one is an account id or a hash. */
const VIEWER_PREFIX = 'seed:';

/** A seeded comment is one of these, written by one of the seeded people. */
const COMMENTS = [
  'Could not stop at one run.',
  'The last level is brutal. I love it.',
  'Great feel on the controls.',
  'Played this with my brother all evening.',
  'How did you fit that in so little code?',
  'More levels please!',
  'The music is stuck in my head now.',
  'Found a shortcut on the second screen.',
];

interface SignalPlan {
  /** Distinct viewers on each of the days before today, `daysAgo` from 1. */
  views: { daysAgo: number; viewers: number }[];
  likes: { userId: number; daysAgo: number }[];
  comments: { authorId: number; content: string; daysAgo: number }[];
  /** Who played it lately, for the play history of an account. */
  plays: { userId: number; daysAgo: number; minutes: number }[];
}

/**
 * What one game gets. Its own draw decides how much it is played and whether that is rising or
 * fading, so some games trend, some are only popular and some are neither.
 */
export function planSignals(gameId: number, ownerId: number, people: number[]): SignalPlan {
  const roll = (what: string): number => draw('seed-dev-hub', `${gameId}:${what}`);
  const others = people.filter((userId) => userId !== ownerId);
  const heat = 0.3 + 2.7 * roll('heat');
  const rising = roll('trend') > 0.5;
  const daysAgo = (what: string, span = DAYS): number => 1 + Math.floor(roll(what) * span);

  return {
    views: Array.from({ length: DAYS }, (_, index) => index + 1)
      .map((day) => ({
        daysAgo: day,
        viewers: Math.round(
          heat * 9 * 0.88 ** (rising ? day - 1 : DAYS - day) * (0.5 + roll(`views:${day}`)),
        ),
      }))
      .filter((day) => day.viewers > 0),
    likes: others
      .filter((userId) => roll(`likes:${userId}`) < Math.min(0.9, 0.3 * heat))
      .map((userId) => ({ userId, daysAgo: daysAgo(`liked:${userId}`) })),
    comments:
      others.length === 0
        ? []
        : Array.from({ length: Math.round(heat * 2 * roll('comments')) }, (_, index) => ({
            authorId: others[Math.floor(roll(`author:${index}`) * others.length)] as number,
            content: COMMENTS[(gameId + index) % COMMENTS.length] as string,
            daysAgo: daysAgo(`commented:${index}`),
          })),
    plays: people
      .filter((userId) => roll(`plays:${userId}`) < 0.3)
      .map((userId) => ({
        userId,
        // Within the two weeks "your friends play" looks back on.
        daysAgo: daysAgo(`played:${userId}`, 13),
        minutes: 5 + Math.floor(roll(`minutes:${userId}`) * 40),
      })),
  };
}

/** The synthetic browser a seeded person's play history is filed under. */
const seedVisitor = (userId: number): string =>
  `5eedf00d-0000-4000-8000-${userId.toString(16).padStart(12, '0')}`;

/** Views and distinct viewers the seed holds on each game. */
async function seededViews(
  prisma: PrismaClient,
): Promise<Map<number, { views: number; players: number }>> {
  const perViewer = await prisma.releaseView.groupBy({
    by: ['projectId', 'viewerKey'],
    where: { viewerKey: { startsWith: VIEWER_PREFIX } },
    _count: { _all: true },
  });

  const tally = new Map<number, { views: number; players: number }>();
  for (const row of perViewer) {
    const game = tally.get(row.projectId) ?? { views: 0, players: 0 };
    tally.set(row.projectId, { views: game.views + row._count._all, players: game.players + 1 });
  }
  return tally;
}

/** Writes the signals and answers what it wrote, in one line. */
export async function seedHubSignals(
  prisma: PrismaClient,
  people: number[],
  now = new Date(),
): Promise<string> {
  const games = await prisma.project.findMany({
    where: PUBLISHED,
    select: { id: true, userId: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  if (games.length === 0) {
    return 'no published game yet, so nothing to rank — run seed:content, then this again';
  }

  const today = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const dayOf = (daysAgo: number): Date => new Date(today.getTime() - daysAgo * DAY_MS);
  // Noon, so a timestamp falls on its day whatever is done with it.
  const noonOf = (daysAgo: number): Date => new Date(dayOf(daysAgo).getTime() + DAY_MS / 2);
  const plans = games.map((game) => ({ game, plan: planSignals(game.id, game.userId, people) }));

  const viewsBefore = await seededViews(prisma);
  await prisma.releaseView.deleteMany({ where: { viewerKey: { startsWith: VIEWER_PREFIX } } });
  await prisma.releaseView.createMany({
    data: plans.flatMap(({ game, plan }) =>
      plan.views.flatMap(({ daysAgo, viewers }) =>
        Array.from({ length: viewers }, (_, viewer) => ({
          projectId: game.id,
          viewerKey: `${VIEWER_PREFIX}${String(viewer)}`,
          day: dayOf(daysAgo),
          createdAt: noonOf(daysAgo),
        })),
      ),
    ),
  });
  const viewsAfter = await seededViews(prisma);

  for (const { game, plan } of plans) {
    for (const like of plan.likes) {
      const at = { createdAt: noonOf(like.daysAgo) };
      await prisma.like.upsert({
        where: { userId_projectId: { userId: like.userId, projectId: game.id } },
        update: at,
        create: { userId: like.userId, projectId: game.id, ...at },
      });
    }
  }

  await prisma.comment.deleteMany({
    where: { authorId: { in: people }, content: { in: COMMENTS } },
  });
  await prisma.comment.createMany({
    data: plans.flatMap(({ game, plan }) =>
      plan.comments.map(({ authorId, content, daysAgo }) => ({
        projectId: game.id,
        authorId,
        content,
        createdAt: noonOf(daysAgo),
      })),
    ),
  });

  await prisma.analyticsUserDaily.deleteMany({
    where: { visitorId: { in: people.map(seedVisitor) } },
  });
  await prisma.analyticsUserDaily.createMany({
    data: plans.flatMap(({ game, plan }) =>
      plan.plays.map(
        ({ userId, daysAgo, minutes }): Prisma.AnalyticsUserDailyCreateManyInput => ({
          userId,
          visitorId: seedVisitor(userId),
          day: dayOf(daysAgo),
          releaseId: game.id,
          plays: 1,
          activeMs: BigInt(minutes * MINUTE_MS),
          activeMinutes: minutes,
        }),
      ),
    ),
  });

  // The counters follow the rows, as they do when a real view or like lands.
  const likes = new Map(
    (await prisma.like.groupBy({ by: ['projectId'], _count: { _all: true } })).map((row) => [
      row.projectId,
      row._count._all,
    ]),
  );
  for (const { game } of plans) {
    const before = viewsBefore.get(game.id) ?? { views: 0, players: 0 };
    const after = viewsAfter.get(game.id) ?? { views: 0, players: 0 };
    await prisma.project.update({
      where: { id: game.id },
      data: {
        viewCount: { increment: after.views - before.views },
        uniquePlayers: { increment: after.players - before.players },
        likes: likes.get(game.id) ?? 0,
        ...keepEditTime(game),
      },
    });
  }

  // The hub of the day was drawn before these signals; without its row it is drawn again.
  await prisma.hubSnapshot.deleteMany({ where: { day: today } });

  const written = (pick: (plan: SignalPlan) => unknown[]): string =>
    String(plans.reduce((sum, { plan }) => sum + pick(plan).length, 0));
  const views = [...viewsAfter.values()].reduce((sum, game) => sum + game.views, 0);
  return (
    `${String(games.length)} games to rank on ${String(views)} views, ` +
    `${written((plan) => plan.likes)} likes, ${written((plan) => plan.comments)} comments ` +
    `and ${written((plan) => plan.plays)} days of play history`
  );
}
