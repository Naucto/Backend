import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOT = __dirname;

const sources = (pattern: string): string[] =>
  globSync(pattern, { cwd: SOURCE_ROOT }).filter((file) => !file.endsWith('.spec.ts'));

const mentions = (file: string, pattern: RegExp): boolean =>
  pattern.test(readFileSync(join(SOURCE_ROOT, file), 'utf-8'));

describe('the layers', () => {
  // A controller speaks HTTP and nothing else. A query written in one is a rule of the feature
  // that its service, a job or a socket calling that service would not apply.
  it('keep every controller away from the database', () => {
    const controllers = sources('**/*.controller.ts');

    expect(controllers).not.toEqual([]);
    expect(controllers.filter((file) => mentions(file, /\bPrismaService\b/))).toEqual([]);
  });

  // A service called from a job or a socket has no HTTP layer above it to answer for.
  it('keep every controller out of what a service imports', () => {
    const services = sources('**/*.service.ts');

    expect(services).not.toEqual([]);
    expect(services.filter((file) => mentions(file, /from '[^']*\.controller'/))).toEqual([]);
  });
});
