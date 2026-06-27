# AGENTS.md

Guidance for AI agents and contributors working in the Naucto Backend. This is a **working
guide, not a rigid rulebook** — the config files are the source of truth for enforced rules;
this file documents the intent, conventions, and gotchas that tooling can't capture.

> Compatible with Claude Code (via `CLAUDE.md` → `@AGENTS.md`) and OpenCode (native `AGENTS.md`).

## Overview

Naucto Backend is a **NestJS 11 + Prisma 7 + TypeScript** REST/WebSocket API for a
collaborative, multiplayer game editor. It uses PostgreSQL (via the Prisma `pg` adapter), JWT
auth (`passport-jwt`) with encrypted refresh-token cookies and Google/GitHub/Microsoft OAuth,
AWS S3 + CloudFront for game/asset storage and signed delivery, and a `ws` + Yjs (CRDT) server
for real-time multiplayer editing. The HTTP API is documented with `@nestjs/swagger`, and its
OpenAPI spec is the **contract the Frontend's generated client consumes**. The dev server runs
on `http://localhost:3000`; the frontend runs on `http://localhost:3001`.

## How to work in this repo

1. **Explore and reuse before writing.** Look for existing services, guards, DTOs, decorators,
   and common helpers first. A feature is a NestJS module — study an existing one end-to-end
   (`src/routes/project/`) and match its shape.
2. **The config files are the rule authority** — don't rely on memory for style rules:
   - `eslint.config.mjs` — lint + formatting rules (indent, quotes, semicolons, explicit return
     types, etc.). **The linter is the source of truth for formatting.**
   - `tsconfig.json` — (very) strict TypeScript settings and path aliases.
   - `.prettierrc` — Prettier formatting.
   - `package.json` — available scripts and dependencies.
3. **Run the feedback loop before finishing:** `npm run lint`, `npm run build`, and
   `npm run test`. CI (`.github/workflows/jest.yml`) runs the build + tests against a real
   Postgres on every push/PR to `main` and must pass.
4. **Ask the user when a decision is non-obvious** — especially architectural ones (new
   dependencies, schema/migration changes, cross-cutting structure). Prefer asking over assuming.
5. **Never hand-edit generated code** — `swagger.json`, `generated_client/`, and
   `prisma/migrations/` are generated (see Gotchas).

## Commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | Start Nest in watch mode on `localhost:3000` |
| `npm run build` | Compile with `nest build` (strict `tsc`) |
| `npm run start:prod` | Run the compiled server (`node dist/main`) |
| `npm run lint` | ESLint over `src/`, `test/` — **note: runs with `--fix` (mutates files)** |
| `npm run format` | Prettier-format `src/` and `test/` |
| `npm run test` | Unit tests (Jest, co-located `*.spec.ts`) |
| `npm run test:cov` | Unit tests with coverage |
| `npm run test:e2e` | e2e tests (`test/jest-e2e.json`) |
| `npm run generate:swagger` | Boot the app and emit `swagger.json` from the Swagger decorators |
| `npm run generate:client` | Generate the typed API client into `generated_client/` |
| `npx prisma migrate dev --name <desc>` | Create + apply a dev migration from the schema |
| `npx prisma generate` | Regenerate the Prisma client |

## Architecture map

| Path | Purpose |
|---|---|
| `src/main.ts` | Bootstrap: Express adapter, global `ValidationPipe`, CORS, `cookie-parser`, Swagger, request logging |
| `src/app.module.ts` | Root module wiring every feature module |
| `src/auth/` | JWT auth, passport strategy, guards, `@Public()`/`@Roles()` decorators, OAuth providers (Google/GitHub/Microsoft), refresh-token crypto |
| `src/routes/<feature>/` | One folder per HTTP feature: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.error.ts`, `dto/`, `entities/`, co-located `*.spec.ts` |
| `src/routes/{user,project,project-comment,work-session,multiplayer,s3}/` | The feature areas |
| `src/webrtc/` | `ws` + Yjs real-time multiplayer server (`server/`) |
| `src/tasks/` | Scheduled jobs (`@nestjs/schedule` cron) |
| `src/prisma/` | `PrismaService` + module (the `@ourPrisma` alias) |
| `src/common/` | Cross-feature DTOs + decorators (pagination, signed-CDN, `@AtLeastOne`) |
| `src/util/` | Framework-agnostic helpers |
| `src/swagger.ts`, `tool/generate-swagger.ts` | OpenAPI document build + emit |
| `prisma/` | `schema.prisma` + split `models/*.prisma` + `migrations/` |
| `generated_client/` | **Generated** typed API client — gitignored, do not edit |
| `config/`, `test/` | WebRTC runtime config; e2e Jest config |

**Module pattern:** every feature is a NestJS `@Module` declaring `controllers`, `providers`,
`imports`, `exports`. Keep **controllers thin** — HTTP + Swagger decorators + guards only; put
business logic in `@Injectable()` services; reach the database **only** through `PrismaService`.

**DTOs + validation:** request/response shapes are classes in `dto/`, decorated with
`class-validator` (`@IsString`, `@IsOptional`, …) and `@ApiProperty`. The global `ValidationPipe`
(`whitelist: true, forbidNonWhitelisted: true, transform: true`) **strips unknown fields and
rejects unexpected ones** — so every accepted field needs a validator decorator, or it is dropped.

**Auth/guards:** protect routes with `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth("JWT-auth")`;
opt a route out with `@Public()`; ownership/role checks use the project/roles guards
(`ProjectCollaboratorGuard`, `ProjectCreatorGuard`, `RolesGuard`). Reuse these — don't re-implement.

**Errors:** from services, prefer Nest's built-in `HttpException` subclasses
(`NotFoundException`, `ForbiddenException`, `BadRequestException`, …) — they map to status codes
automatically. Domain errors are small classes in `*.error.ts`; translate them to HTTP responses
at the controller boundary (see `project.controller.ts` catching `S3DownloadException`).

## Conventions (not all enforced by tooling — follow these)

These complement the lint/TS rules (which you should read from the config files, not restate).

**Imports — alias policy**
- Use a project `@`-alias for **any cross-directory import**. The project aliases are:
  `@auth`, `@user`, `@project`, `@multiplayer`, `@project-comment`, `@work-session`, `@s3`,
  `@common`, `@webrtc`, `@util`, `@ourPrisma` (see `tsconfig.json` `paths`).
- **Same-directory `./x` imports are fine** (preferred for siblings within a folder).
- **Don't** use `../` parent-relative imports — use an alias.
- **Don't** import via raw `src/...` paths — use the matching `@`-alias (it's a redundant
  mapping being phased out; see backlog).
- Don't include file extensions in imports (write `"./project.service"`, not `".../...ts"`).
- Note: `@prisma/client`, `@nestjs/*`, `@aws-sdk/*`, `@tygra/*` start with `@` but are **npm
  packages** (libraries), not project imports.

**Imports — ordering** (not tool-enforced yet; match the surrounding file). The common existing
shape is: framework/library imports, then project `@`-aliases, then same-dir `./` — keep related
imports grouped rather than scattered.

**TypeScript** — the config is **very strict** (`strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noUnusedLocals`/`noUnusedParameters`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, …). Practical consequences:
- Mark overrides with `override` (e.g. a guard's `canActivate`).
- Read env / dynamic-index keys with brackets: `process.env["JWT_SECRET"]`.
- Indexed access can be `undefined` — narrow it; don't assume.
- No unused locals/params. `any` is discouraged (typescript-eslint warns) — prefer real types
  or `unknown`. **Don't loosen `tsconfig.json` to silence an error.**

**Return types** — explicit function return types are **required** (`explicit-function-return-type`),
including `Promise<T>` and `void`.

**Logging** — use Nest's `Logger` (`private readonly logger = new Logger(MyClass.name)`).
`console.*` trips `no-console` (warn) — avoid it in app code (the swagger generation tool is the
documented exception and disables the rule locally with a comment).

**Files & folders**
- **Folder names are `kebab-case`** (`work-session/`, `project-comment/`).
- Files follow Nest's dot-suffix convention: `project.controller.ts`, `create-project.dto.ts`,
  `project.service.spec.ts`, `project.error.ts`. Classes are `PascalCase`.
- Keep one clear responsibility per file; split as features grow.

**TODO / FIXME** — reference a Jira ticket: `// TODO(NCTO-123): …`.

**Testing** — unit tests are co-located `*.spec.ts` using `@nestjs/testing`
(`Test.createTestingModule`) with mocked providers (`useValue`). Add or extend specs for new
services, controllers, and business logic.

**Database / Prisma** — edit the schema in `prisma/models/*.prisma`, then create a migration
with `npx prisma migrate dev --name <desc>` and run `npx prisma generate`. **Never hand-edit
files under `prisma/migrations/`.** Access the DB only via `PrismaService`.

**Commits / branches** — see `CONTRIBUTING.md` (branch = Jira key; commit = `[PART] [TYPE] Message`).

## Security

See `SECURITY.md` for the disclosure policy. Rules for agents and contributors:

- **No secrets in code or git.** All config comes from env (`.env`, gitignored) read via
  `ConfigService`. Never commit `.env`, `*.pem` (CloudFront keys), or real keys/tokens — even in
  tests or fixtures. `.env.example` documents the variable **names** (no values).
- **Validate all input.** Every controller input is a DTO with `class-validator` decorators and
  the global `ValidationPipe` rejects unknown fields — don't bypass it with an untyped `@Body()`
  or by disabling `whitelist`/`forbidNonWhitelisted`.
- **Auth/secrets handling.** Access tokens are JWT bearer tokens (`passport-jwt`); refresh tokens
  are encrypted (AES-256-GCM, `auth/refresh-cookie.crypto.ts`) and delivered as httpOnly cookies;
  passwords are hashed with `bcryptjs`. Don't log tokens/passwords, never return password hashes
  (use response DTOs / Prisma `select`), and keep routes behind guards — `@Public()` must be a
  deliberate choice.
- **Database.** Use Prisma's query builder (parameterized). Avoid `$queryRawUnsafe` or
  string-interpolated SQL.
- **CORS** is locked to `FRONTEND_URL` with credentials — don't widen it to `*`.
- **File uploads** go through `ParseFilePipeBuilder` (size/type validators). Keep limits and
  allowed types when adding upload endpoints.
- **Never disable a security-related lint rule or type check** to silence a warning — fix the
  underlying issue or ask.

## Gotchas

- **`swagger.json` and `generated_client/` are generated and gitignored — never hand-edit them.**
  Regenerate with `npm run generate:swagger` (boots the app to read `@nestjs/swagger` decorators)
  then `npm run generate:client` (`@hey-api/openapi-ts`). The API contract is defined by
  controllers + DTOs + Swagger decorators; the frontend copies `generated_client/` into its
  `src/api`. **Annotate new/changed endpoints** (`@ApiTags`, `@ApiOperation`, `@ApiResponse`,
  typed DTOs) or the generated client will be wrong.
- Swagger generation runs with a **stubbed env** (`tool/generate-swagger.ts`) so it works without
  real secrets. If generation breaks after adding a module that reads new env at construction
  time, add a stub there.
- The Prisma schema is **split** across `prisma/schema.prisma` + `prisma/models/*.prisma`. Edit
  the model files; let Prisma generate the migrations.
- `npm run lint` runs ESLint with `--fix` (it **modifies files**). There is **no pre-commit hook**
  in this repo — run lint / build / test yourself before pushing.

## Known incoherencies (being addressed in later phases — don't "fix" ad-hoc)

These are tracked cleanups; avoid partial migrations that make them worse.

- **Tooling:** `eslint.config.mjs` is configured for a browser/React app (`globals.browser`,
  `eslint-plugin-react`) — it should target Node and drop the React plugin. There's no
  import-ordering rule (`simple-import-sort`) and no ban on `../` / raw `src/...` imports
  (~19 `src/...` and ~7 `../` imports remain) — these should migrate to `@`-aliases and the
  redundant `src/*` path mapping be dropped. No `husky`/`lint-staged`/`commitlint`, and CI runs
  build + test but **not** lint/format — add a check-only `lint` (no `--fix`) and a `typecheck`
  step.
- **Docs:** `README.md` is stale — its env block predates `.env.example` (lists `AWS_*` instead
  of `S3_*`/OAuth vars), references non-existent `src/routes/aws` & `src/aws`, and has a
  `npm start:dev` (missing `run`) typo.
- **Data model:** `prisma/models/user.prisma` carries a `// FIXME` to rename the
  `workSession`/`hostingSession` relations to `joined*`/`hosting*` after a merge.
