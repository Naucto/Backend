FROM node:22-alpine AS base

WORKDIR /app

# If we need some dependencies that require native compilation (unlikely),
# decomment this out:
# RUN apk add --no-cache python3 make g++

# DATABASE_URL is supplied at runtime, not baked in: neither `prisma generate`
# nor `nest build` needs a reachable database, and baking it would write the
# Postgres password into an image layer.

COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma

# Full dependency set (build + dev tooling), shared by the dev and build stages.
FROM base AS deps
RUN npm ci
RUN npx prisma generate

FROM deps AS dev
ENV PORT=3000
EXPOSE 3000
COPY . .
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]

FROM deps AS build
COPY . .
RUN npm run build

# Migration runner: reuses the build stage (which has the Prisma CLI) to apply
# pending migrations as a one-off step, decoupled from the runtime image.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# Slim production runtime: production dependencies only (no Prisma CLI, no dev
# tooling), the generated Prisma client copied from the build stage, and the
# compiled output -- no source or test assets. Migrations run via the `migrate`
# stage above, not here.
FROM base AS prod
ENV PORT=3000
EXPOSE 3000
# Swagger UI is not served in production, so drop its bundled static assets.
ENV ENABLE_SWAGGER=false
# Keep optional peer deps so the Prisma CLI (an optional peer of @prisma/client)
# stays in the image: the prod deploy self-runs `prisma migrate deploy` in this
# container at startup, so it needs the CLI. --omit=dev still drops the dev toolchain.
# TODO(NCTO-XXX): move migrations to the dedicated `migrate` stage so prod can
# re-add --omit=optional and slim back down (see migrate stage + docker-compose).
RUN npm ci --omit=dev \
    && rm -rf node_modules/swagger-ui-dist \
    && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
# webrtc.service.ts reads <cwd>/config/webrtc.json. The glob keeps the config
# folder optional; package.json is a second source so the target stays a dir.
COPY package.json config* ./config/
CMD ["npm", "run", "start:prod"]
