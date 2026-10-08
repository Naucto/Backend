# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base

ARG BACKEND_PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma.config.ts ./
# The source files prisma.config.ts imports, which the runtime image needs as well.
COPY src/config/env.ts ./src/config/env.ts
COPY src/prisma/database-url.ts ./src/prisma/database-url.ts
COPY prisma ./prisma

# Full dependency set (build + dev tooling), shared by the dev and build stages. No database is
# needed to build: DATABASE_URL is injected at runtime by every environment.
FROM base AS deps
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
RUN npx prisma generate

FROM deps AS dev
ENV PORT=${BACKEND_PORT}
COPY . .
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]

FROM deps AS build
COPY . .
RUN npm run build

# Migration runner: reuses the build stage (which has the Prisma CLI) to apply
# pending migrations as a one-off step, decoupled from the runtime image.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# The installed tree minus dev dependencies, generated Prisma client included. The Prisma CLI is an
# optional peer of @prisma/client and is left out: migrations run from the `migrate` target.
FROM deps AS prod-deps
RUN npm prune --omit=dev --omit=optional --no-audit --no-fund \
    && rm -rf node_modules/swagger-ui-dist

FROM node:22-alpine AS prod
ARG BACKEND_PORT=3000
ENV PORT=${BACKEND_PORT}
# Swagger UI is not served in production; its bundled static assets were dropped above.
ENV ENABLE_SWAGGER=false
WORKDIR /app
COPY --chown=node:node package.json package-lock.json prisma.config.ts ./
COPY --chown=node:node src/config/env.ts ./src/config/env.ts
COPY --chown=node:node src/prisma/database-url.ts ./src/prisma/database-url.ts
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node config ./config
RUN chown node:node /app
USER node
# node directly rather than through npm, so SIGTERM reaches the app's graceful shutdown.
CMD ["node", "dist/main.js"]
