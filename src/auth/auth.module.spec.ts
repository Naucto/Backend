import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { AuthModule } from "./auth.module";
import { RolesGuard } from "./guards/roles.guard";

/**
 * `RolesGuard` takes a `UserService`, and Nest builds an exported provider in the *consumer's*
 * injector — so a module that imports `AuthModule` to use the guard needs `UserModule` in scope
 * too. When `AuthModule` exported the guard without it, `CurationModule` threw
 * `UnknownDependenciesException` at start-up and the backend could not boot at all. Nothing
 * caught it: every suite mocks its collaborators and CI never starts the app.
 *
 * Importing `AuthModule` directly would not reproduce it — inside its own injector the guard
 * resolves fine. The consumer below is the shape that actually breaks.
 */
// ConfigModule is global in AppModule; the consumer has to stand it up itself in isolation.
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule], providers: [RolesGuard] })
class GuardConsumerModule {}

describe("AuthModule", () => {
  it("gives a consumer of RolesGuard everything the guard needs", async () => {
    // Standing the module graph up drags in everything AuthModule reaches, and two of those
    // providers validate their configuration in the constructor. Supply the values here rather
    // than leaning on a developer's .env — with `??=` a real environment still wins, and without
    // them this passed on a laptop and failed in CI, which is the worst of both.
    //
    // PrismaService reads this from its constructor; nothing connects, Prisma dials on first query.
    process.env["DATABASE_URL"] ??= "postgresql://unused:unused@127.0.0.1:1/unused";
    // S3Module's client factory throws unless all three are present. No request is ever made.
    process.env["S3_REGION"] ??= "us-east-1";
    process.env["S3_ACCESS_KEY_ID"] ??= "unused";
    process.env["S3_SECRET_ACCESS_KEY"] ??= "unused";
    process.env["S3_ENDPOINT"] ??= "http://127.0.0.1:1";
    // AuthModule's JwtModule factory refuses to build without one, and wants 16+ chars in dev.
    process.env["JWT_SECRET"] ??= "test-secret-not-used-for-anything";

    const moduleRef = await Test.createTestingModule({ imports: [GuardConsumerModule] }).compile();

    expect(moduleRef.get(RolesGuard, { strict: false })).toBeDefined();
    await moduleRef.close();
  }, 30_000);
});
