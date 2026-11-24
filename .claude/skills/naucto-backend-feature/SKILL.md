---
name: naucto-backend-feature
description: Working method for adding or changing a feature of the Naucto Backend (a route, a service, a module, what an answer carries). Use when asked to add an endpoint or a resource, to change what a route takes, answers or refuses, to open something to another kind of caller, or before opening a pull request on this repository.
---

# Adding or changing a feature in the Naucto Backend

`AGENTS.md` at the repo root is the authority and is not repeated here. Read, before anything else,
its **How to work in this repo**, the paragraphs of **Architecture map** from _Module pattern_ to
_Ids_, **Conventions**, **Security** and **Known incoherencies**. Then read the paragraph of the
feature you touch (_Analytics_, _Moderation_, _Hub_, _Collections_, …): each lists the invariants
its code relies on.

## 1. Find the module that owns the notion

- `src/app.module.ts` lists every module; `src/routes/<feature>/` holds one per resource. Search
  for the noun of the request (`git grep -il <noun> -- src prisma/models`) before creating
  anything.
- A new kind of an existing thing is a value on its row and a branch where the kinds differ, not
  a table and a module of its own: look at how `Report.kind` tells ratings, bug reports and
  crashes apart in `src/routes/reports/`.
- A change to an existing route is made in place. A second route or a second service method
  beside the first, for one more caller, is the thing to avoid.
- Create a module only for a resource nothing owns. If the request does not fit a module without
  reaching into another one's tables or internals, stop and ask: that is a decision about
  structure, and it is not yours to take in passing.

## 2. The anatomy of a module

`src/routes/collections/` is a small, complete module to read end to end and copy the shape of.
Two points of it are not the model: its service takes the request DTOs (step 3), and it counts
its two limits before the write they guard (_Security_ in `AGENTS.md`).

| File                        | What it holds                                                                    |
| --------------------------- | -------------------------------------------------------------------------------- |
| `collections.controller.ts` | Routes: access, pipes, Swagger annotations, one call to the service. No logic    |
| `collections.service.ts`    | Every rule of the feature, and the only code that reaches `PrismaService`        |
| `dto/collection.dto.ts`     | What crosses HTTP, in and out, with validators and `@ApiProperty`                |
| `collection.error.ts`       | The refusals with a `code`, each `satisfies` the DTO that declares it            |
| `collection-limits.ts`      | The numbers the DTOs and the service both need, named once                       |
| `collections.module.ts`     | `imports`, `controllers`, `providers`, `exports`                                 |
| `*.spec.ts` beside each     | The service against a mocked `PrismaService`, the controller against the service |

A new module is wired in two places: `src/app.module.ts`, and `src/swagger.app.module.ts`, which
lists the controllers again with stubbed providers so the contract can be generated without a
database (`swagger.app.module.spec.ts` fails when the two differ).

Write in this order: schema (step 11), service and its spec, DTOs and errors, controller and its
spec, wiring, seed data (`prisma/seed-dev.ts`), contract (step 10).

## 3. Shapes that cross a layer

- **In:** the controller receives a DTO class, validated and coerced by its decorators, and hands
  the service ids and a shape the service declares. `ReportsController.createRating` filling the
  `NewRating` of `reports.service.ts` field by field is the model; a page goes in as a
  `PageRequest`. The service never imports the request DTO.
- **Out:** the service answers a response DTO, built field by field (`toHubGame` in
  `src/routes/project/hub-fields.ts`). Spreading a Prisma row hands out every column the model
  has today and every one it gains later.
- A shape named in a signature is an `interface`, a type alias or a DTO class, declared above the
  function that uses it. Do not write an object type inline in a parameter or a return type.
- The backend computes what clients would otherwise each work out (a count, a state, what the
  caller may do), and checks again what the web app checked.

## 4. Ids

Read _Ids_ in `AGENTS.md`. What it means while writing a route:

- A route parameter that names a row is `@Param('id', ParseIdPipe)`, with
  `@ApiParam({ name: 'id', type: String, format: 'uuid' })`. In a body or a query it is `@IsId()`.
- A field that carries an id is `@ApiProperty({ format: 'uuid' })`.
- Never order by an id, compare two with `<`, or build a label from one. Order by a date; a row
  that may be gone is answered as its id and a name that may be `null`.
- Three integers remain and none of them is an id to hand out: `User.playerNumber`,
  `Project.legacyId`, `AnalyticsFact.id`.
- In a spec an id is `uuidOf(n)` (`test/uuid.ts`). In raw SQL it is cast (`${id}::uuid`).

## 5. Access

Every route states who may call it with one of four decorators of
`src/auth/access/access.decorators.ts`, on the handler or on its controller: `@Public()`,
`@RequiresAuth()`, `@RequiresRole(…)`, `@RequiresStaffSession(…)`. A route that states nothing is
admin-only and fails `access-coverage.spec.ts`.

- Routes under `admin/` take `@RequiresStaffSession`, and a `GET` there changes nothing: a viewer
  passes every read of the admin console.
- Ownership is a guard after the global one (`ProjectCollaboratorGuard`, `ProjectCreatorGuard`),
  or a check in the service that answers 404 to whoever may not know the row exists
  (`CollectionsService.requireReadable`).
- **A suspended account** signs in and reads. Every write that asks for an account refuses it
  with `ACCOUNT_SUSPENDED` unless the handler carries `@AllowedWhileSuspended()` and is listed
  in `KEPT_WHILE_SUSPENDED` of `access-coverage.spec.ts`. A new write stays closed unless it is
  how a person leaves or withdraws what is theirs.
- Never add `@ApiBearerAuth` by hand: the access decorators document the security themselves.

## 6. "On the hub" is one test

A game is on the hub when `PUBLISHED` says so (`src/routes/project/project-select.ts`;
`PUBLISHED_SQL` in a raw query): released and not withheld by moderation. `RELEASED` is the
owner's own view, and `LIVE_COMMENT` is the same idea for a comment that counts. Any query that
lists, counts, ranks or links published games goes through these. A condition written out again
in a feature misses the next reason a game leaves the hub.

## 7. What a person writes can be reported, hidden and erased

If the feature stores text or an image one person writes and another reads, it is not finished
until moderation can act on it. `Collection` is the worked example; search for `COLLECTION` to
find every place:

- **Flaggable:** a value of the `ModerationTargetType` enum, a reader in
  `ModerationTargetService`, an entry in `FLAGGABLE` (`flags.service.ts`) and in the nouns of
  `FlagNotifier`.
- **Hideable:** a `hiddenAt` on the row, decisions in `ContentModerationService` with their admin
  controller, their action types in `VISIBLE_TO_SUBJECT`, and one place in the owning service
  that decides who still reads a hidden row.
- **Erased with the account:** a fate in `USER_RELATION_FATES`
  (`src/routes/user/account-deletion.service.ts`), carried out there. The file does not compile
  until the new relation of `User` has one.
- A write to it is closed to a suspended account (step 5).

## 8. Lists

- A list that can grow is paginated in its first version: a query DTO extending
  `PaginationQueryDto` (`src/common/dto/pagination-query.dto.ts`), `toSkipTake` or `pageWindow`
  in the service, and an answer made of the rows, `total`, `page` and `limit`
  (`CollectionsPageDto`).
- Give it a stable order: a date, then the id as a tiebreak.
- A list without pages is one a constant bounds; name the constant.
- A card in a list is built from the row. A list never asks the object store about each item.

## 9. Errors

- Raise Nest's HTTP exceptions from the service for the plain cases (404, 403, 400).
- A refusal the client must tell from another of the same status gets a `code`: an exception
  class in `<feature>.error.ts` whose body `satisfies` a response DTO with the code as an enum,
  and an `@ApiResponse({ status, type })` on every route that can raise it. Copy
  `CollectionLimitException` and `CollectionLimitDto`.
- An error of the domain that is not an HTTP answer (storage, a provider) is a class extending
  `Error` in a `*.error.ts`; lint refuses `throw new Error(…)` under `src/`.
- In a `catch`, wrap one call, handle the failure you expect, rethrow the rest, and pass what you
  caught as the `cause` of what you raise. Do not catch to log.

## 10. Configuration and the contract

- A new variable is declared in `src/config/env.ts` and in `.env.example`, read with `getEnv` or
  `getOptionalEnv` where the class is built. If a module reads it at construction, give
  `tool/generate-swagger.ts` a stub for it. An integration with a third party stays optional:
  unset, it turns itself off.
- Something several features call out to is a service of its own (`src/discord/`), injected.
- Every route carries `@ApiOperation({ summary })` and an `@ApiResponse` with the DTO it answers,
  every controller `@ApiTags`, every DTO field `@ApiProperty` with `nullable`, `enum` and
  `format` where they apply. The generated client knows nothing else.
- `npm run generate:swagger`, then read the diff of `swagger.json` against the one generated
  before your change: every difference is one you meant. When it changed, bump `version` in
  `client/package.json`, in a commit of its own that says for what.
- A field removed or retyped breaks the frontend and the admin console that consume the client.
  Say so in the pull request.

## 11. Data

- A new table, a nullable column or an index: edit `prisma/models/*.prisma`, then
  `npx prisma migrate dev --name <desc>` and `npx prisma generate`. The dev container applies
  pending migrations when it starts.
- Anything that has to keep, move or rewrite what rows hold: stop and follow the skill
  `naucto-data-migration`.
- What the feature needs to be tried locally goes through `npm run seed:dev`.
- A write that changes what a friend sees emits a domain event after it commits, and a business
  fact of analytics is written in the transaction of the operation it records: see _Presence_
  and _Analytics_ in `AGENTS.md`.

## 12. Verify

1. `npm run lint:check && npm run typecheck && npm run build && LC_ALL=C npm test`. Stop the dev
   container first if `dist/` is not yours to write (see _Commands_ in `AGENTS.md`).
2. The specs that guard structure pass without their lists being edited to make them pass:
   `access-coverage.spec.ts`, `contract-coverage.spec.ts`, `layers.spec.ts`,
   `swagger.app.module.spec.ts`, `env.spec.ts`, `account-deletion.service.spec.ts`,
   `moderation-log.append-only.spec.ts`, `test/ids.spec.ts`. A change to one of their lists is a
   decision; say it in the pull request.
3. The contract regenerated and its diff read (step 10).
4. For raw SQL, which neither types nor mocked specs check, boot the built server against a
   scratch copy of the database and call the route (the rehearsal of `naucto-data-migration`).

## 13. Before you open the pull request

- [ ] Every function states its return type, and every shape in a signature has a name.
- [ ] No bare `Error`; a `catch` keeps the cause and hides nothing; every code the client
      branches on is in a response DTO.
- [ ] The controller holds no rule, the service takes no request DTO, the DTO does the
      validating, and what several features share is a service of its own.
- [ ] Nothing the request did not need: no flag, option, second route, twin method or one-caller
      helper. Lists are paginated from the start. The pull request says one thing and touches no
      unrelated line.
- [ ] Names say what the thing is, not who calls it. Comments are in English and say why.
- [ ] Configuration goes through the registry and `.env.example`, read where the class is built.
- [ ] The framework does the work: the query builder (tagged raw SQL where it cannot),
      `class-validator` and `class-transformer`, the existing guards, pipes and helpers.
- [ ] Every route states its access, ids go through `ParseIdPipe` / `@IsId()`, hub queries
      through `PUBLISHED`, and what a person writes can be flagged, hidden and erased.
- [ ] Specs and `seed:dev` data come with the change, the four checks pass, the contract diff is
      read and the client version bumped if it moved.
