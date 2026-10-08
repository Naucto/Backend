import 'dotenv/config';

import { writeFileSync } from 'node:fs';

import { setupGracefulShutdown } from '@tygra/nestjs-graceful-shutdown';

import type { EnvKey } from '../src/config/env';

/**
 * Only what booting the document module refuses to start without; anything else read at boot
 * has a fallback, and an unset OAuth provider is merely disabled.
 */
const stubEnv: Partial<Record<EnvKey, string>> = {
  // PrismaService builds its driver adapter from it at construction.
  DATABASE_URL: 'postgresql://stub:stub@localhost:5432/stub',
  // The JWT module and the JWT strategy both read it at construction.
  JWT_SECRET: 'stub-secret-for-swagger-generation-only',
  // S3Service refuses to construct without these four.
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'stub-region',
  S3_ACCESS_KEY_ID: 'stub-key',
  S3_SECRET_ACCESS_KEY: 'stub',
};

Object.assign(process.env, stubEnv);

(async () => {
  try {
    const { NestFactory } = await import('@nestjs/core');
    const { SwaggerAppModule } = await import('../src/swagger.app.module');
    const { buildSwaggerDocument } = await import('../src/swagger');

    const app = await NestFactory.create(SwaggerAppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });
    setupGracefulShutdown({ app });

    const document = buildSwaggerDocument(app);
    writeFileSync('swagger.json', JSON.stringify(document, null, 2));

    await app.close();
    console.log('[swag-gen] swagger.json written');
  } catch (err) {
    console.error(
      '[swag-gen] Failed to generate swagger.json',
      err instanceof Error ? err.stack : String(err),
    );
    process.exit(1);
  }
})();
