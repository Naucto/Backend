import { getOptionalEnv } from '../config/env';

/**
 * The connection URL the environment describes, or "" when it describes none: callers that can
 * run without a database (e.g. `prisma generate`) treat the empty string as "no database".
 *
 * Builds one from the `POSTGRES_*` values when `DATABASE_URL` is unset. That fallback always
 * targets `localhost`, never a `POSTGRES_HOST`: it exists for the Prisma CLI and `seed:dev`, run
 * from the host, where a compose service name does not resolve and the database is reached
 * through its published port on localhost instead. The running server has no such fallback target
 * — inside a container it needs the compose service name, not localhost — so it requires
 * `DATABASE_URL` to be set directly.
 */
export function databaseUrl(): string {
  const direct = getOptionalEnv('DATABASE_URL');
  if (direct) {
    return direct;
  }

  const user = getOptionalEnv('POSTGRES_USER');
  const password = getOptionalEnv('POSTGRES_PASSWORD');
  const name = getOptionalEnv('POSTGRES_DB');
  if (!user || !password || !name) {
    return '';
  }

  const port = getOptionalEnv('POSTGRES_PORT', 5432);
  return `postgresql://${user}:${encodeURIComponent(password)}@localhost:${port}/${name}`;
}
