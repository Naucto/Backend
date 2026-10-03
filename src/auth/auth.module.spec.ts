import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { withEnv } from '../../test/env';
import { UserModule } from '../routes/user/user.module';
import { AccessGuard } from './access/access.guard';
import { AuthModule } from './auth.module';

/** The global guard is built in the root module's injector, from what the root module imports. */
@Module({
  imports: [AuthModule, UserModule],
  providers: [AccessGuard],
})
class GuardConsumerModule {}

const LIFETIME_VARIABLES = ['JWT_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN'] as const;

describe('AuthModule', () => {
  const boot = (): Promise<TestingModule> =>
    Test.createTestingModule({ imports: [GuardConsumerModule] }).compile();

  beforeEach(() => {
    // Providers reached through AuthModule validate their configuration at construction; a value
    // already in the real environment wins, so a developer's own setup is never overridden.
    //
    // PrismaService reads this from its constructor; nothing connects, Prisma dials on first query.
    // S3Module's client factory throws unless all three are present. No request is ever made.
    // The JWT module factory refuses to build without a secret.
    withEnv({
      DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://unused:unused@127.0.0.1:1/unused',
      S3_REGION: process.env['S3_REGION'] ?? 'us-east-1',
      S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'unused',
      S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'unused',
      S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://127.0.0.1:1',
      JWT_SECRET: process.env['JWT_SECRET'] ?? 'test-secret-not-used-for-anything',
    });
  });

  it('gives the root module everything the access guard needs', async () => {
    const moduleRef = await boot();

    expect(moduleRef.get(AccessGuard, { strict: false })).toBeDefined();
    await moduleRef.close();
  }, 30_000);

  it.each(LIFETIME_VARIABLES)(
    'refuses to boot on a %s it cannot parse, and names that variable',
    async (name) => {
      withEnv({ [name]: 'soon' });

      await expect(boot()).rejects.toThrow(`${name} environment variable has an invalid value`);
    },
    30_000,
  );

  it('boots on a lifetime counted in weeks, which signing accepts', async () => {
    withEnv({ JWT_EXPIRES_IN: '2w' });

    const moduleRef = await boot();

    await moduleRef.close();
  }, 30_000);
});
