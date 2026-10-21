/**
 * Fills a local database with 80 days of synthetic analytics, up to now, so the admin panel has
 * something believable to chart: between ten and fifty people a day, posts that bring a wave of
 * visitors from their channel, sample games published along the way, accounts created and linked
 * to their browsers, projects, multiplayer rooms, and tabs that declined analytics or never
 * answered. Minute presence is computed from the same visits, so every chart agrees with the
 * others. Every value comes from a seeded generator. Re-running it replaces what it wrote, and
 * `--clear` only removes it. Either way it then finalizes every due period, as the server would.
 *
 *   npm run seed:analytics
 *   npm run seed:analytics -- --clear
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import {
  AnalyticsAnonConsent,
  AnalyticsFactType,
  AnalyticsLiveState,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { databaseUrl } from '../src/prisma/database-url';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnalyticsFinalizeService } from '../src/routes/analytics/analytics-finalize.service';
import { assertLocalDatabase } from './local-database';

const DAYS = 80;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** Every synthetic visitor, session, play and room id starts with this. */
const SEED_PREFIX = '5eed';
/** Every synthetic account has an address on this domain. */
const SEED_DOMAIN = 'analytics-seed.example.test';
const BATCH = 1_000;

const connectionString = databaseUrl();
if (!connectionString) {
  throw new ReferenceError(
    'Set DATABASE_URL, or POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB in .env',
  );
}
assertLocalDatabase(connectionString, 'seed:analytics');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** mulberry32: small, fast and seeded. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const random = generator(276);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
/** Each item repeated as many times as its weight, so `pick` draws it that often. */
const weightedList = <T>(items: readonly [T, number][]): T[] =>
  items.flatMap(([item, weight]) => Array.from({ length: weight }, () => item));
const between = (low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1));
const chance = (probability: number): boolean => random() < probability;

/** Knuth's method, fine for the small rates drawn here. */
function poisson(rate: number): number {
  const limit = Math.exp(-rate);
  let product = random();
  let count = 0;
  while (product > limit) {
    product *= random();
    count += 1;
  }
  return count;
}

function weighted<T>(items: readonly { item: T; weight: number }[]): T {
  const total = items.reduce((sum, one) => sum + one.weight, 0);
  let left = random() * total;
  for (const one of items) {
    left -= one.weight;
    if (left <= 0) {
      return one.item;
    }
  }
  return (items[items.length - 1] as { item: T }).item;
}

let counter = 0;
/** A version 4 uuid under the seed prefix; the counter in its last group keeps it unique. */
function seedUuid(): string {
  counter += 1;
  const group = (): string =>
    Math.floor(random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${SEED_PREFIX}${group()}-${group()}-4${group().slice(1)}-8${group().slice(1)}-${counter
    .toString(16)
    .padStart(12, '0')}`;
}

/** How likely a visit starts in each UTC hour: a European audience, busiest in the evening. */
const HOUR_WEIGHTS = [
  0.3, 0.2, 0.1, 0.1, 0.1, 0.15, 0.3, 0.5, 0.8, 1, 1.1, 1.2, 1.4, 1.3, 1.3, 1.4, 1.6, 1.9, 2.2, 2.4,
  2.4, 2.1, 1.5, 0.8,
].map((weight, hour) => ({ item: hour, weight }));

const DEVICES = ['desktop', 'desktop', 'desktop', 'mobile', 'mobile', 'tablet'] as const;
const BROWSERS = ['Chrome', 'Chrome', 'Firefox', 'Safari', 'Edge', 'Mobile Safari'] as const;
const OSES = ['Windows', 'Mac OS', 'Linux', 'iOS', 'Android'] as const;
const COUNTRIES = ['FR', 'FR', 'FR', 'FR', 'BE', 'CH', 'CA', 'US', 'DE', 'GB', null] as const;
const LANGUAGES = ['fr', 'fr', 'fr', 'en', 'en', 'de'] as const;
const SCREENS = ['lg', 'lg', 'xl', 'md', 'xs'] as const;
/** Where a visit with no post behind it comes from, as often as each appears here. */
const REFERRERS = weightedList([
  [null, 34],
  ['google.com', 20],
  ['bing.com', 3],
  ['duckduckgo.com', 3],
  ['reddit.com', 7],
  ['itch.io', 7],
  ['discord.com', 6],
  ['youtube.com', 5],
  ['x.com', 3],
  ['bsky.app', 2],
  ['news.ycombinator.com', 2],
  ['github.com', 3],
  ['twitch.tv', 2],
]);

interface Campaign {
  referrer: string | null;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

/** Links that always carry a campaign: the README badge and the Discord welcome message. */
const STANDING_CAMPAIGNS: Campaign[] = [
  {
    referrer: 'github.com',
    utmSource: 'github',
    utmMedium: 'readme',
    utmCampaign: 'readme-badge',
  },
  {
    referrer: 'discord.com',
    utmSource: 'discord',
    utmMedium: 'community',
    utmCampaign: 'server-welcome',
  },
];

const ROUTES = ['hub', 'play/:id', 'play/:id', 'learn', 'u/:username', 'games'] as const;

interface SampleGame {
  name: string;
  shortDesc: string;
  /** Day of the window it is published on, negative for before the window. */
  publishDay: number;
  weight: number;
}

const SAMPLE_GAMES: SampleGame[] = [
  { name: 'Orbit Run', shortDesc: 'Slingshot around planets.', publishDay: -20, weight: 3 },
  { name: 'Pixel Garden', shortDesc: 'Grow a garden, one pixel a day.', publishDay: 26, weight: 2 },
  {
    name: 'Dungeon Bell',
    shortDesc: 'Ring the bell, wake the dungeon.',
    publishDay: 39,
    weight: 2,
  },
  { name: 'Neon Drift', shortDesc: 'Drift through a neon city.', publishDay: 55, weight: 2.5 },
];

interface Post {
  /** Day of the window and UTC time it went out, or how long before the seed runs. */
  day: number;
  hour: number;
  minute?: number;
  hoursAgo?: number;
  label: string;
  channel: string;
  /** The referrer its visitors arrive with, null for a link opened from an email. */
  domain: string | null;
  url: string;
  /** The game to play, or for creators the game to fork. */
  game: string | null;
  audience: 'EVERYONE' | 'PLAYERS' | 'CREATORS';
  /** New consenting visitors it brings over the two days after it. */
  strength: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

const post = (fields: Partial<Post> & Pick<Post, 'label' | 'channel' | 'strength'>): Post => ({
  day: 0,
  hour: 0,
  domain: null,
  url: 'https://naucto.net/',
  game: null,
  audience: 'EVERYONE',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  ...fields,
});

const POSTS: Post[] = [
  post({
    day: 29,
    hour: 17,
    label: 'Pixel Garden on r/indiegaming',
    channel: 'Reddit',
    domain: 'reddit.com',
    url: 'https://www.reddit.com/r/indiegaming/',
    game: 'Pixel Garden',
    audience: 'PLAYERS',
    strength: 22,
  }),
  post({
    day: 36,
    hour: 9,
    label: 'September newsletter',
    channel: 'Newsletter',
    strength: 12,
    utmSource: 'newsletter',
    utmMedium: 'email',
    utmCampaign: 'september-newsletter',
  }),
  post({
    day: 42,
    hour: 18,
    label: 'Dungeon Bell trailer',
    channel: 'YouTube',
    domain: 'youtube.com',
    url: 'https://www.youtube.com/',
    game: 'Dungeon Bell',
    audience: 'PLAYERS',
    strength: 34,
    utmSource: 'youtube',
    utmMedium: 'video',
    utmCampaign: 'dungeon-bell-trailer',
  }),
  post({
    day: 51,
    hour: 12,
    label: 'Devlog #4: remix Orbit Run',
    channel: 'Discord',
    domain: 'discord.com',
    url: 'https://discord.com/',
    game: 'Orbit Run',
    audience: 'CREATORS',
    strength: 14,
  }),
  // A launch on three platforms within minutes: the charts draw them as one line.
  post({
    day: 58,
    hour: 19,
    label: 'Neon Drift launch clip',
    channel: 'TikTok',
    domain: 'tiktok.com',
    url: 'https://www.tiktok.com/',
    game: 'Neon Drift',
    audience: 'PLAYERS',
    strength: 22,
  }),
  post({
    day: 58,
    hour: 19,
    label: 'Neon Drift launch trailer',
    channel: 'YouTube',
    domain: 'youtube.com',
    url: 'https://www.youtube.com/',
    game: 'Neon Drift',
    audience: 'PLAYERS',
    strength: 12,
    utmSource: 'youtube',
    utmMedium: 'video',
    utmCampaign: 'neon-drift-launch',
  }),
  post({
    day: 58,
    hour: 19,
    minute: 5,
    label: 'Neon Drift launch thread',
    channel: 'X',
    domain: 'x.com',
    url: 'https://x.com/',
    game: 'Neon Drift',
    audience: 'PLAYERS',
    strength: 8,
  }),
  post({
    day: 66,
    hour: 15,
    label: 'Making a platformer in an evening',
    channel: 'Bluesky',
    domain: 'bsky.app',
    url: 'https://bsky.app/',
    audience: 'CREATORS',
    strength: 10,
  }),
  post({
    day: 72,
    hour: 16,
    label: 'Naucto on itch.io',
    channel: 'itch.io',
    domain: 'itch.io',
    url: 'https://itch.io/',
    strength: 16,
    utmSource: 'itch',
    utmMedium: 'listing',
    utmCampaign: 'itch-page',
  }),
  post({
    day: 77,
    hour: 14,
    label: 'Show HN: Naucto',
    channel: 'Hacker News',
    domain: 'news.ycombinator.com',
    url: 'https://news.ycombinator.com/',
    strength: 24,
  }),
  post({
    hoursAgo: 5,
    label: 'Live stream: building a game from scratch',
    channel: 'Twitch',
    domain: 'twitch.tv',
    url: 'https://www.twitch.tv/',
    audience: 'CREATORS',
    strength: 8,
  }),
];
/** Hours over which a post's visitors fade to a third. */
const POST_DECAY_HOURS = 8;

interface Game {
  id: number;
  name: string;
  publishedAt: Date;
  weight: number;
}

interface Visitor {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  device: string;
  browser: string;
  os: string;
  country: string | null;
  screen: string;
  language: string;
  post: Post | null;
  userId: number | null;
  linkedAt: Date | null;
  /** An account of this browser that has created a project, and published one. */
  creator: boolean;
  published: boolean;
}

interface Account {
  id: number;
  username: string;
  createdAt: Date;
}

/** One minute-by-minute record of what a session was doing, for the presence samples. */
type MinuteState = 'BROWSING' | 'PLAYING' | 'BUILDING';

function bitsFor(minutes: number[]): Uint8Array<ArrayBuffer> {
  const bits = new Uint8Array(180);
  for (const minute of minutes) {
    const byte = bits[minute >> 3] ?? 0;
    bits[minute >> 3] = byte | (1 << (minute & 7));
  }
  return bits;
}

async function inBatches<T>(rows: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    await write(rows.slice(start, start + BATCH));
  }
}

/**
 * Anonymous tallies and presence samples hold no seed mark, so every one before now goes: a local
 * database then has nothing left of an earlier run, whatever window it covered.
 */
async function clearPrevious(to: Date): Promise<void> {
  await prisma.analyticsMarker.deleteMany({
    where: { label: { in: POSTS.map((post) => post.label) } },
  });
  await prisma.$executeRaw`DELETE FROM "AnalyticsVisitor" WHERE id::text LIKE ${`${SEED_PREFIX}%`}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsAnonTally" WHERE "minute" < ${to}`;
  await prisma.$executeRaw`DELETE FROM "ConcurrencySample" WHERE "at" < ${to}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsFact" WHERE "dedupeKey" LIKE 'seed:%'`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsMpDay" WHERE "sessionId"::text LIKE ${`${SEED_PREFIX}%`}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsMpSeat" WHERE "sessionId"::text LIKE ${`${SEED_PREFIX}%`}`;
  await prisma.$executeRaw`DELETE FROM "AnalyticsMpSession" WHERE id::text LIKE ${`${SEED_PREFIX}%`}`;
  const accounts = await prisma.user.findMany({
    where: { email: { endsWith: `@${SEED_DOMAIN}` } },
    select: { id: true },
  });
  const ids = accounts.map((account) => account.id);
  if (ids.length > 0) {
    await prisma.project.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  // Periods are recomputed afterwards from what is stored.
  await prisma.analyticsRollup.deleteMany({});
  await prisma.analyticsRollupStatus.deleteMany({});
  await prisma.analyticsCohort.deleteMany({});
}

async function finalize(): Promise<number> {
  return new AnalyticsFinalizeService(prisma as unknown as PrismaService).finalizeDue(new Date());
}

async function main(): Promise<void> {
  const now = new Date(Math.floor((Date.now() - 2 * MINUTE_MS) / MINUTE_MS) * MINUTE_MS);
  const today = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  const from = new Date(today.getTime() - (DAYS - 1) * DAY_MS);
  const dayStart = (index: number): Date => new Date(from.getTime() + index * DAY_MS);
  const postAt = (one: Post): Date =>
    one.hoursAgo === undefined
      ? new Date(dayStart(one.day).getTime() + one.hour * HOUR_MS + (one.minute ?? 0) * MINUTE_MS)
      : new Date(Math.floor((now.getTime() - one.hoursAgo * HOUR_MS) / MINUTE_MS) * MINUTE_MS);
  const postDay = (one: Post): number =>
    Math.floor((postAt(one).getTime() - from.getTime()) / DAY_MS);

  await clearPrevious(now);
  if (process.argv.includes('--clear')) {
    console.log(`seed:analytics: cleared; ${String(await finalize())} periods finalized`);
    return;
  }

  // Accounts are created up front so facts and links can name them. The creator owns the sample
  // games, and the others are handed out as visitors sign up.
  const creator = await prisma.user.create({
    data: {
      email: `samples@${SEED_DOMAIN}`,
      username: 'naucto_samples',
      nickname: 'Naucto samples',
      createdAt: new Date(from.getTime() - 30 * DAY_MS),
    },
  });
  const games: Game[] = [];
  for (const sample of SAMPLE_GAMES) {
    const publishedAt = new Date(
      dayStart(sample.publishDay).getTime() + 19 * HOUR_MS + between(0, 59) * MINUTE_MS,
    );
    if (publishedAt > now) {
      continue;
    }
    const project = await prisma.project.create({
      data: {
        name: sample.name,
        shortDesc: sample.shortDesc,
        publishedName: sample.name,
        publishedShortDesc: sample.shortDesc,
        status: 'COMPLETED',
        publishedAt,
        releaseRevision: 1,
        userId: creator.id,
        createdAt: new Date(publishedAt.getTime() - 5 * DAY_MS),
      },
    });
    games.push({ id: project.id, name: sample.name, publishedAt, weight: sample.weight });
  }
  const existing = await prisma.project.findMany({
    where: { publishedAt: { not: null }, userId: { not: creator.id } },
    select: { id: true, publishedName: true, name: true },
  });
  for (const project of existing) {
    games.push({
      id: project.id,
      name: project.publishedName ?? project.name,
      publishedAt: from,
      weight: 1,
    });
  }
  const gameNamed = (name: string | null): Game | undefined =>
    games.find((game) => game.name === name);
  const gamesAt = (at: Date): Game[] => games.filter((game) => game.publishedAt <= at);
  const chooseGame = (at: Date, promoted: Game | undefined): Game | undefined => {
    const open = gamesAt(at);
    if (open.length === 0) {
      return undefined;
    }
    if (promoted && promoted.publishedAt <= at && chance(0.7)) {
      return promoted;
    }
    return weighted(open.map((game) => ({ item: game, weight: game.weight })));
  };

  let accountCount = 0;
  const accounts: Account[] = [];
  const newAccount = async (createdAt: Date): Promise<Account> => {
    accountCount += 1;
    const username = `seed_player_${String(accountCount).padStart(3, '0')}`;
    const user = await prisma.user.create({
      data: { email: `${username}@${SEED_DOMAIN}`, username, createdAt },
      select: { id: true },
    });
    const account = { id: user.id, username, createdAt };
    accounts.push(account);
    return account;
  };

  const visitors: Visitor[] = [];
  const sessions: Prisma.AnalyticsSessionCreateManyInput[] = [];
  const sessionDays: Prisma.AnalyticsSessionDayCreateManyInput[] = [];
  const pageViews: Prisma.AnalyticsPageViewCreateManyInput[] = [];
  const plays: Prisma.AnalyticsPlayCreateManyInput[] = [];
  const playDays: Prisma.AnalyticsPlayDayCreateManyInput[] = [];
  const facts: Prisma.AnalyticsFactCreateManyInput[] = [];
  const tallies = new Map<string, Prisma.AnalyticsAnonTallyCreateManyInput>();
  let factCount = 0;
  const fact = (
    type: AnalyticsFactType,
    at: Date,
    actor: number | null,
    project: number | null,
  ): void => {
    factCount += 1;
    facts.push({
      dedupeKey: `seed:${type.toLowerCase()}:${String(factCount)}`,
      at,
      type,
      actorUserId: actor,
      projectId: project,
    });
  };

  // Minute presence, indexed by minutes since the start of the window.
  const minutes = Math.floor((now.getTime() - from.getTime()) / MINUTE_MS);
  const presence = {
    browsers: new Uint16Array(minutes),
    playing: new Uint16Array(minutes),
    building: new Uint16Array(minutes),
    anonTabs: new Uint16Array(minutes),
    anonPlaying: new Uint16Array(minutes),
    accounts: new Uint16Array(minutes),
    accountsPlaying: new Uint16Array(minutes),
    accountsBuilding: new Uint16Array(minutes),
    rooms: new Uint16Array(minutes),
  };
  const minuteIndex = (at: Date): number => Math.floor((at.getTime() - from.getTime()) / MINUTE_MS);

  /** A session of a consenting browser, with its page views, plays and what happened in it. */
  const visit = async (visitor: Visitor, start: Date, firstVisit: boolean): Promise<void> => {
    const endOfDay = new Date(Math.floor(start.getTime() / DAY_MS) * DAY_MS + DAY_MS - MINUTE_MS);
    let length = chance(0.3) ? between(1, 4) : between(4, 35);
    const latest = Math.min(endOfDay.getTime(), now.getTime());
    length = Math.max(1, Math.min(length, Math.floor((latest - start.getTime()) / MINUTE_MS)));
    const end = new Date(start.getTime() + length * MINUTE_MS);
    if (start >= now) {
      return;
    }
    const states: MinuteState[] = Array.from({ length }, () => 'BROWSING');
    const views = length <= 2 || chance(0.25) ? 1 : between(2, 6);
    const sessionId = seedUuid();
    const fromPost = firstVisit && visitor.post !== null;
    const campaign = firstVisit && !fromPost && chance(0.06) ? pick(STANDING_CAMPAIGNS) : null;
    sessions.push({
      id: sessionId,
      visitorId: visitor.id,
      startedAt: start,
      lastSeenAt: end,
      closedAt: end.getTime() + 35 * MINUTE_MS < now.getTime() ? end : null,
      referrerDomain: fromPost
        ? chance(0.85)
          ? (visitor.post?.domain ?? null)
          : null
        : campaign
          ? campaign.referrer
          : firstVisit
            ? pick(REFERRERS)
            : chance(0.75)
              ? null
              : pick(REFERRERS),
      utmSource: fromPost ? (visitor.post?.utmSource ?? null) : (campaign?.utmSource ?? null),
      utmMedium: fromPost ? (visitor.post?.utmMedium ?? null) : (campaign?.utmMedium ?? null),
      utmCampaign: fromPost ? (visitor.post?.utmCampaign ?? null) : (campaign?.utmCampaign ?? null),
      device: visitor.device,
      browser: visitor.browser,
      os: visitor.os,
      country: visitor.country,
      screen: visitor.screen,
      language: visitor.language,
    });
    for (let view = 0; view < views; view++) {
      pageViews.push({
        id: seedUuid(),
        sessionId,
        occurredAt: new Date(start.getTime() + Math.floor((view * length * MINUTE_MS) / views)),
        route: view === 0 ? (fromPost && visitor.post?.game ? 'play/:id' : 'hub') : pick(ROUTES),
      });
    }

    // Plays, one after another inside the session.
    let cursor = 1;
    let sessionPlayMs = 0;
    let firstPlayEnd: number | null = null;
    const playing = views > 1 && chance(fromPost ? 0.8 : 0.65);
    while (playing && cursor < length - 1 && plays.length < 1_000_000) {
      const startedAt = new Date(start.getTime() + cursor * MINUTE_MS);
      const game = chooseGame(startedAt, gameNamed(visitor.post?.game ?? null));
      if (!game) {
        break;
      }
      const playMinutes = Math.min(length - cursor, between(1, 14));
      const activeMs = playMinutes * MINUTE_MS - between(0, 40_000);
      const playId = seedUuid();
      plays.push({
        id: playId,
        sessionId,
        releaseId: game.id,
        continued: false,
        startedAt,
        lastSeenAt: new Date(startedAt.getTime() + playMinutes * MINUTE_MS),
        activeMs: BigInt(activeMs),
        endedAt: new Date(startedAt.getTime() + playMinutes * MINUTE_MS),
        endReason: 'stopped',
      });
      playDays.push({
        playId,
        day: new Date(Math.floor(startedAt.getTime() / DAY_MS) * DAY_MS),
        activeMs: BigInt(activeMs),
      });
      sessionPlayMs += activeMs;
      for (let minute = cursor; minute < cursor + playMinutes; minute++) {
        states[minute] = 'PLAYING';
      }
      firstPlayEnd ??= cursor + playMinutes;
      cursor += playMinutes + between(0, 3);
      if (!chance(0.45)) {
        break;
      }
    }

    // An account: created here after the first play, or a browser linked to one made elsewhere.
    const forCreators = visitor.post?.audience === 'CREATORS';
    const signupChance = forCreators ? 0.3 : fromPost ? 0.12 : 0.07;
    if (visitor.userId === null && chance(firstVisit ? signupChance : 0.04)) {
      const at = new Date(start.getTime() + Math.min(length - 1, firstPlayEnd ?? 1) * MINUTE_MS);
      if (accounts.length > 5 && chance(0.15)) {
        visitor.userId = pick(accounts.slice(0, -1)).id;
      } else {
        const account = await newAccount(at);
        visitor.userId = account.id;
        fact(AnalyticsFactType.SIGNUP, at, account.id, null);
      }
      visitor.linkedAt = at;
    }
    if (
      visitor.userId !== null &&
      !visitor.creator &&
      length > 6 &&
      chance(forCreators ? 0.75 : 0.4)
    ) {
      visitor.creator = true;
      const at = new Date(
        Math.min(
          end.getTime(),
          Math.max(end.getTime() - 5 * MINUTE_MS, (visitor.linkedAt?.getTime() ?? 0) + MINUTE_MS),
        ),
      );
      // Some start from a published game rather than from nothing, most of all after a post
      // showing how to remix one.
      const promoted = forCreators ? gameNamed(visitor.post?.game ?? null) : undefined;
      const source = chance(forCreators ? 0.8 : 0.3)
        ? (promoted ?? chooseGame(at, undefined))
        : undefined;
      let projectId: number | null = null;
      if (source && source.publishedAt <= at) {
        const fork = await prisma.project.create({
          data: {
            name: `Fork of ${source.name}`,
            shortDesc: '',
            forkedFromId: source.id,
            userId: visitor.userId,
            createdAt: at,
          },
          select: { id: true },
        });
        projectId = fork.id;
      }
      fact(AnalyticsFactType.PROJECT_CREATED, at, visitor.userId, projectId);
    }
    if (visitor.creator && length > 6 && chance(0.6)) {
      for (let minute = Math.max(0, length - 6); minute < length; minute++) {
        states[minute] = 'BUILDING';
      }
      if (
        !visitor.published &&
        start.getTime() - (visitor.linkedAt?.getTime() ?? 0) > DAY_MS &&
        chance(0.2)
      ) {
        visitor.published = true;
        fact(
          AnalyticsFactType.RELEASE_PUBLISHED,
          new Date(end.getTime() - MINUTE_MS),
          visitor.userId,
          null,
        );
      }
    }

    const first = start.getUTCHours() * 60 + start.getUTCMinutes();
    const active = states.map((_, offset) => Math.min(first + offset, 1_439));
    sessionDays.push({
      sessionId,
      day: new Date(Math.floor(start.getTime() / DAY_MS) * DAY_MS),
      pageViews: views,
      activeBits: bitsFor(active),
      buildBits: bitsFor(active.filter((_, offset) => states[offset] === 'BUILDING')),
      playMs: BigInt(sessionPlayMs),
    });
    const base = minuteIndex(start);
    states.forEach((state, offset) => {
      const index = base + offset;
      if (index < 0 || index >= minutes) {
        return;
      }
      presence.browsers[index] = (presence.browsers[index] ?? 0) + 1;
      if (visitor.userId !== null) {
        presence.accounts[index] = (presence.accounts[index] ?? 0) + 1;
      }
      if (state === 'PLAYING') {
        presence.playing[index] = (presence.playing[index] ?? 0) + 1;
        if (visitor.userId !== null) {
          presence.accountsPlaying[index] = (presence.accountsPlaying[index] ?? 0) + 1;
        }
      }
      if (state === 'BUILDING') {
        presence.building[index] = (presence.building[index] ?? 0) + 1;
        if (visitor.userId !== null) {
          presence.accountsBuilding[index] = (presence.accountsBuilding[index] ?? 0) + 1;
        }
      }
    });
    if (end > visitor.lastSeenAt) {
      visitor.lastSeenAt = end;
    }
  };

  /** A tab that declined analytics or never answered, as the minute tallies its pings make. */
  const anonymousTab = (at: Date, promoted: Game | undefined): void => {
    const start = new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
    if (start >= now) {
      return;
    }
    const consent = chance(0.6) ? AnalyticsAnonConsent.DECLINED : AnalyticsAnonConsent.UNANSWERED;
    const signedIn = chance(consent === AnalyticsAnonConsent.DECLINED ? 0.2 : 0.05);
    const endOfDay = Math.floor(start.getTime() / DAY_MS) * DAY_MS + DAY_MS - MINUTE_MS;
    const length = Math.max(
      1,
      Math.min(
        between(1, 22),
        Math.floor((Math.min(endOfDay, now.getTime()) - start.getTime()) / MINUTE_MS),
      ),
    );
    const add = (
      minute: Date,
      state: AnalyticsLiveState,
      releaseId: number,
      started: boolean,
    ): void => {
      const key = `${minute.toISOString()}|${state}|${String(signedIn)}|${String(releaseId)}|${consent}`;
      const row = tallies.get(key) ?? {
        minute,
        state,
        signedIn,
        releaseId,
        consent,
        beats: 0,
        playsStarted: 0,
        playMs: 0n,
      };
      row.beats = (row.beats ?? 0) + 1;
      row.playsStarted = (row.playsStarted ?? 0) + (started ? 1 : 0);
      row.playMs = BigInt(row.playMs ?? 0) + (state === AnalyticsLiveState.PLAYING ? 60_000n : 0n);
      tallies.set(key, row);
      const index = minuteIndex(minute);
      if (index >= 0 && index < minutes) {
        presence.anonTabs[index] = (presence.anonTabs[index] ?? 0) + 1;
        if (state === AnalyticsLiveState.PLAYING) {
          presence.anonPlaying[index] = (presence.anonPlaying[index] ?? 0) + 1;
        }
        if (signedIn) {
          presence.accounts[index] = (presence.accounts[index] ?? 0) + 1;
          if (state === AnalyticsLiveState.PLAYING) {
            presence.accountsPlaying[index] = (presence.accountsPlaying[index] ?? 0) + 1;
          }
        }
      }
    };
    let offset = 0;
    while (offset < length) {
      const minute = new Date(start.getTime() + offset * MINUTE_MS);
      const game = offset > 0 && chance(0.35) ? chooseGame(minute, promoted) : undefined;
      if (!game) {
        add(minute, AnalyticsLiveState.BROWSING, 0, false);
        offset += 1;
        continue;
      }
      const playMinutes = Math.min(length - offset, between(1, 12));
      for (let step = 0; step < playMinutes; step++) {
        add(
          new Date(minute.getTime() + step * MINUTE_MS),
          AnalyticsLiveState.PLAYING,
          game.id,
          step === 0,
        );
      }
      offset += playMinutes;
    }
  };

  const atHour = (day: number, hour: number): Date =>
    new Date(
      dayStart(day).getTime() +
        hour * HOUR_MS +
        between(0, 59) * MINUTE_MS +
        between(0, 59) * 1_000,
    );

  // New consenting visitors: a slow upward trend, more at weekends, and each post's wave.
  const arrivals: { at: Date; post: Post | null }[] = [];
  for (let day = 0; day < DAYS; day++) {
    const weekday = dayStart(day).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.3 : 1;
    const expected = (10 + (8 * day) / (DAYS - 1)) * weekend * (0.8 + random() * 0.4);
    for (let one = 0; one < Math.round(expected); one++) {
      arrivals.push({ at: atHour(day, weighted(HOUR_WEIGHTS)), post: null });
    }
  }
  for (const post of POSTS) {
    const at = postAt(post);
    for (let hour = 0; hour < 48; hour++) {
      const rate = (post.strength / POST_DECAY_HOURS) * Math.exp(-hour / POST_DECAY_HOURS);
      for (let one = poisson(rate); one > 0; one--) {
        arrivals.push({
          at: new Date(at.getTime() + hour * HOUR_MS + between(0, 59) * MINUTE_MS),
          post,
        });
      }
    }
  }
  arrivals.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Each newcomer comes back a few times, each time a little less likely.
  const visits: { visitor: Visitor; at: Date; first: boolean }[] = [];
  for (const arrival of arrivals) {
    if (arrival.at >= now) {
      continue;
    }
    const visitor: Visitor = {
      id: seedUuid(),
      firstSeenAt: arrival.at,
      lastSeenAt: arrival.at,
      device: pick(DEVICES),
      browser: pick(BROWSERS),
      os: pick(OSES),
      country: pick(COUNTRIES),
      screen: pick(SCREENS),
      language: pick(LANGUAGES),
      post: arrival.post,
      userId: null,
      linkedAt: null,
      creator: false,
      published: false,
    };
    visitors.push(visitor);
    visits.push({ visitor, at: arrival.at, first: true });
    let at = arrival.at;
    let returning = arrival.post ? 0.35 : 0.45;
    while (chance(returning)) {
      const day = Math.floor((at.getTime() - from.getTime()) / DAY_MS) + between(1, 7);
      if (day >= DAYS) {
        break;
      }
      at = atHour(day, weighted(HOUR_WEIGHTS));
      visits.push({ visitor, at, first: false });
      returning *= 0.8;
    }
  }
  visits.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const one of visits) {
    await visit(one.visitor, one.at, one.first);
  }

  // Tabs that declined or never answered: about two thirds as many as consenting newcomers, with
  // the same daily rhythm and the same waves after posts.
  for (const arrival of arrivals) {
    for (let tab = chance(0.7) ? 1 : 0; tab > 0; tab--) {
      anonymousTab(
        new Date(Math.max(from.getTime(), arrival.at.getTime() + between(-20, 20) * MINUTE_MS)),
        gameNamed(arrival.post?.game ?? null),
      );
    }
  }

  // Accounts created by people who declined: never linked to a browser.
  for (let day = 0; day < DAYS; day++) {
    const wave = POSTS.filter((one) => postDay(one) === day || postDay(one) === day - 1).reduce(
      (sum, post) => sum + post.strength / 20,
      0,
    );
    for (let one = poisson(0.5 + wave); one > 0; one--) {
      const at = atHour(day, weighted(HOUR_WEIGHTS));
      if (at >= now) {
        continue;
      }
      const account = await newAccount(at);
      fact(AnalyticsFactType.SIGNUP, at, account.id, null);
      if (chance(0.3)) {
        fact(
          AnalyticsFactType.PROJECT_CREATED,
          new Date(at.getTime() + between(10, 90) * MINUTE_MS),
          account.id,
          null,
        );
      }
    }
  }

  // The sample games' own releases, and the odd update after.
  for (const game of games) {
    if (game.publishedAt <= from) {
      continue;
    }
    fact(AnalyticsFactType.RELEASE_PUBLISHED, game.publishedAt, creator.id, game.id);
    for (
      let day = Math.ceil((game.publishedAt.getTime() - from.getTime()) / DAY_MS);
      day < DAYS;
      day++
    ) {
      const at = atHour(day, 20);
      if (at < now && chance(0.08)) {
        fact(AnalyticsFactType.RELEASE_UPDATED, at, creator.id, game.id);
      }
    }
  }

  // Multiplayer rooms on the games, busier after posts.
  const roomRows: {
    session: Prisma.AnalyticsMpSessionCreateManyInput;
    seats: number;
    day: Date;
  }[] = [];
  for (let day = 0; day < DAYS; day++) {
    const wave = POSTS.filter((one) => postDay(one) === day).reduce(
      (sum, post) => sum + post.strength / 15,
      0,
    );
    for (let room = poisson(1.2 + wave); room > 0; room--) {
      const startedAt = atHour(day, weighted(HOUR_WEIGHTS));
      const game = chooseGame(startedAt, undefined);
      if (!game || startedAt >= now) {
        continue;
      }
      const seats = chance(0.65) ? between(2, 4) : 1;
      const together = seats >= 2 ? between(5, 35) : 0;
      const endedAt = new Date(startedAt.getTime() + (together + 2) * MINUTE_MS);
      roomRows.push({
        seats,
        day: dayStart(day),
        session: {
          id: seedUuid(),
          projectId: game.id,
          createdAt: startedAt,
          classifiedAt: startedAt,
          firstConnectedAt: startedAt,
          reachedMultiAt: seats >= 2 ? new Date(startedAt.getTime() + MINUTE_MS) : null,
          endedAt: endedAt < now ? endedAt : null,
          peakConnected: seats,
          multiMs: BigInt(together * MINUTE_MS),
          playerMs: BigInt(together * seats * MINUTE_MS),
        },
      });
      for (let minute = 1; minute <= together; minute++) {
        const index = minuteIndex(startedAt) + minute;
        if (index < minutes) {
          presence.rooms[index] = (presence.rooms[index] ?? 0) + 1;
        }
      }
    }
  }

  await inBatches(
    visitors.map((visitor) => ({
      id: visitor.id,
      userId: visitor.userId,
      linkedAt: visitor.linkedAt,
      firstSeenAt: visitor.firstSeenAt,
      lastSeenAt: visitor.lastSeenAt,
    })),
    (batch) => prisma.analyticsVisitor.createMany({ data: batch }),
  );
  await inBatches(sessions, (batch) => prisma.analyticsSession.createMany({ data: batch }));
  await inBatches(sessionDays, (batch) => prisma.analyticsSessionDay.createMany({ data: batch }));
  await inBatches(pageViews, (batch) => prisma.analyticsPageView.createMany({ data: batch }));
  await inBatches(plays, (batch) => prisma.analyticsPlay.createMany({ data: batch }));
  await inBatches(playDays, (batch) => prisma.analyticsPlayDay.createMany({ data: batch }));
  await inBatches([...tallies.values()], (batch) =>
    prisma.analyticsAnonTally.createMany({ data: batch, skipDuplicates: true }),
  );
  await inBatches(facts, (batch) =>
    prisma.analyticsFact.createMany({ data: batch, skipDuplicates: true }),
  );
  await inBatches(
    roomRows.map((room) => room.session),
    (batch) => prisma.analyticsMpSession.createMany({ data: batch }),
  );
  await inBatches(
    roomRows.flatMap((room) =>
      Array.from({ length: room.seats }, () => ({
        sessionId: room.session.id,
        seatToken: seedUuid(),
        firstConnectedAt: room.session.firstConnectedAt as Date,
      })),
    ),
    (batch) => prisma.analyticsMpSeat.createMany({ data: batch }),
  );
  await inBatches(
    roomRows.map((room) => ({
      sessionId: room.session.id,
      day: room.day,
      multiMs: room.session.multiMs as bigint,
      playerMs: room.session.playerMs as bigint,
    })),
    (batch) => prisma.analyticsMpDay.createMany({ data: batch }),
  );
  // Linked browsers are copied into their accounts' histories by the running backend.
  await inBatches(
    visitors
      .filter((visitor) => visitor.userId !== null)
      .map((visitor) => ({ visitorId: visitor.id, userId: visitor.userId as number })),
    (batch) => prisma.analyticsProjectionWork.createMany({ data: batch, skipDuplicates: true }),
  );

  // One presence sample a minute, from the visits above. A browser counts once, in its highest
  // state, so a room's host moves from playing to hosting.
  const samples: Prisma.ConcurrencySampleCreateManyInput[] = [];
  for (let index = 0; index < minutes; index++) {
    const playing = presence.playing[index] ?? 0;
    const hosting = Math.min(presence.rooms[index] ?? 0, playing);
    samples.push({
      at: new Date(from.getTime() + index * MINUTE_MS),
      activeBrowsers: presence.browsers[index] ?? 0,
      activeBrowsersPlaying: playing - hosting,
      activeBrowsersBuilding: presence.building[index] ?? 0,
      activeBrowsersHosting: hosting,
      anonTabs: presence.anonTabs[index] ?? 0,
      anonTabsPlaying: presence.anonPlaying[index] ?? 0,
      anonTabsBuilding: 0,
      anonTabsHosting: 0,
      accounts: presence.accounts[index] ?? 0,
      accountsPlaying: presence.accountsPlaying[index] ?? 0,
      accountsBuilding: presence.accountsBuilding[index] ?? 0,
      accountsHosting: 0,
    });
  }
  await inBatches(samples, (batch) =>
    prisma.concurrencySample.createMany({ data: batch, skipDuplicates: true }),
  );

  for (const post of POSTS) {
    const at = postAt(post);
    if (at >= now) {
      continue;
    }
    await prisma.analyticsMarker.create({
      data: {
        at,
        label: post.label,
        channel: post.channel,
        url: post.url,
        releaseId: gameNamed(post.game)?.id ?? null,
        audience: post.audience,
      },
    });
  }

  const finalized = await finalize();
  console.log(
    `seed:analytics: ${String(visitors.length)} visitors, ${String(sessions.length)} sessions, ` +
      `${String(plays.length)} plays, ${String(tallies.size)} anonymous tallies, ` +
      `${String(accounts.length)} accounts, ${String(roomRows.length)} rooms and ` +
      `${String(games.length)} games over ${String(DAYS)} days; ${String(finalized)} periods finalized`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
