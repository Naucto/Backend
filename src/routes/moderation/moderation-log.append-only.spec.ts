import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOT = join(__dirname, '..', '..');

const REWRITES = /moderationAction\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/;

describe('the moderation log', () => {
  // The log is evidence of what staff did. A row that could be edited or removed would stop being it.
  it('is never updated or deleted anywhere in the application', () => {
    const offenders = globSync('**/*.ts', { cwd: SOURCE_ROOT })
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => REWRITES.test(readFileSync(join(SOURCE_ROOT, file), 'utf-8')));

    expect(offenders).toEqual([]);
  });
});
