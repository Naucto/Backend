import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOT = join(__dirname, '..', '..');
const LOG_SERVICE = join('routes', 'moderation', 'moderation-log.service.ts');

const REWRITES = /moderationAction\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/g;

const rewritesIn = (file: string): string[] =>
  [...readFileSync(join(SOURCE_ROOT, file), 'utf-8').matchAll(REWRITES)].map((match) => match[1]!);

describe('the moderation log', () => {
  // The log is evidence of what staff did. A row that could be edited or removed would stop being it.
  it('is never updated or deleted anywhere in the application', () => {
    const offenders = globSync('**/*.ts', { cwd: SOURCE_ROOT })
      .filter((file) => !file.endsWith('.spec.ts') && file !== LOG_SERVICE)
      .filter((file) => rewritesIn(file).length > 0);

    expect(offenders).toEqual([]);
  });

  // Erasing an account has to take the stored copy of what the person wrote. That one update lives
  // in the log service, and a second one appearing there is a decision to make here first.
  it('takes one change only, in its own service: the scrub of an erased account', () => {
    expect(rewritesIn(LOG_SERVICE)).toEqual(['updateMany']);
  });
});
