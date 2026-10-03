import { normalizeFriendCode } from "@user/friend-code.util";

const mockPrisma = {
  user: { upsert: jest.fn() },
  friendship: { upsert: jest.fn() },
  friendRequest: { upsert: jest.fn() },
  project: { findMany: jest.fn() },
  $disconnect: jest.fn()
};

jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn() }));
jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock("bcryptjs", () => ({ hash: jest.fn().mockResolvedValue("hashed") }));

/** Runs the script the way `npm run seed:dev` does, and resolves once it has let go of the database. */
async function runSeed(): Promise<void> {
  const finished = new Promise<void>((resolve) => {
    mockPrisma.$disconnect.mockImplementation(async () => resolve());
  });

  await jest.isolateModulesAsync(async () => {
    await import("../prisma/seed-dev");
  });
  await finished;
}

describe("seed:dev", () => {
  const environment = process.env;
  let logged: jest.SpyInstance;
  let failed: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...environment,
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://naucto:naucto@db:5432/naucto"
    };

    let nextId = 1;
    mockPrisma.user.upsert.mockImplementation(async () => ({ id: nextId++ }));
    mockPrisma.project.findMany.mockResolvedValue([]);

    logged = jest.spyOn(console, "log").mockImplementation(() => undefined);
    failed = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = environment;
    process.exitCode = undefined;
    jest.clearAllMocks();
    logged.mockRestore();
    failed.mockRestore();
  });

  it("gives every person a friend code that the lookup by code can find", async () => {
    await runSeed();

    const codes = mockPrisma.user.upsert.mock.calls.map(
      ([ args ]: [{ create: { friendCode: string } }]) => args.create.friendCode
    );

    expect(codes).not.toHaveLength(0);
    expect(codes.map(normalizeFriendCode)).toEqual(codes);
  });

  it("refuses to write anything when NODE_ENV is production", async () => {
    process.env["NODE_ENV"] = "production";

    await runSeed();

    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("NODE_ENV=production") })
    );
    expect(process.exitCode).toBe(1);
  });
});
