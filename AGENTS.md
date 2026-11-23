# AGENTS.md

Guidance for AI agents and contributors working in the Naucto Backend. This is a **working
guide, not a rigid rulebook** — the config files are the source of truth for enforced rules;
this file documents the intent, conventions, and gotchas that tooling can't capture.

> Compatible with Claude Code (via `CLAUDE.md` → `@AGENTS.md`) and OpenCode (native `AGENTS.md`).

## Overview

Naucto Backend is a **NestJS 11 + Prisma 7 + TypeScript** REST/WebSocket API for a
collaborative, multiplayer game editor. It uses PostgreSQL (via the Prisma `pg` adapter), JWT
auth (`passport-jwt`) with encrypted refresh-token cookies and Google/GitHub/Microsoft OAuth,
S3-compatible object storage for game and asset content, handed to the browser from
`EDGE_ENDPOINT`, and a `ws` + Yjs (CRDT) server for real-time multiplayer editing. The HTTP API is
documented with `@nestjs/swagger`, and its OpenAPI spec is the **contract the Frontend's generated
client consumes**. The dev server runs on `http://localhost:3000`; the frontend runs on
`http://localhost:3001`. The typed client is published as `@naucto/api-client` on GitHub Packages
from `client/` (see `client/README.md`).

## How to work in this repo

1. **Explore and reuse before writing.** Look for existing services, guards, DTOs, decorators,
   and common helpers first. A feature is a NestJS module — study an existing one end-to-end
   (`src/routes/collections/` is a small, complete one) and match its shape. Extend the module
   that owns the notion before creating one, and an existing row before adding a table: ratings,
   bug reports and crashes are one `Report` told apart by `kind`, because three tables would be
   three sets of routes, statuses and admin screens to keep alike. The skill
   `naucto-backend-feature` (`.claude/skills/`) is the order of work for adding or changing a
   feature.
2. **Add nothing the change does not need.** No flag around a feature that is simply there
   (`config/features.json` holds what a deployment has to be able to turn off), no second variant
   of a route or a method beside the one it could replace, no helper with a single caller that
   only names its body, no option, constant or export that nothing reads: each is one more thing
   to keep working. A diff touches what it is about, since an unrelated line reformatted or
   renamed is a line someone reviews for nothing.
3. **The config files are the rule authority** — don't rely on memory for style rules:
   - `eslint.config.mjs` — lint rules (import order, explicit return types, the env-access ban,
     naming, no bare `Error` and no unsafe raw SQL under `src/`, …), not formatting.
   - `tsconfig.json` — (very) strict TypeScript settings.
   - `.prettierrc` — owns formatting (`npm run format`); `eslint.config.mjs` extends
     `eslint-config-prettier`, so the two never disagree.
   - `package.json` — available scripts and dependencies.
4. **Run the feedback loop before finishing:** `npm run lint`, `npm run typecheck`, `npm run build`,
   and `npm run test`. CI (`.github/workflows/ci.yml`) runs lint (check-only), typecheck, build and
   Jest against a real Postgres on every push/PR to `main` and must pass. A husky pre-commit hook
   runs `eslint --fix` on staged files and `commit-msg` enforces the `[PART] [TYPE] Message` format.
   `.github/workflows/docker.yml` builds the production image on PRs and publishes it to
   `ghcr.io/naucto/backend:{main,sha-<sha>,<tag>}` on `main` / `v*` tags (consumed by the
   Frontend's full e2e run).
5. **Ask the user when a decision is non-obvious** — especially architectural ones (new
   dependencies, schema/migration changes, cross-cutting structure). Prefer asking over assuming.
6. **Never hand-edit generated code** — `swagger.json`, `client/src` + `client/dist` (all three
   gitignored) are generated (see Gotchas), and so is a migration that only changes the schema. A
   migration that moves data is written by hand, and never changed once it is merged (see
   _Database / Prisma_ below).

## Commands

| Command                                                                             | Purpose                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run start:dev`                                                                 | Start Nest in watch mode on `localhost:3000`                                                                                                                                                                                      |
| `npm run build`                                                                     | Compile with `nest build` (strict `tsc`)                                                                                                                                                                                          |
| `npm run start:prod`                                                                | Run the compiled server (`node dist/main`)                                                                                                                                                                                        |
| `npm run lint`                                                                      | ESLint over `src/`, `test/`, `prisma/`, `tool/` and the root config files — **note: runs with `--fix` (mutates files)**                                                                                                           |
| `npm run lint:check`                                                                | ESLint, check-only (what CI runs)                                                                                                                                                                                                 |
| `npm run typecheck`                                                                 | `tsc --noEmit` over the same files as `lint:check` (`tsconfig.eslint.json`)                                                                                                                                                       |
| `npm run format`                                                                    | Prettier-format `src/` and `test/`                                                                                                                                                                                                |
| `npm run test`                                                                      | Unit tests (Jest, co-located `*.spec.ts`)                                                                                                                                                                                         |
| `npm run test:cov`                                                                  | Unit tests with coverage                                                                                                                                                                                                          |
| `npm run generate:swagger`                                                          | Boot the app and emit `swagger.json` from the Swagger decorators                                                                                                                                                                  |
| `npm run generate:client`                                                           | Generate the typed API client sources into `client/src`                                                                                                                                                                           |
| `npm run client:build`                                                              | Emit `swagger.json`, then generate + compile `@naucto/api-client` into `client/dist` (what the publish workflow runs)                                                                                                             |
| `npx prisma migrate dev --name <desc>`                                              | Create + apply a dev migration from the schema                                                                                                                                                                                    |
| `npx prisma generate`                                                               | Regenerate the Prisma client                                                                                                                                                                                                      |
| `npm run seed:dev`                                                                  | Seed a local database with people, friendships, pending requests, shared game sessions, 80 days of coherent analytics up to now (`-- --no-analytics` skips them, `-- --clear-analytics` removes them), collections of the published games and a month of views, likes, comments and plays for the hub to rank on, and notifications of every kind for the bell (`-- --only notifications` writes just those). Refuses non-local hosts |
| `npm run analytics:acceptance`                                                      | Run the analytics acceptance scenarios against a scratch copy of the local database, over two connections; by hand, never in CI                                                                                                   |
| `npm run repair:release-view-keys`                                                  | Delete the release view keys once derived from readers' addresses (one-off)                                                                                                                                                       |
| `npm run migration:check -- --before <file>` / `--after <file>`                     | Fingerprint a database before the ids become UUIDs, then compare the migrated one with it by natural keys; reads only                                                                                                             |
| `npm run storage:move` (`-- --apply`, `--check`, `--purge-old`)                     | Copy the stored objects from their integer keys to their UUID keys; a dry run without a flag. `npm run storage:move:build` bundles it for the runtime image                                                                       |
| `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --watch backend` | Dev stack: Postgres, MinIO, and the API with hot reload                                                                                                                                                                           |
| `./dev.sh`                                                                          | The line above with a `build` first — the shorthand, and the usual way in                                                                                                                                                         |

**The dev container and a host build share `dist/`.** The repo is bind-mounted into the container,
which runs `nest start --watch` as root, so `dist/` on the host ends up root-owned and a subsequent
`npm run build` fails with `EACCES ... unlink dist/...`. Stop the backend service before building or
testing on the host (`docker compose ... stop backend`). Mounting a volume over `dist/` does not
help: `nest build` removes the whole directory first and cannot remove a mountpoint.

The dev stack includes **MinIO** (`:9000`, console `:9001`), because release content is fetched by
the _browser_ straight from `EDGE_ENDPOINT` — point that at a bucket the browser cannot reach and
`/play/:id` renders a black screen with "Failed to fetch". `docker-compose.dev.yml` creates the
bucket named by `S3_BUCKET_NAME` and makes it anonymously readable; set the five `S3_*` values and
`EDGE_ENDPOINT` as `.env.example` shows and a published game plays on localhost.

`config/webrtc.json` is gitignored and **required**: no WebRTC offer can be built without it.
Create it with `cp config/webrtc.example.json config/webrtc.json`.

## Architecture map

| Path                                         | Purpose                                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                                | Bootstrap: Express adapter, global `ValidationPipe`, CORS, `cookie-parser`, Swagger, request logging                                                                                                                                |
| `src/app.module.ts`                          | Root module wiring every feature module                                                                                                                                                                                             |
| `src/auth/`                                  | JWT auth, passport strategy, access control (`access/`: global guard, `@Public()`/`@RequiresAuth()`/`@RequiresRole()`, roles), project ownership guards, OAuth providers (Google/GitHub/Microsoft), refresh-token crypto            |
| `src/routes/<feature>/`                      | One folder per HTTP feature: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.error.ts`, `dto/`, co-located `*.spec.ts` (`recommendations` = what the hub puts forward: its daily shelves, hero and game of the week, see _Hub_ below) |
| `src/webrtc/`                                | `ws` + Yjs real-time multiplayer server (`server/`); `WebRTCService` allocates one port per server and advertises its public URL (see _WebSocket servers_ below)                                                                    |
| `src/routes/analytics/`                      | Usage analytics: ingest from browsers, business facts, multiplayer accounting, minute presence sampling, finalization into rollups, account history projection, purge, and the admin and user read APIs (see _Analytics_ below)     |
| `src/presence/`                              | What friends see each other doing (online, playing, building, hosting), fed by the notifications socket and by domain events (see _Presence_ below)                                                                                 |
| `src/routes/admin/`                          | The admin console's own sign-in and admin accounts: who holds the role, promoting and revoking (see _Admin console_ below)                                                                                                          |
| `src/routes/moderation/`                     | Flags from users, the case queue, staff decisions on accounts, games, comments and collections, the log of them and each account's standing (see _Moderation_ below)                                                                |
| `src/tasks/`                                 | Scheduled jobs (`@nestjs/schedule` cron)                                                                                                                                                                                            |
| `src/prisma/`                                | `PrismaService` + module                                                                                                                                                                                                            |
| `src/common/`                                | Cross-feature DTOs, decorators and pipes (pagination, signed-CDN, `@AtLeastOne`, `@IsId()`, `ParseIdPipe`), ids (`ids.ts`), `CodedException`, and the domain events (`domain-events.ts`)                                            |
| `src/config/`                                | The env registry (`env.ts`): every variable the server reads, typed, behind `getEnv` / `getOptionalEnv`                                                                                                                             |
| `src/discord/`                               | `DiscordService`: posts to any webhook, for whichever feature needs one (crashes, flags)                                                                                                                                            |
| `src/util/`                                  | Framework-agnostic helpers                                                                                                                                                                                                          |
| `src/swagger.ts`, `tool/generate-swagger.ts` | OpenAPI document build + emit                                                                                                                                                                                                       |
| `tool/`                                      | Command-line tools run by hand: the OpenAPI emit, the check of a data migration (`id-migration-check.ts`), the move of stored objects to new keys (`move-storage.ts`)                                                               |
| `prisma/`                                    | `schema.prisma` + split `models/*.prisma` + `migrations/`                                                                                                                                                                           |
| `client/`                                    | `@naucto/api-client` package: `package.json`/`tsconfig.json`/`README.md` committed, `src/`+`dist/` **generated** (gitignored)                                                                                                       |
| `config/`                                    | Runtime config read from the working directory: feature flags (`features.json`), ICE servers (`webrtc.json`, gitignored)                                                                                                            |
| `test/`                                      | Specs for the code that lives outside `src/`, and what specs share (`env.ts`, `uuid.ts`, `routes.ts`)                                                                                                                               |

**Module pattern:** every feature is a NestJS `@Module` declaring `controllers`, `providers`,
`imports`, `exports`. Keep **controllers thin** — HTTP + Swagger decorators + guards only; put
business logic in `@Injectable()` services; reach the database **only** through `PrismaService`,
and never from a controller (`layers.spec.ts` fails on one that does).

**Each layer keeps to its job**, so a rule is written once and holds for every caller:

- A service method takes ids and a shape the service declares, never the request DTO of a
  controller: a job, a socket or another service calls it too and has no HTTP body to hand over.
  `ReportsService` is the model (`NewRating`, `NewBugReport`, which its controller fills field by
  field), and `PageRequest` is a page as a service takes it. A service may answer a response DTO,
  built field by field from what it read.
- A shape that crosses a function boundary has a name: an `interface` or a type alias beside the
  function, a DTO class once it crosses HTTP. An object type written inline in a signature cannot
  be imported by the next function that needs it, so it gets copied.
- A route lives in the controller of the resource it serves, and a module is named after that
  resource (`project-comment`, not `comment`), so nobody has to look for it in two places.
- What several features need from outside (object storage, a Discord webhook) is a service of its
  own that they inject (`S3Service`, `DiscordService`), never code written again in each.
- The backend decides. A rule the web app also applies (the type and size of a file, a limit, who
  may act) is enforced here whatever the client checked, and a value every client would have to
  work out (a count, what staff may do to a target) is computed here and answered (`gameCount`,
  `allowedOperations`), so two clients cannot disagree.

**DTOs + validation:** request/response shapes are classes in `dto/`, decorated with
`class-validator` (`@IsString`, `@IsOptional`, …) and `@ApiProperty`. The global `ValidationPipe`
(`whitelist: true, forbidNonWhitelisted: true, transform: true`) **strips unknown fields and
rejects unexpected ones** — so every accepted field needs a validator decorator, or it is dropped.
Parsing, trimming and coercing are the DTO's as well (`@Type`, `@Transform`, `@IsId()`), not code
written by hand in a controller or a service: validation and the contract then read one
declaration. A value from a closed set is an enum (a Prisma enum, or a `const` array given to
both `@IsIn` and `@ApiProperty({ enum })`), never a free string checked later.

**Lists:** a list that can grow is paginated from its first version, since adding pages later
means a second route to keep beside the first. `PaginationQueryDto` carries `?page=&limit=` in (a
route with another default or cap extends it), the service takes a `PageRequest` and windows it
with `toSkipTake` (`pageWindow` on a route that corrects a bad `page` or `limit` rather than
refusing it), and the answer is the rows with `total`, `page` and `limit` (`CollectionsPageDto`).
A list answered whole is one the code bounds: an account holds 50 collections at most.

**Access control — deny by default.** One global guard (`src/auth/access/access.guard.ts`,
registered as `APP_GUARD`) decides every route from the access its handler, or failing that its
controller, declares with exactly one of four decorators (`src/auth/access/access.decorators.ts`):

- `@Public()` — anyone; a valid bearer token still sets `req.user`, a missing or bad one leaves it
  `null` and never refuses.
- `@RequiresAuth()` — any signed-in user (401 otherwise).
- `@RequiresRole(MODERATOR)` / `@RequiresRole(ADMIN)` — a signed-in user holding that role or one
  ranked above it (403 otherwise). Roles are a hierarchy, `MODERATOR` < `ADMIN`: an admin is also a
  moderator. The constants live in `src/auth/access/roles.ts` and equal the role rows the
  migrations seed.
- `@RequiresStaffSession(MODERATOR)` / `@RequiresStaffSession(ADMIN)`: the same role check, on a
  token the staff sign-in of the admin console issued (`scope: staff`). The token of a site sign-in
  gets a 401 with the code `STAFF_SESSION_REQUIRED` whatever role its account holds, and a staff
  token is refused on every other route, so neither ever stands in for the other. Every route
  under `admin/` uses it except `admin/auth`, which is how the session is opened, and
  `access-coverage.spec.ts` fails on one that does not.

**The viewer role** observes. It sits between `USER` and `MODERATOR` in rank and its reach is not
its rank: on a staff route it passes every read, whatever role the route asks of those who act
there, and no write. So it reads the statistics and the support screens a moderator does not open,
and changes nothing. The guard grants that to the role by name, so a moderator does not inherit it.
Outside the admin console a viewer is an ordinary account. Because of this rule **a `GET` under
`admin/` must never change anything**: a read that writes would be a write a viewer can make.
Nobody but an admin reads email addresses (`readsAddresses`), viewers included.

**Staff roles are handed out by an admin** through `PUT admin/accounts/:id/role`, and
`GET admin/accounts/staff` lists whoever holds one (`STAFF_ROLE_NAMES`). A change is written to the
moderation log as `ROLE_CHANGED` in the transaction of the change, with the role left and the role
taken in its internal note. Giving an account the role it already holds writes nothing.

**Suspension** is decided by the same guard, from the two `suspended*` columns read through
`currentSuspension` (`src/auth/access/suspension.ts`), which also lets a dated suspension lapse
without anything clearing it. A suspended account signs in and reads. Every write that asks for an
account answers it 403 with the code `ACCOUNT_SUSPENDED`, unless its handler carries
`@AllowedWhileSuspended()`, and it holds no role at all, staff routes included. A new write is
therefore closed to suspended accounts by default. Opening one means adding the decorator and the
handler to the list in `access-coverage.spec.ts`, which fails until both agree.

A route that declares nothing is treated as `@RequiresRole(ADMIN)`, and `access-coverage.spec.ts`
fails on it anyway: every route states who may call it. Handler metadata overrides the
controller's, so a `@RequiresAuth()` controller can open single routes with `@Public()`. The
decorators carry the Swagger security annotations — don't add `@ApiBearerAuth` by hand.
Ownership checks stay per route: `@UseGuards(ProjectCollaboratorGuard)` /
`@UseGuards(ProjectCreatorGuard)` run after the global guard, so `req.user` is set. Reuse these —
don't re-implement.

**WebSocket servers:** three `WebRTCServer`s run next to the HTTP API, each on its own port
(sequential from `BACKEND_WEBRTC_PORT_BASE`, default 10000) and with a stable public name
(`WEBRTC_SERVER_NAMES`): `collab` (Yjs collaboration, `WorkSessionService`), `game` (multiplayer
game table, `MultiplayerService`), `user` (per-user notifications, `NotificationsService`).
Clients never guess the address — they fetch an offer whose signaling URL comes from
`WebRTCService.buildSignalingUrl`:

- **Local dev** (`BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE` unset): `ws://{BACKEND_WEBRTC_HOSTNAME}:{port}`
  (`wss://` when the hostname isn't `localhost`), so the compose files publish the port range.
- **Production**: set `BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE=wss://{name}.ws.beta.naucto.net` and map one
  domain per server in Production-Environment/Willy (`collab.ws.beta.naucto.net → backend:10000`,
  `game.ws… → :10001`, `user.ws… → :10002`; Willy issues the certificates). `{port}` is also
  substituted if a template needs it. Adding a server = adding a name to `WEBRTC_SERVER_NAMES`,
  defaulting it in the server's options class, and mapping one more domain.

**Errors:** from services, prefer Nest's built-in `HttpException` subclasses
(`NotFoundException`, `ForbiddenException`, `BadRequestException`, …) — they map to status codes
automatically. Domain errors are small classes in `*.error.ts`; translate them to HTTP responses
at the controller boundary (see `project-content.controller.ts` catching
`S3ObjectNotFoundException`). A bare `Error` is refused by lint under `src/`: nothing can tell
it from any other.

- **An exception raised from a `catch` carries what was caught as its `cause`**
  (`new NotFoundException('File not found', { cause: error })`; the S3 exceptions take it as an
  argument), so the log of a failure still shows where it began.
- **No `catch` makes an error disappear.** One wraps the single call whose failure it expects (a
  URL that does not parse, a token that does not verify, a unique key already taken), says what
  that failure means, and rethrows everything else. Around a block of logic it hides the bugs
  inside it. An unexpected error is left to reach `CrashCaptureFilter`, which records it: a
  `catch` that only logs and rethrows adds nothing.
- **A refusal a client answers differently is a `code`** beside the message, and the code is
  part of the contract: an enum in a response DTO the route documents with `@ApiResponse`
  (`ProjectHiddenDto`, `CollectionLimitDto`), which the exception's body `satisfies`
  (`project.error.ts`, `collection.error.ts`). A code named only in a description reaches the
  generated client as prose, and the frontend then branches on a string nothing checks.

**Ids** — every row is named by a UUID the database draws
(`@default(dbgenerated("uuidv7()")) @db.Uuid`), and every column that names a row is a
`@db.Uuid`. It draws a version 7, which begins with the time: ids follow the order rows are made
in, so a tiebreak by id after a date falls in creation order and an index fills at its end. That
order is a property of the key, and nothing an answer relies on:

- **An id is opaque.** It is never ordered to mean older or newer, and never computed on. Order by a
  date, with the id as a tiebreak after it at most. Where two ids need a stable order (the pair of a
  friendship, a tiebreak in memory), `compareIds` (`src/common/ids.ts`) orders them as Postgres
  orders `uuid`; `localeCompare` and subtraction do not.
- **An id from a request is lower-cased where it enters**: a route parameter through
  `ParseIdPipe`, a body or query field through `@IsId()` (with `@IsArray()` for a list), anything
  parsed by hand through `isUUID` and `toLowerCase()`. A UUID reads the same in either case and the
  database answers lower case, so an id left as typed names a row without being `===` to the id
  read from it, and a check such as "not your own account" would let it through.
- **Three integers remain.** `User.playerNumber` is what a game reads as `net.id()`, and published
  games compute on it: it appears in the `playerId` of a game-table connection, in the `playerId`
  of each player of `GET /game-sessions/:sessionId/players`, which is how a client tells whose
  account a number at the table is, in the game-table ticket and in the game-table messages (`to`,
  `from`, `userId`), and nowhere else, never in an account, a profile or the roster of a session
  answer. The synthetic player of an editor self-join is such a number with no account behind it.
  `Project.legacyId` is the number a project had while ids were integers,
  null for any project created since, read only by `GET /projects/legacy/:number`, which
  translates an old public link into the id. A project row is answered as it stands, so every
  query that reads a whole one leaves the number in the database (`omit: WITHOUT_LEGACY_ID`,
  `project-select.ts`). `AnalyticsFact.id` is the sequence of the journal and
  is never handed out.
- **"No game" is the nil UUID** where a release id is part of a primary key
  (`AnalyticsAnonTally`, `AnalyticsUserDaily`), since a key cannot hold a null. It is written once,
  as `NO_RELEASE_ID` in `src/common/ids.ts`; raw SQL takes it as a parameter, and
  `test/ids.spec.ts` fails if a schema default spells anything else.
- **Raw SQL is not type-checked**: cast an id parameter (`${id}::uuid`, `::uuid[]`). Postgres has no
  `max(uuid)` or `min(uuid)`; go through `::text`.
- **A column without a foreign key outlives its row**: the release ids of analytics, the target of a
  flag or of a moderation action, the game of a report. Such an id may name nothing.
- **An answer names such a row by its id with, beside it, a name that is `null` once the row is
  gone** (`AnalyticsPlayedGameDto`). The server builds no label out of an id: a UUID is not a
  name, and what to show for a game without one is the client's to choose.
- In the contract an id is a `string` with `format: uuid` (`@ApiProperty({ format: 'uuid' })`,
  `@ApiParam({ name: 'id', type: String, format: 'uuid' })`). In a spec it is `uuidOf(n)` from
  `test/uuid.ts`.
- `LegacyIdMap` says which UUID each integer id became. It is temporary: `tool/move-storage.ts`
  reads it to copy the stored objects to their new keys, and it goes once the old keys are purged.
  Nothing else may read it.

**Analytics** (`src/routes/analytics/`), behind the `analytics` flag of `config/features.json`:

- `analytics-metrics.ts` is the single source of every KPI: who it counts, how its values combine,
  when a period of it becomes final, and its version. Change a definition by bumping its version;
  values of different versions are never combined, and final periods are never recomputed.
- Browsers that consented report under a visitor and a session cookie the frontend sets; the API
  never reads them. Tabs that declined send identifier-free pings, tallied per minute. A ping says
  whether the tab refused analytics or has not answered yet (`AnalyticsAnonTally.consent`). One
  that does not say, from an older client or a suspended account, is tallied as `UNKNOWN`. Ingest
  routes take JSON sent as text/plain without credentials and never read an account; linking a
  browser to an account is the one authenticated call.
- Business facts (signups, projects, release transitions) are written in the transaction of the
  operation they record, keyed per transition, never by an account id. Multiplayer is accounted
  from the game room server through `SyncedGameTableObserver`.
- Identities are coordinated by transaction-scoped advisory locks (`identity-locks.ts`), always
  taken in the order purge gate, account, visitors. Any new writer that can reach an account's
  analytics must take them; erasure relies on it.
- Every day is a UTC day. Raw data is kept 90 days and purged only once every period built from
  it is final and every linked account's history has it; rollups and account histories stay.
- A breakdown and the games ranking span any range of days, not one calendar period. A count or a
  peak is combined from its days, final or computed. A distinct count such as `players` is computed
  once over the range from raw data, since its days cannot be added, and has no value for a range
  reaching before the raw window. Days whose values are gone are left out and counted in
  `missingDays`.
- The timeline (`analytics-timeline.ts`, `analytics-timeline.readers.ts`,
  `analytics-timeline.service.ts`) reads raw rows between two instants, in buckets of a minute to a
  day, and never rollups. Its window is the raw retention and its values are never final. A bucket
  before the raw window or after now has no value. A presence bucket without a sample has none
  either, rather than a 0. Each timeline metric declares the filters it is split by (a game, a
  source) and ignores the others, and the answer names what it ignored. Readers go through the Prisma
  client and answer plain samples, which the service puts in buckets.
- A source is the session's `referrer:<domain>`, `utmSource:<value>` or `utmCampaign:<value>`, with
  `referrer:(none)` for a direct visit. Visitor metrics take the source of the visitor's first
  session, and accounts the source of their linked visitor.
- `activity` and `arrivals` show consenting browsers one by one under a journey code: an HMAC of the
  visitor id under a key drawn at boot. It is the same in every answer while the backend runs and
  never reveals the cookie. They name no account.
- Markers (`AnalyticsMarker`, `admin/analytics/markers`) are moments admins draw on the charts,
  such as a post going out. Each says who it speaks to (`EVERYONE`, `PLAYERS`, `CREATORS`) and
  may name a published project: the game to play, or for creators the game to fork. They hold no
  visitor or account data and are never purged.
- `admin/analytics/releases` searches published games by name or id a few at a time, and names
  projects by id. Nothing in the admin API hands out every game at once.
- `projects_forked` reads forks from `Project.forkedFromId`, which every fork path records with
  its `PROJECT_CREATED` fact. A fork deleted since is no longer counted.

**Admin console** (`src/routes/admin/`), for the separate Admin-Panel app:

- `admin/auth/*` signs a staff member in with a password and an account holding the moderator or
  the admin role, not suspended. It answers an access token scoped to staff and sets the httpOnly
  `naucto_admin_session` cookie that renews it for eight hours; that cookie is signed with a key of
  its own, so it never verifies as a bearer token. The account is read again at each renewal, so a
  role change or a suspension takes effect within the fifteen minutes an access token lives.
- A moderator signs in to the same console and opens only the routes that ask for the moderator
  role. An account that signs in with Google, GitHub or Microsoft alone has no password to give
  here and needs to set one first.
- Wrong passwords per address are limited in memory (`attempt-limiter.ts`), which holds while the
  backend runs as one instance.
- An admin cannot change their own role, and the last admin cannot be demoted.

**Presence** (`src/presence/`), what friends see each other doing:

- A user is online while one of their notifications sockets is open, and each socket declares its
  own activity; the latest PLAYING of any socket wins. HOSTING and BUILDING are never taken from a
  client: they are derived from the live game session and the work session in the database.
- The state is held in memory, which holds while the backend runs as one instance.
- **Any write that changes what a friend would see emits an event of
  `src/common/domain-events.ts`** after its transaction commits: `ACTIVITY_CHANGED` for game and
  work sessions, `FRIENDSHIP_CHANGED` for friendships, `PROJECT_CHANGED` for a project's name,
  cover or release. `PresenceService` listens with `@OnEvent`. A writer that forgets is caught by
  the background resync, but only up to two minutes later.
- The resync re-derives whoever nobody refreshed for two minutes, in batches sized to the number
  of users online and capped so it never crowds out real queries. Friends are told only what
  actually changed.
- A work session is swept once nobody has saved into it for ten minutes **and** its collaboration
  room is empty, so an editor left open is never dropped.

**Reports** (`src/routes/reports/`):

- Ratings, bug reports and crashes are all one `Report` row, told apart by `kind`. The fields of the
  other kinds stay null, and every kind shares the status, the note of the team and the admin
  routes under `/admin/reports`.
- A rating is 1 to 10 with optional "liked" and "improve" comments, plus reasons under 5. It needs
  an account, and the person says in the form whether they mostly play or mostly create (`role`).
- The rating prompt asks an account once. An answer or a refusal ends it, and "not now" snoozes it
  14 days. `FeedbackPrompt` holds that state, and no row means never shown.
- A bug report needs an account and arrives as JSON, with a context the page listed to the person
  first (viewport, language, engine error, console). Its screenshot follows on
  `PUT /reports/bugs/:id/screenshot`, from the same account within the hour: PNG, JPEG or WebP,
  2 MB, checked by type and content. It is stored under `reports/<id>/` and **never made
  public-read**. The admin console streams it through `GET /admin/reports/:id/screenshot`. The dev
  bucket is anonymously readable as a whole, so this only holds in a deployed bucket.
- Deleting an account deletes its screenshots, then clears the key of each file that went. A key
  left on a report of a deleted account is a screenshot still to remove.
- A crash names no one: `POST /reports/crash` takes text/plain JSON like the analytics ingest,
  never reads an account, and keeps only the families of the user agent. Before anything is stored,
  `crash-scrub.ts` takes out emails, tokens, URL queries and the username of a profile path. The
  rest of a message is kept as sent because a fix needs it, so treat crash text as possibly
  personal anyway.
- One report per crash: occurrences with the same source, error name and normalised message
  (`crash-group.ts`) land on one row and bump its count, with the latest 20 kept as
  `ReportOccurrence`. The source keeps a public browser report out of a backend crash that reads
  the same. The stack plays no part, so a crash keeps its report across deploys. A
  resolved crash that comes back is set to NEW again as a regression.
- `StackResolver` maps a stack of the web app back to its sources through the hidden source maps
  the production build publishes next to each bundle. It only fetches from the origin of
  `FRONTEND_URL`, so a public report cannot make the backend fetch anything else, and a stack it
  cannot map is kept as it came. A stack may name at most 8 bundles, at most 20 maps are fetched a
  minute, and a missing map is remembered apart from the real ones, so made-up names in public
  reports cannot keep the backend fetching or push the real maps out of the cache.
- Browser reports open at most 100 new crashes an hour (counted in memory, one instance), so
  varying a message cannot flood the table. Known crashes and backend crashes always count. A daily
  job deletes resolved and ignored crashes after 90 days without an occurrence, and new ones seen
  only once after 30.
- `CrashCaptureFilter` (global `APP_FILTER`) records every request that fails with a 500 or an
  unknown error, named by its route pattern, then answers as Nest would. A scoped filter that
  swallows errors (`MultiplayerExceptionFilter`) records them itself.
- `DiscordService` (`src/discord/`) posts to any webhook, mentions no one, keeps under Discord's
  rate limit and never throws. `CrashNotifier` uses it to post a crash to
  `DISCORD_CRASH_WEBHOOK_URL` when it is new, comes back after being resolved, or reaches 10, 100,
  1000 or 10000 occurrences.

**Moderation** (`src/routes/moderation/`), behind the `moderation` flag of `config/features.json`
on the client side only: the routes answer whatever the flag says.

- "Report" already names feedback (`src/routes/reports/`), so what a person reports about a game, a
  comment, a collection or a profile is a **flag**. The flags on one target read as one **case**,
  which is what the admin console queues.
- A kind of target exists in the places that branch on it and nowhere else: its reader in
  `ModerationTargetService`, its entry in `FLAGGABLE` and in the nouns of `FlagNotifier`, its
  decisions in `ContentModerationService` with their admin controller, and its action types in
  `VISIBLE_TO_SUBJECT`. The case queue, `allowedOperations`, the log and the standing read any
  target through `TargetView` and name no kind.
- Every decision is one `ModerationAction` row, written by `ModerationLogService.record` in the
  transaction of the change it records. A row is never updated or deleted, with one exception in
  that service: erasing an account takes the copies the record kept of what the person wrote.
  `moderation-log.append-only.spec.ts` fails on any other.
- Whether the account a decision bears on sees it in its standing is decided per kind of action
  (`VISIBLE_TO_SUBJECT`), never by a caller. The standing never carries who decided, the staff
  note, or who reported.
- Decisions are taken through `/admin/moderation/*`, so with a staff session only. Moderators hide,
  restore, warn, suspend, reinstate and clear profiles. Deleting for good is an admin's.
  `allowedOperations` holds those rules once, and the admin console draws its buttons from what it
  answers. Staff act only on accounts ranked below their own role, and never on their own account
  or content.
- A hidden comment keeps its text stored and is served as a tombstone by the one mapper of the
  comment service. A hidden game keeps `publishedAt`, and `PUBLISHED` (`project-select.ts`) now
  means released and not hidden: read the published state through it, or through `RELEASED` for an
  owner's own shelf, never from `publishedAt` alone.
- The storage layer cannot take a public grant back, so hiding a game moves its release, its cover
  and its clip to `withheld/<id>/`. Copy first, mark the row, then remove the served copies: a
  failure midway leaves a copy too many, and `repair:publish-state` removes it. The row names
  neither the cover nor the clip meanwhile, and a restore writes both back. The admin console
  reads both from wherever they sit (`admin/moderation/projects/:id/cover` and `/clip`).
- A hidden collection keeps its row as it was, with `hiddenAt` set: nothing of it is stored apart.
  Who then reads it is decided in `CollectionsService` (see _Collections_). A private collection
  stands as `UNPUBLISHED`, as a game nobody released does: it cannot be flagged, and staff still
  decide about one that was flagged before its owner made it private.
- Staff have no directory of collections. They reach one through the case its flags opened, which
  shows its title, its description, its owner, who may read it and the games it lists.
- Clearing a profile bears on the account's own fields: its comments, its games and its collections
  stay, each moderated on its own. Erasing an account deletes its collections, and the flags on
  them stay without the words they kept.
- Staff read any game through `/moderation/projects/:id/preview`, with the token of a site sign-in
  because the web app shows it: its editor loads read-only for staff who do not collaborate on the
  game, published or not, hidden or not. `siteUrls.edit` is the one address of a game a moderation
  answer hands out for that (`editUrl`). Those routes write nothing but one log row per look.
- Moderators never read email addresses: `toAccountRef` gives one to admins only.
- Anything a person writes that someone else can read comes with its moderation: a kind of target
  staff can be told about, hide, restore and delete (the places listed above), and a fate when
  its author's account is erased, decided in `USER_RELATION_FATES` (`account-deletion.service.ts`),
  which does not compile while a relation of `User` has none. Collections show all of it.

**Hub** (`src/routes/recommendations/`), what the hub puts forward:

- The hub is drawn once per UTC day and kept as one `HubSnapshot` row of project and collection
  ids: at 00:05 UTC, at start, and on the first request of a day that has no row. Only the whole
  days before the one computed are read, so computing a day again writes the same row. Rows are
  kept 60 days.
- `hub-scoring.ts` holds every formula as a pure function and `hub-snapshot.ts` composes a day from
  them. A draw is seeded by the day and the shelf (`draw`), never by `Math.random`, so a spec with
  a fixed day sees the shelves a visitor would.
- "On the hub" is one test, `PUBLISHED` in `project-select.ts` (`PUBLISHED_SQL` in a raw query).
  **A hub query that spells the test itself misses the next condition added there.**
- A comment that counts is one test as well, `LIVE_COMMENT` (`LIVE_COMMENT_SQL` in a raw query):
  neither deleted by its author nor hidden by moderation.
- The same run picks the game of the week, once per UTC week: the best trending game that was not
  picked in the last eight weeks. Nobody picks by hand; `FeaturedRelease` keeps the history. A
  pick whose game moderation withholds ends the next time it is read.
- One computation of a day runs at a time (held in memory, one instance): two at once would each
  pick a game of the week.
- Nothing personal is stored in a snapshot. "Continue", "your friends play" and "because you
  played" are read per request, from `AnalyticsUserDaily` (rows exist only for an account whose
  browser consented to analytics) and from the presence friends already see. "Continue" is the
  reader's own project, so it may be one moderation withholds: its card then carries `hiddenAt`,
  which is null on every other card.
- A card is a `HubGameDto`, built field by field by `toHubGame`: spreading a project row would hand
  out its content size and release hash. Its `coverUrl` and `clipUrl` come from the row
  (`Project.coverVersion`, `Project.clipVersion`, written at upload); a list never asks the store
  about a cover or a clip.
- How a game is drawn is live, not released: the cover, the clip (`POST`/`DELETE
  /projects/:id/clip`, WebM or MP4 by declared type and by content, 4 MiB, public-read) and the
  disk style (`PATCH /projects/:id/disk`) change the moment a collaborator sets them, take no part
  in the release hash, and reach every answer through `ProjectService.lookOf`. A disk colour is any
  `#rrggbb`; no style means the client derives a colour from the project id. A withheld game takes
  no new cover, clip or disk and does not give its clip up (`PROJECT_HIDDEN`), and a suspended
  account sets none of the three.
- `Project.palette` mirrors the palette of the game's content, written by the editor through
  `PUT /projects/:id` as the name and the tags are, so a client can draw with the game's colours
  without the engine. It is live as well, travels with project and release answers but not with
  hub cards, and a fork starts with its source's.

**Collections** (`src/routes/collections/`), a person's lists of games:

- Who reads one is decided in `CollectionsService` alone: `PUBLIC` by anyone, `UNLISTED` by whoever
  holds its id, `PRIVATE` by its owner. A private one answers anyone else 404, as an id that names
  nothing does, and only the owner writes. The random bits of its id are all that keep an
  unlisted collection from being guessed.
- One moderation withholds (`Collection.hiddenAt`) is read by its owner alone, whatever its
  visibility: it answers anyone else 404, and leaves the public list, the hub's shelf and its
  owner's profile (`STANDING`, which `LISTED` includes). Its owner reads it with `hiddenAt` set,
  deletes it and removes games from it. Every other change of theirs (title, description,
  visibility, a game added, the order) answers 403 with the code `COLLECTION_HIDDEN`, so a restore
  puts back what staff withheld.
- A game is added only while it is on the hub (`PUBLISHED`), and shows only while it is. Its row
  stays when it leaves, unpublished by its author or withheld by moderation, so the owner is told
  it is unavailable (`unavailableGameIds`) and can remove it, and it comes back in place once it
  is on the hub again. `gameCount` and the previews count the games on the hub; the 200 limit
  counts every row. Adding a game moderation withholds answers `PROJECT_HIDDEN` to who works on
  that game and 404 to anyone else.
- Deleting a project or a collection takes its rows by foreign key. An account is soft-deleted, so
  `AccountDeletionService` deletes its collections itself, whether the person or an admin erases
  the account.
- A suspended account changes none of its collections, removals included: no route here carries
  `@AllowedWhileSuspended()`. What it listed stays readable.
- The public list (`GET /collections`) holds the public collections with at least one game on the
  hub. The hub's shelf of them is drawn with the day (`composeSnapshot`): three games on the hub
  at least, weighted by the activity of those games, one per owner. Its "see all" is the public
  list, not a shelf route.

## Conventions (not all enforced by tooling — follow these)

These complement the lint/TS rules (which you should read from the config files, not restate).

**Imports** — relative paths (`./x`, `../auth/auth.service`); the project has no path aliases.
`@prisma/client`, `@nestjs/*`, `@aws-sdk/*`, `@tygra/*` are npm packages. No file extensions.
Ordering is `simple-import-sort`'s, applied by `npm run lint`.

**Naming** — no one-letter names (`id-length`) beyond indexes `i`/`j`/`k`, coordinates `x`/`y`,
a comparator's `a`/`b`, an ignored `_` and the `Y` namespace of Yjs: `error`, not `e`;
`project`, not `p`. A method, a type or a file is named for what it is or does (`findAll`,
`search`), never for who calls it (`…ForModeration`, `…ForAdmin`): the second caller would make
the name false. A value of the contract is a word a reader understands without the code
(`CONSENTED`, not `C`). A number or a string that means something is a named constant, in
`UPPER_SNAKE_CASE` at the top of its module.

**Comments** — in English, and about why: a constraint, an invariant, what a caller may rely on.
One that restates the line under it, or tells how the code came to be, is removed. The same holds
for what the contract shows: a Swagger summary says what the route does for its caller, and an
`example` is a value the field could really hold.

**Formatting** — Prettier owns it (`npm run format`), with the same `.prettierrc` as the
Frontend; ESLint only adds `curly: all`, so every `if`/`for` body is a braced block. Use the
`private` keyword, never `#private` fields.

**TypeScript** — the config is **very strict** (`strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noUnusedLocals`/`noUnusedParameters`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, …). Practical consequences:

- Mark overrides with `override` (e.g. a guard's `canActivate`).
- Indexed access can be `undefined` — narrow it; don't assume.
- No unused locals/params. `any` is discouraged (typescript-eslint warns) — prefer real types
  or `unknown`. **Don't loosen `tsconfig.json` to silence an error.**

**Return types** — explicit function return types are **required** (`explicit-function-return-type`),
including `Promise<T>` and `void`.

**Configuration** — read environment variables with `getEnv(key)` (throws when unset) or
`getOptionalEnv(key, fallback)` from `src/config/env.ts`; the key is typed and the value comes back
parsed (numbers, flags). A new variable is declared in that registry and in `.env.example`
(`env.spec.ts` fails on one the example leaves out). Read it where the class is built, in a field
initializer or the constructor, so an unset variable stops the boot rather than the first request
that needs it. What a development setup can run without (an OAuth provider, a Discord webhook,
the GeoIP database) is read with `getOptionalEnv` and turns itself off when unset, so nobody
needs a third party's key to start the server. Nothing that differs between two environments is
written in the code. Specs set values with `withEnv({...})` from `test/env.ts`, restored after
each test.

**Logging** — use Nest's `Logger` (`private readonly logger = new Logger(MyClass.name)`).
`console.*` trips `no-console` (warn) — avoid it in app code (`prisma/` seeds and `tool/` scripts
are exempted in `eslint.config.mjs`).

**Files & folders**

- **Folder names are `kebab-case`** (`work-session/`, `project-comment/`).
- Files follow Nest's dot-suffix convention: `project.controller.ts`, `create-project.dto.ts`,
  `project.service.spec.ts`, `project.error.ts`. Classes are `PascalCase`.
- Keep one clear responsibility per file; split as features grow.

**TODO / FIXME** — reference a Jira ticket: `// TODO(NCTO-123): …`.

**Testing** — unit tests are co-located `*.spec.ts` using `@nestjs/testing`
(`Test.createTestingModule`) with mocked providers (`useValue`). Add or extend specs for new
services, controllers, and business logic. Specs for code outside `src/` go in `test/`.

A rule about the structure of the code is a spec that fails when the rule is broken, rather than
a sentence here: `access-coverage.spec.ts` (every route states who may call it),
`contract-coverage.spec.ts` (every route has a summary, a tag and a declared answer),
`layers.spec.ts` (no controller reaches the database), `moderation-log.append-only.spec.ts`,
`account-deletion.service.spec.ts` (every relation of `User` has a fate when the account is
erased), `test/ids.spec.ts`. When one fails, what it lists is a decision to take, not a line to
edit until it passes.

**Database / Prisma** — edit the schema in `prisma/models/*.prisma`, then create a migration
with `npx prisma migrate dev --name <desc>` and run `npx prisma generate`. A migration that only
changes the schema stays as Prisma generated it. One that has to move, backfill or rewrite rows is
created with `--create-only` and its SQL written by hand: the skill `naucto-data-migration`
(`.claude/skills/`) is the method. **Never edit a migration that has been merged**: a deployed
database has already run it. Access the DB only via `PrismaService`.

Development data has one way in, `npm run seed:dev` (`prisma/seed-dev.ts`). What a new feature
needs in order to be tried locally is added there, or in a `seed-dev-<part>.ts` it calls, never
as a script of its own that the next person has to know about.

**Commits / branches** — see `CONTRIBUTING.md` (branch = Jira key; commit = `[PART] [TYPE] Message`).

## Security

See `SECURITY.md` for the disclosure policy. Rules for agents and contributors:

- **No secrets in code or git.** All config comes from env (`.env`, gitignored) read via
  `getEnv` / `getOptionalEnv`. Never commit `.env`, `*.pem` (CloudFront keys), or real keys/tokens — even in
  tests or fixtures. `.env.example` documents the variable names; the only values it carries are
  the local MinIO defaults.
- **Validate all input.** Every controller input is a DTO with `class-validator` decorators and
  the global `ValidationPipe` rejects unknown fields — don't bypass it with an untyped `@Body()`
  or by disabling `whitelist`/`forbidNonWhitelisted`. A check the web app already makes is made
  again here: the API is called by more than the web app.
- **Auth/secrets handling.** Access tokens are JWT bearer tokens (`passport-jwt`); refresh tokens
  are encrypted (AES-256-GCM, `auth/refresh-cookie.crypto.ts`) and delivered as httpOnly cookies;
  passwords are hashed with `bcryptjs`. Don't log tokens/passwords, never return password hashes
  (use response DTOs / Prisma `select`), and keep routes behind access control — `@Public()` must be a
  deliberate choice.
- **Database.** Use Prisma's query builder. Where it cannot say the query (the analytics
  rollups, the hub's ranking, an advisory lock), write a tagged `$queryRaw` / `$executeRaw` or
  `Prisma.sql`, which send every value as a parameter; `Prisma.raw` takes a constant of the code
  and nothing a request carries. `$queryRawUnsafe` and `$executeRawUnsafe` are refused by lint
  under `src/`.
- **A limit or a uniqueness is held by the write itself**: a unique key, a conditional update
  whose count says who won, or the read and the write under one lock. A count read before the
  write lets every parallel request through.
- **What a request can make the server do is bounded.** A public write carries a `@Throttle` per
  identity, as the analytics ingest and the crash report do, and so does a write an account can
  repeat at will (a flag, a rating, a bug report). Whatever a body can make the server fetch,
  loop over or store is capped (`StackResolver`).
- **CORS** is locked to `FRONTEND_URL` with credentials — don't widen it to `*`.
- **File uploads** go through `ParseFilePipeBuilder` (size/type validators). Keep limits and
  allowed types when adding upload endpoints.
- **Never disable a security-related lint rule or type check** to silence a warning — fix the
  underlying issue or ask.

## Gotchas

- **`swagger.json`, `client/src` and `client/dist` are generated and gitignored — never hand-edit
  them.** `npm run generate:swagger` boots the app to read the `@nestjs/swagger` decorators;
  `npm run client:build` runs it, then `@hey-api/openapi-ts` + `tsc`, and builds
  the client that `.github/workflows/api-client.yml` publishes to GitHub Packages (tags
  `api-client/vX.Y.Z` → `latest`, `main` → `next`, PRs → `pr-N`). Bump `client/package.json`
  `version` when the contract changes. The API contract is defined by controllers + DTOs + Swagger
  decorators; the frontend consumes `@naucto/api-client`. **Annotate new/changed endpoints**
  (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, typed DTOs) or the generated client will be wrong;
  `contract-coverage.spec.ts` fails on a route that has no summary, tag or declared answer.
- Swagger generation runs with a **stubbed env** (`tool/generate-swagger.ts`) so it works without
  real secrets. If generation breaks after adding a module that reads new env at construction
  time, add a stub there.
- The Prisma schema is **split** across `prisma/schema.prisma` + `prisma/models/*.prisma`. Edit
  the model files; let Prisma generate the migrations, except one that moves data (see _Database /
  Prisma_).
- The dev container applies pending migrations each time it starts (`prisma migrate deploy` over
  the bind-mounted tree), so starting it on a branch that carries a new migration migrates the
  local database.
- `npm run lint` runs ESLint with `--fix` (it **modifies files**); the pre-commit hook only lints
  staged files — still run typecheck / build / test yourself before pushing.
- Country lookups read an IP-to-country database in MMDB format from `GEOIP_DB_PATH`. Mount it;
  never bake it into the image or commit it. DB-IP Lite (CC BY 4.0) needs the credit the privacy
  page gives. Without the file, every country is unknown.
- The text/plain body parser of the analytics routes is mounted under its own function name: Nest
  skips its own JSON parser when a middleware named `jsonParser` is already mounted, which a bare
  `express.json()` is, and every JSON body then arrives empty.

## Known incoherencies (being addressed in later phases — don't "fix" ad-hoc)

These are tracked cleanups; avoid partial migrations that make them worse.

- **Data model:** `prisma/models/user.prisma` carries a `// FIXME` to rename the
  `workSession`/`hostingSession` relations to `joined*`/`hosting*` after a merge.
- **Not every file follows the rules above yet**, and those that do not are not a model: service
  methods that take the request DTO of their controller (analytics, moderation, project,
  collections), object types spelled inline in a signature, `catch` blocks that raise without a
  `cause`, the codes of moderation and of the access guard (`MODERATION_ERROR`,
  `ACCOUNT_SUSPENDED`, `STAFF_SESSION_REQUIRED`) that no response DTO declares, the friends list
  and the profile shelves answered as bare arrays, `EDGE_ENDPOINT` and `S3_BUCKET_NAME` read on
  first use, the two counts of a collection read before the write, the sign-in routes without a
  throttle, and the `:sessionId` of the game-session routes taken without `ParseIdPipe`. Follow
  the rule in new code; converting one of these is a change of its own.
