/**
 * Development seed: a social graph rich enough that the screens have something to draw.
 *
 * Every list, shelf, panel and empty state in the app looks the same against an empty database, so
 * a fidelity pass done on one is measuring the wrong thing — a friends page with one accepted
 * friend never renders the OFFLINE grid, and a game with no comments never renders a reply, an
 * AUTHOR badge or "load more". This fills that in.
 *
 * Games and their content are seeded separately, by `npm run seed:content` in the Frontend: the
 * playable blob is a Yjs document only `@naucto/engine` knows how to build, and going through the
 * real create/save/publish endpoints exercises the same path a person would.
 *
 * Idempotent — upserts on the natural keys, so running it twice changes nothing.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv();

/**
 * The image composes `DATABASE_URL` from the `POSTGRES_*` values (see the Dockerfile), so it only
 * exists inside the container — running this script on the host used to die on a missing variable.
 * Compose the same URL from the same values instead.
 *
 * Reaching this fallback at all proves we are on the host, because the container always has
 * `DATABASE_URL` set; so `POSTGRES_HOST` holds a compose service name that does not resolve here,
 * and the published port on localhost is what we actually want.
 */
function databaseUrl(): string {
  const direct = process.env["DATABASE_URL"];
  if (direct) return direct;

  const user = process.env["POSTGRES_USER"];
  const password = process.env["POSTGRES_PASSWORD"];
  const name = process.env["POSTGRES_DB"];
  if (!user || !password || !name) {
    throw new ReferenceError(
      "Set DATABASE_URL, or POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB in .env"
    );
  }
  const port = process.env["POSTGRES_PORT"] ?? "5432";
  return `postgresql://${user}:${encodeURIComponent(password)}@localhost:${port}/${name}`;
}

const connectionString = databaseUrl();
// Prisma 7 takes the driver adapter, the same way PrismaService does.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

/** Everyone shares one password locally; this script refuses to run anywhere but a local database. */
const DEV_PASSWORD = "Naucto!dev1";

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
    username: "alexis",
    description: "Building the console the console deserves.",
    friendCode: "ALEXIS01"
  },
  {
    username: "louis",
    description: "I love making games",
    friendCode: "LOUIS002"
  },
  {
    username: "edgar",
    description: "Ferries, mostly.",
    friendCode: "EDGAR003"
  },
  {
    username: "thea",
    nickname: "théodore",
    description: "Moon lander enthusiast.",
    friendCode: "THEA0004"
  },
  {
    username: "ulysse",
    description: "Snake, but eight-bit.",
    friendCode: "ULYSSE05"
  },
  { username: "vincent", friendCode: "VINCEN06" },
  { username: "marie", friendCode: "MARIE007" },
  { username: "julien", description: "New here.", friendCode: "JULIEN08" },
  { username: "kenza", friendCode: "KENZA009" },
  { username: "sacha", friendCode: "SACHA010" }
];

/** Accepted friendships with `alexis`. Presence is a runtime thing, so on a quiet stack these
 *  all render in the OFFLINE grid — which is exactly the case that had no rows before. */
const FRIENDS_OF_ALEXIS = [
  "louis",
  "edgar",
  "thea",
  "ulysse",
  "vincent",
  "marie"
];
/** Left pending on purpose: the REQUESTS panel is unreachable without one. */
const PENDING_TO_ALEXIS = ["julien", "kenza"];

/**
 * Sessions `alexis` shared with other people, newest first, each on a different game. PLAYED WITH RECENTLY reads
 * `gameSession` rows inside a 30-day window, so with none of them the panel never renders at all —
 * and neither does the ADD button on it, which only appears beside a player who is *not* a friend.
 * `sacha` is that case on purpose; the rest are friends.
 *
 * Hours rather than dates so the relative times stay plausible however long after seeding you look.
 */
const SHARED_SESSIONS: {
  with: string;
  hoursAgo: number;
  players: number;
  game: string;
  /** Who ran it. Half are hosted by the other person so both sides of the lookup get exercised:
   *  the service finds a session by the caller being its host *or* one of its players. */
  hostedByThem?: boolean;
}[] = [
  {
    with: "ulysse",
    hoursAgo: 3,
    players: 2,
    game: "Snake 8-bit",
    hostedByThem: true
  },
  { with: "sacha", hoursAgo: 27, players: 4, game: "Duel" },
  { with: "louis", hoursAgo: 76, players: 2, game: "Moon Lander" },
  {
    with: "thea",
    hoursAgo: 199,
    players: 3,
    game: "Ferry Click",
    hostedByThem: true
  }
];

function assertLocalDatabase(url: string): void {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const local = ["localhost", "127.0.0.1", "::1", "db", "postgres"];
  if (!local.includes(host)) {
    throw new Error(
      `seed:dev refuses to touch a non-local database (host "${host}"). ` +
        "It writes fixed passwords and fake people; that belongs on a laptop, nowhere else."
    );
  }
}

async function seedUsers(): Promise<Map<string, number>> {
  const password = await bcrypt.hash(DEV_PASSWORD, 10);
  const ids = new Map<string, number>();
  for (const u of USERS) {
    const row = await prisma.user.upsert({
      where: { email: `${u.username}@naucto.local` },
      update: {
        nickname: u.nickname ?? null,
        description: u.description ?? null,
        friendCode: u.friendCode,
        // Reset on every run: the whole point is that the documented password always works, and a
        // row left over from an earlier fixture would otherwise keep its old one.
        password
      },
      create: {
        email: `${u.username}@naucto.local`,
        username: u.username,
        nickname: u.nickname ?? null,
        description: u.description ?? null,
        friendCode: u.friendCode,
        password
      },
      select: { id: true }
    });
    ids.set(u.username, row.id);
  }
  return ids;
}

async function seedSocialGraph(ids: Map<string, number>): Promise<void> {
  const alexis = ids.get("alexis");
  if (alexis === undefined)
    throw new Error("alexis missing from the seeded users");

  for (const name of FRIENDS_OF_ALEXIS) {
    const other = ids.get(name);
    if (other === undefined) continue;
    // FriendsService stores the pair with userAId < userBId; match that or lookups miss.
    const [userAId, userBId] =
      alexis < other ? [alexis, other] : [other, alexis];
    await prisma.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId }
    });
  }

  for (const name of PENDING_TO_ALEXIS) {
    const from = ids.get(name);
    if (from === undefined) continue;
    await prisma.friendRequest.upsert({
      where: { fromId_toId: { fromId: from, toId: alexis } },
      update: {},
      create: { fromId: from, toId: alexis }
    });
  }
}

/**
 * Needs games, which are seeded from the Frontend by `npm run seed:content` — so on a first run
 * there is nothing to attach a session to and this quietly does nothing. Run it again afterwards
 * and the panel fills in.
 *
 * `GameSession` has no natural key describing "the same play" -- `sessionId` and `joinCode` both
 * default to a fresh uuid -- so the pair (host, project, other player) stands in for one, and a
 * re-run moves its clock forward instead of adding a row. Matching on `startedAt` cannot work:
 * it is computed from now, so it differs every run and every run inserts a fresh set.
 */
async function seedGameSessions(
  ids: Map<string, number>
): Promise<{ total: number; made: number } | null> {
  const alexis = ids.get("alexis");
  if (alexis === undefined)
    throw new Error("alexis missing from the seeded users");

  // Any game, not just alexis's own -- you play someone else's game together far more often than
  // your own, and drawing from one project made every row in the panel name the same game.
  const projects = await prisma.project.findMany({
    select: { id: true, name: true }
  });
  if (projects.length === 0) return null;
  const byName = new Map(projects.map((p) => [p.name, p]));

  let made = 0;
  for (const session of SHARED_SESSIONS) {
    const other = ids.get(session.with);
    const project = byName.get(session.game);
    if (other === undefined || project === undefined) continue;

    const [hostId, guestId] = session.hostedByThem
      ? [other, alexis]
      : [alexis, other];
    const startedAt = new Date(Date.now() - session.hoursAgo * 60 * 60 * 1000);

    // Every one of these is over; a row with no endedAt reads as a session still running.
    const endedAt = new Date(startedAt.getTime() + 45 * 60 * 1000);

    const existing = await prisma.gameSession.findFirst({
      where: {
        hostId,
        projectId: project.id,
        otherUsers: { some: { id: guestId } }
      },
      select: { id: true }
    });

    if (existing !== null) {
      await prisma.gameSession.update({
        where: { id: existing.id },
        data: {
          startedAt,
          endedAt,
          title: project.name,
          maxPlayers: session.players
        }
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
        otherUsers: { connect: { id: guestId } }
      }
    });
    made++;
  }
  const total = await prisma.gameSession.count({
    where: {
      OR: [{ hostId: alexis }, { otherUsers: { some: { id: alexis } } }]
    }
  });
  return { total, made };
}

async function main(): Promise<void> {
  assertLocalDatabase(connectionString);
  const ids = await seedUsers();
  await seedSocialGraph(ids);
  const sessions = await seedGameSessions(ids);

  const alexis = ids.get("alexis");
  console.log(`seeded ${String(ids.size)} people`);
  console.log(
    `  sign in as any of them: <name>@naucto.local / ${DEV_PASSWORD}`
  );
  console.log(
    `  alexis (id ${String(alexis ?? 0)}) has ${String(FRIENDS_OF_ALEXIS.length)} friends and ` +
      `${String(PENDING_TO_ALEXIS.length)} pending requests`
  );
  console.log(
    sessions === null
      ? "  no games yet, so no shared sessions — run seed:content, then this again"
      : `  ${String(sessions.total)} shared game sessions (${String(sessions.made)} new), ` +
          "so PLAYED WITH RECENTLY has rows"
  );
  console.log(
    "next: npm run seed:content in the Frontend, for games with playable content"
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
