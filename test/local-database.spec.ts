import { assertLocalDatabase } from '../prisma/local-database';

describe('assertLocalDatabase', () => {
  it.each([
    'postgresql://u:p@localhost:5432/naucto',
    'postgresql://u:p@127.0.0.1/naucto',
    'postgresql://u:p@[::1]:5432/naucto',
    'postgresql://u:p@db:5432/naucto',
  ])('lets %s through', (url) => {
    expect(() => assertLocalDatabase(url, 'test')).not.toThrow();
  });

  it.each(['postgresql://u:p@prod.example.com/naucto', 'postgresql://u:p@10.0.0.5/naucto'])(
    'refuses %s',
    (url) => {
      expect(() => assertLocalDatabase(url, 'seed:analytics')).toThrow(
        /seed:analytics refuses to touch a non-local database/,
      );
    },
  );
});
