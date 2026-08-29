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

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new ReferenceError("DATABASE_URL is not set");
// Prisma 7 takes the driver adapter, the same way PrismaService does.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

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
  { username: "louis", description: "I love making games", friendCode: "LOUIS002" },
  { username: "edgar", description: "Ferries, mostly.", friendCode: "EDGAR003" },
  {
    username: "thea",
    nickname: "théodore",
    description: "Moon lander enthusiast.",
    friendCode: "THEA0004"
  },
  { username: "ulysse", description: "Snake, but eight-bit.", friendCode: "ULYSSE05" },
  { username: "vincent", friendCode: "VINCEN06" },
  { username: "marie", friendCode: "MARIE007" },
  { username: "julien", description: "New here.", friendCode: "JULIEN08" },
  { username: "kenza", friendCode: "KENZA009" },
  { username: "sacha", friendCode: "SACHA010" }
];

/** Accepted friendships with `alexis`. Presence is a runtime thing, so on a quiet stack these
 *  all render in the OFFLINE grid — which is exactly the case that had no rows before. */
const FRIENDS_OF_ALEXIS = ["louis", "edgar", "thea", "ulysse", "vincent", "marie"];
/** Left pending on purpose: the REQUESTS panel is unreachable without one. */
const PENDING_TO_ALEXIS = ["julien", "kenza"];

function assertLocalDatabase(): void {
  const url = process.env["DATABASE_URL"] ?? "";
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
  if (alexis === undefined) throw new Error("alexis missing from the seeded users");

  for (const name of FRIENDS_OF_ALEXIS) {
    const other = ids.get(name);
    if (other === undefined) continue;
    // FriendsService stores the pair with userAId < userBId; match that or lookups miss.
    const [userAId, userBId] = alexis < other ? [alexis, other] : [other, alexis];
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

async function main(): Promise<void> {
  assertLocalDatabase();
  const ids = await seedUsers();
  await seedSocialGraph(ids);

  const alexis = ids.get("alexis");
  console.log(`seeded ${String(ids.size)} people`);
  console.log(`  sign in as any of them: <name>@naucto.local / ${DEV_PASSWORD}`);
  console.log(
    `  alexis (id ${String(alexis ?? 0)}) has ${String(FRIENDS_OF_ALEXIS.length)} friends and ` +
      `${String(PENDING_TO_ALEXIS.length)} pending requests`
  );
  console.log("next: npm run seed:content in the Frontend, for games with playable content");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
