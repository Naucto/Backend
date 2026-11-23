import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { NO_RELEASE_ID } from '../src/common/ids';

const MODELS = join(__dirname, '..', 'prisma', 'models');
const UUID_DEFAULT = /@default\(dbgenerated\("'([^']*)'::uuid"\)\)/g;

describe('the "no game" id', () => {
  const defaults = readdirSync(MODELS)
    .filter((file) => file.endsWith('.prisma'))
    .flatMap((file) =>
      [...readFileSync(join(MODELS, file), 'utf8').matchAll(UUID_DEFAULT)].map((match) => ({
        file,
        value: match[1],
      })),
    );

  it('is the default of the release columns that are part of a key', () => {
    expect(defaults.map(({ file }) => file)).toEqual(['analytics.prisma', 'analytics.prisma']);
  });

  it('is spelled in the schema exactly as the code spells it', () => {
    expect(defaults.map(({ value }) => value)).toEqual(defaults.map(() => NO_RELEASE_ID));
  });
});
