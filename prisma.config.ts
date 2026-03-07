import path from "node:path";
import { defineConfig } from "prisma/config";
import dotenv from "dotenv";
dotenv.config();

export default defineConfig({
  schema: path.join("prisma"),
  migrations: { 
    path: path.join("prisma", "migrations"),
  },
  datasource: { 
    // ?? "" -> so that we can launch Prsima without necessarily setting up the DATABASE_URL connx.
    url: process.env.DATABASE_URL ?? ""
  }
});

