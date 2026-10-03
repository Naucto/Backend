import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

import { databaseUrl } from './src/prisma/database-url';

dotenv.config();

export default defineConfig({
  schema: 'prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl(),
  },
});
