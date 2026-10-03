import { defineConfig } from "prisma/config";
import dotenv from "dotenv";
dotenv.config();

/**
 * The connection URL of the database the environment describes, or "" when it describes none:
 * commands that never connect, such as `prisma generate`, must run without one.
 *
 * Inside the container `DATABASE_URL` is always set, so its absence means the command runs on the
 * host: there the compose service name in `POSTGRES_HOST` does not resolve, and the database is
 * reached through its published port on localhost.
 */
export function databaseUrl(): string {
  const direct = process.env["DATABASE_URL"];
  if (direct) return direct;

  const user = process.env["POSTGRES_USER"];
  const password = process.env["POSTGRES_PASSWORD"];
  const name = process.env["POSTGRES_DB"];
  if (!user || !password || !name) return "";

  const port = process.env["POSTGRES_PORT"] ?? "5432";
  return `postgresql://${user}:${encodeURIComponent(password)}@localhost:${port}/${name}`;
}

export default defineConfig({
  schema: "prisma",
  migrations: { 
    path: "prisma/migrations",
  },
  datasource: { 
    url: databaseUrl()
  }
});
