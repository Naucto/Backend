import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";

import { AuthModule } from "./auth.module";
import { RolesGuard } from "./guards/roles.guard";

/**
 * Nest builds an exported guard in the consumer's injector, so the guard is resolved from a module
 * that imports `AuthModule`: inside `AuthModule`'s own injector it would resolve regardless.
 */
// ConfigModule is global in AppModule; the consumer has to stand it up itself in isolation.
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule], providers: [RolesGuard] })
class GuardConsumerModule {}

const LIFETIME_VARIABLES = [ "JWT_EXPIRES_IN", "JWT_REFRESH_EXPIRES_IN" ] as const;

describe("AuthModule", () => {
  const configured = LIFETIME_VARIABLES.map((name) => [ name, process.env[name] ] as const);

  const boot = (): Promise<TestingModule> =>
    Test.createTestingModule({ imports: [GuardConsumerModule] }).compile();

  beforeAll(() => {
    // Providers reached through AuthModule validate their configuration at construction; `??=`
    // lets a real environment win.
    //
    // PrismaService reads this from its constructor; nothing connects, Prisma dials on first query.
    process.env["DATABASE_URL"] ??= "postgresql://unused:unused@127.0.0.1:1/unused";
    // S3Module's client factory throws unless all three are present. No request is ever made.
    process.env["S3_REGION"] ??= "us-east-1";
    process.env["S3_ACCESS_KEY_ID"] ??= "unused";
    process.env["S3_SECRET_ACCESS_KEY"] ??= "unused";
    process.env["S3_ENDPOINT"] ??= "http://127.0.0.1:1";
    // The JWT module factory refuses to build without a secret.
    process.env["JWT_SECRET"] ??= "test-secret-not-used-for-anything";
  });

  afterEach(() => {
    for (const [ name, value ] of configured) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("gives a consumer of RolesGuard everything the guard needs", async () => {
    const moduleRef = await boot();

    expect(moduleRef.get(RolesGuard, { strict: false })).toBeDefined();
    await moduleRef.close();
  }, 30_000);

  it.each(LIFETIME_VARIABLES)(
    "refuses to boot on a %s it cannot parse, and names that variable",
    async (name) => {
      process.env[name] = "soon";

      await expect(boot()).rejects.toThrow(`${name} environment variable has an invalid value`);
    },
    30_000
  );

  it("boots on a lifetime counted in weeks, which signing accepts", async () => {
    process.env["JWT_EXPIRES_IN"] = "2w";

    const moduleRef = await boot();

    await moduleRef.close();
  }, 30_000);
});
