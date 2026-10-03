FROM node:22-alpine AS base

ARG BACKEND_PORT=3000
ARG POSTGRES_HOST
ARG POSTGRES_PORT
ARG POSTGRES_USER
ARG POSTGRES_PASSWORD
ARG POSTGRES_DB

WORKDIR /app

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

# Production runtime: production dependencies, the generated Prisma client and the compiled output.
FROM base AS prod
ENV PORT=${BACKEND_PORT}
# Swagger UI is not served in production, so drop its bundled static assets.
ENV ENABLE_SWAGGER=false
# No --omit=optional: the deployment runs `prisma migrate deploy` in this container at startup,
# and the Prisma CLI is an optional peer of @prisma/client.
RUN npm ci --omit=dev \
    && rm -rf node_modules/swagger-ui-dist \
    && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY config ./config
CMD ["npm", "run", "start:prod"]
