FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

RUN corepack enable \
 && corepack prepare yarn@4.9.2 --activate

COPY package.json yarn.lock ./
COPY prisma ./prisma

RUN yarn install && yarn prisma generate
COPY . .

# RUN yarn build
EXPOSE 3000

CMD ["sh", "-c", "yarn prisma migrate deploy && yarn start"]
