FROM node:20-alpine AS base

ARG BACKEND_PORT=3000
ARG POSTGRES_HOST
ARG POSTGRES_PORT
ARG POSTGRES_USER
ARG POSTGRES_PASSWORD
ARG POSTGRES_DB

WORKDIR /app

RUN apk add --no-cache python3 make g++

ENV DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

COPY package.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma

RUN npm install
RUN npx prisma generate

FROM base AS dev
ENV PORT=${BACKEND_PORT}
COPY . .
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:dev"]

FROM base AS prod
COPY . .
RUN npm run build
ENV PORT=${BACKEND_PORT}
CMD ["sh", "-c", "npx prisma migrate deploy && node --openssl-legacy-provider dist/main"]
