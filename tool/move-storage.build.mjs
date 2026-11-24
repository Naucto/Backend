/**
 * Bundles `tool/move-storage.ts` as `build/move-storage.cjs`: one file to copy into the backend's
 * runtime image, which holds the compiled server and no TypeScript. `pg`, `@aws-sdk/client-s3`
 * and `dotenv` stay external: they are production dependencies, resolved from `/app/node_modules`
 * when the bundle sits in `/app`.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['tool/move-storage.ts'],
  outfile: 'build/move-storage.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['pg', '@aws-sdk/client-s3', 'dotenv'],
  logLevel: 'info',
});
