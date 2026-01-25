FROM node:20-alpine

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
COPY prisma ./prisma

RUN npm install
RUN npx prisma generate
COPY . .

ENV PORT=${BACKEND_PORT}
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
