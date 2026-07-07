FROM node:22-alpine AS base

ARG BACKEND_PORT=3000
ARG POSTGRES_HOST
ARG POSTGRES_PORT
ARG POSTGRES_USER
ARG POSTGRES_PASSWORD
ARG POSTGRES_DB

WORKDIR /app

# If we need some dependencies that require native compilation (unlikely),
# decomment this out:
# RUN apk add --no-cache python3 make g++

ENV DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma

# Full dependency set (build + dev tooling), shared by the dev and build stages.
FROM base AS deps
RUN npm ci
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

# Slim production runtime: production dependencies only (no Prisma CLI, no dev
# tooling), the generated Prisma client copied from the build stage, and the
# compiled output -- no source or test assets. Migrations run via the `migrate`
# stage above, not here.
FROM base AS prod
ENV PORT=${BACKEND_PORT}
# Swagger UI is not served in production, so drop its bundled static assets.
ENV ENABLE_SWAGGER=false
# --omit=optional drops the Prisma CLI + TypeScript, which @prisma/client only
# declares as optional peer deps (the runtime client needs neither).
RUN npm ci --omit=dev --omit=optional \
    && rm -rf node_modules/swagger-ui-dist \
    && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY package.json config* ./config/
CMD ["npm", "run", "start:prod"]
