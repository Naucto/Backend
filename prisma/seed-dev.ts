/**
 * Development seed: people, friendships, pending requests and shared game sessions, so the lists
 * and panels that stay hidden on an empty database have rows to draw.
 *
 * Games are seeded separately, by `npm run seed:content` in the Frontend: their content is a Yjs
 * document only the engine can build.
 *
 * Safe to re-run: every row is matched on a key and updated in place, never duplicated.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { getOptionalEnv } from '../src/config/env';
import { databaseUrl } from '../src/prisma/database-url';

const connectionString = databaseUrl();
if (!connectionString) {
  throw new ReferenceError(
    'Set DATABASE_URL, or POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB in .env',
  );
}
// Prisma 7 takes the driver adapter, the same way PrismaService does.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Everyone shares one password locally; this script refuses to run anywhere but a local database. */
const DEV_PASSWORD = 'Naucto!dev1';

interface SeedUser {
  username: string;
  nickname?: string;
  description?: string;
  friendCode: string;
}

/**
 * Names are the design's own cast, so a screenshot lines up with the artboard. The ids they land on
 * drive the identity colour, which is why the order matters and the list is not alphabetical.
 */
const USERS: SeedUser[] = [
  {
    username: 'alexis',
    description: 'Building the console the console deserves.',
    friendCode: 'A1EX1S01',
  },
  {
    username: 'louis',
    description: 'I love making games',
    friendCode: '10V1S002',
  },
  {
    username: 'edgar',
    description: 'Ferries, mostly.',
    friendCode: 'EDGAR003',
  },
  {
    username: 'thea',
    nickname: 'théodore',
    description: 'Moon lander enthusiast.',
    friendCode: 'THEA0004',
  },
  {
    username: 'ulysse',
    description: 'Snake, but eight-bit.',
    friendCode: 'V1YSSE05',
  },
  { username: 'vincent', friendCode: 'V1NCEN06' },
  { username: 'marie', friendCode: 'MAR1E007' },
  { username: 'julien', description: 'New here.', friendCode: 'JV11EN08' },
  { username: 'kenza', friendCode: 'KENZA009' },
  { username: 'sacha', friendCode: 'SACHA010' },
];

const FRIENDS_OF_ALEXIS = ['louis', 'edgar', 'thea', 'ulysse', 'vincent', 'marie'];
/** Left pending on purpose: the REQUESTS panel is unreachable without one. */
const PENDING_TO_ALEXIS = ['julien', 'kenza'];

/**
 * `sacha` is deliberately not a friend: the one case where the recent-players list offers to add
 * someone. Times are hours before the run rather than dates, so every run lands them inside the
 * recent-players window.
 */
const SHARED_SESSIONS: {
  with: string;
  hoursAgo: number;
  players: number;
  /** Must match a project name from the Frontend's `tools/seed-content.ts` exactly, or the session is skipped (with a warning). */
  game: string;
  /**
   * True when the other person hosted: the recent-players lookup matches the caller as host or
   * as player, and each side needs a row.
   */
  hostedByThem?: boolean;
}[] = [
  {
    with: 'ulysse',
    hoursAgo: 3,
    players: 2,
    game: 'Snake 8-bit',
    hostedByThem: true,
  },
  { with: 'sacha', hoursAgo: 27, players: 4, game: 'Duel' },
  { with: 'louis', hoursAgo: 76, players: 2, game: 'Moon Lander' },
  {
    with: 'thea',
    hoursAgo: 199,
    players: 3,
    game: 'Ferry Click',
    hostedByThem: true,
  },
];

function assertLocalDatabase(url: string): void {
  // A deployment reaches its database under a compose service name too, so the host alone does
  // not tell it apart from a laptop.
  if (getOptionalEnv('NODE_ENV') === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production.');
  }

  const host = URL.canParse(url) ? new URL(url).hostname : '';
  const local = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'];
  if (!local.includes(host)) {
    throw new Error(
      `seed:dev refuses to touch a non-local database (host "${host}"). ` +
        'It writes fixed passwords and fake people; that belongs on a laptop, nowhere else.',
    );
  }
}

async function seedUsers(): Promise<Map<string, number>> {
  const password = await bcrypt.hash(DEV_PASSWORD, 10);
  const ids = new Map<string, number>();
  for (const user of USERS) {
    const row = await prisma.user.upsert({
      where: { email: `${user.username}@naucto.local` },
      update: {
        nickname: user.nickname ?? null,
        description: user.description ?? null,
        friendCode: user.friendCode,
        // Reset on every run, so the documented password also works on a row that predates this seed.
        password,
      },
      create: {
        email: `${user.username}@naucto.local`,
        username: user.username,
        nickname: user.nickname ?? null,
        description: user.description ?? null,
        friendCode: user.friendCode,
        password,
      },
      select: { id: true },
    });
    ids.set(user.username, row.id);
  }
  return ids;
}

async function seedSocialGraph(ids: Map<string, number>, alexis: number): Promise<void> {
  for (const name of FRIENDS_OF_ALEXIS) {
    const other = ids.get(name);
    if (other === undefined) {
      continue;
    }
    // FriendsService stores the pair with userAId < userBId; match that or lookups miss.
    const [userAId, userBId] = alexis < other ? [alexis, other] : [other, alexis];
    await prisma.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId },
    });
  }

  for (const name of PENDING_TO_ALEXIS) {
    const from = ids.get(name);
    if (from === undefined) {
      continue;
    }
    await prisma.friendRequest.upsert({
      where: { fromId_toId: { fromId: from, toId: alexis } },
      update: {},
      create: { fromId: from, toId: alexis },
    });
  }
}

/**
 * Returns null while no game exists: games come from the Frontend's `npm run seed:content`, so a
 * first run has nothing to attach a session to.
 *
 * `GameSession` has no natural key, so (host, project, guest) identifies a seeded session and a
 * re-run refreshes its times instead of inserting a duplicate.
 */
async function seedGameSessions(
  ids: Map<string, number>,
  alexis: number,
): Promise<{ total: number; made: number } | null> {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });
  if (projects.length === 0) {
    return null;
  }
  const byName = new Map(projects.map((project) => [project.name, project]));

  let made = 0;
  for (const session of SHARED_SESSIONS) {
    const other = ids.get(session.with);
    const project = byName.get(session.game);
    if (project === undefined) {
      console.warn(`seed:dev: no project named "${session.game}", skipping its shared session`);
      continue;
    }
    if (other === undefined) {
      continue;
    }

    const [hostId, guestId] = session.hostedByThem ? [other, alexis] : [alexis, other];
    const startedAt = new Date(Date.now() - session.hoursAgo * 60 * 60 * 1000);

    // Every one of these is over; a row with no endedAt reads as a session still running.
    const endedAt = new Date(startedAt.getTime() + 45 * 60 * 1000);

    const existing = await prisma.gameSession.findFirst({
      where: {
        hostId,
        projectId: project.id,
        otherUsers: { some: { id: guestId } },
      },
      select: { id: true },
    });

    if (existing !== null) {
      await prisma.gameSession.update({
        where: { id: existing.id },
        data: {
          startedAt,
          endedAt,
          title: project.name,
          maxPlayers: session.players,
        },
      });
      continue;
    }

    await prisma.gameSession.create({
      data: {
        hostId,
        projectId: project.id,
        title: project.name,
        maxPlayers: session.players,
        startedAt,
        endedAt,
        otherUsers: { connect: { id: guestId } },
      },
    });
    made++;
  }
  const total = await prisma.gameSession.count({
    where: {
      OR: [{ hostId: alexis }, { otherUsers: { some: { id: alexis } } }],
    },
  });
  return { total, made };
}

async function main(): Promise<void> {
  assertLocalDatabase(connectionString);
  const ids = await seedUsers();
  const alexis = ids.get('alexis');
  if (alexis === undefined) {
    throw new Error('alexis missing from the seeded users');
  }

  await seedSocialGraph(ids, alexis);
  const sessions = await seedGameSessions(ids, alexis);

  console.log(`seeded ${String(ids.size)} people`);
  console.log(`  sign in as any of them: <name>@naucto.local / ${DEV_PASSWORD}`);
  console.log(
    `  alexis (id ${String(alexis)}) has ${String(FRIENDS_OF_ALEXIS.length)} friends and ` +
      `${String(PENDING_TO_ALEXIS.length)} pending requests`,
  );
  console.log(
    sessions === null
      ? '  no games yet, so no shared sessions — run seed:content, then this again'
      : `  ${String(sessions.total)} shared game sessions (${String(sessions.made)} new), ` +
          'so PLAYED WITH RECENTLY has rows',
  );
  console.log('next: npm run seed:content in the Frontend, for games with playable content');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
