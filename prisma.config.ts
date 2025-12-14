import path from "node:path";
import { defineConfig, env } from "prisma/config";
import dotenv from "dotenv";
dotenv.config();

export default defineConfig({
  schema: path.join("prisma"),
  migrations: { 
    path: path.join("prisma", "migrations"),
  },
  views: { 
    path: path.join("db", "views"),
  },
  typedSql: { 
    path: path.join("db", "queries"),
  },
  engine: "classic",
  datasource: { 
    url: env("DATABASE_URL") 
  }
});
