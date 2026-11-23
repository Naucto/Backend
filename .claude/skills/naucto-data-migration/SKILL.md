---
name: naucto-data-migration
description: Working method for a Naucto Backend migration that moves, backfills or rewrites existing rows, or changes what stored objects are keyed by. Use when a schema change cannot be said by the SQL Prisma generates (a column changes type with its data, a key changes shape, rows are re-keyed or merged), when asked to migrate production data, or when asked to prove a migration loses nothing.
---

# Migrating data in the Naucto Backend

`AGENTS.md` at the repo root is the authority and is not repeated here. Read, before anything else,
its **Database / Prisma** convention, **Ids**, the **Commands** table and **Gotchas**. The
migration `prisma/migrations/20261123120007_ids_to_uuid/` and the two tools
`tool/id-migration-check.ts` and `tool/move-storage.ts` are a worked example of every step below.

## 1. Decide whether the SQL is yours to write

Prisma generates a migration from the difference between two schemas. It knows nothing of the
rows: a column whose type changes is dropped and created again, empty. Write the SQL by hand when
the change has to **keep** what the rows hold: a type change, a split or a merge of columns, a
key that changes shape, a backfill the new code relies on. A change that only adds a nullable
column, a table or an index stays as generated.

Before writing anything, list **everything that holds the value you are changing**, and do not
trust a list someone handed you:

- the columns with a foreign key to it, and the implicit join tables (`_Name`, columns `A` and `B`
  in the alphabetical order of the two models);
- the columns that hold it **without** a foreign key, because they outlive the row (analytics,
  moderation targets, reports): they may name a row that no longer exists;
- the **strings** built from it (`git grep` for template strings: dedupe keys, open keys, viewer
  keys, rollup dimensions) and the **JSON** that carries it (notification data, snapshots);
- what is **derived and rebuilt** by the application (tokens, daily snapshots): empty it instead of
  translating it;
- what lives **outside the database**: object-storage keys, addresses stored in a column, tokens
  already issued, anything a client or a published game keeps;
- the **code that assumed a property** of the old value: an order, arithmetic, a sentinel such as
  `0`, a canonical order of a pair.

## 2. Create the migration

1. Change `prisma/models/*.prisma`, then `npx prisma generate`.
2. Create the folder with `npx prisma migrate dev --create-only --name <desc>`, pointed at a
   **scratch copy** of the database (section 4), never at the one you work on. When the generated
   SQL loses data the command asks for a confirmation and refuses a non-interactive shell: run it
   under a pseudo-terminal (`script -qec "<command>" /dev/null`) and answer.
3. Keep the folder and its name; replace `migration.sql` with yours. Say in its first lines what it
   does and that it is written by hand.

## 3. Write it

- **Change in place.** `ALTER TABLE … ALTER COLUMN … TYPE … USING <expression>` keeps the primary
  key, the unique constraints and the indexes of the column under their names; dropping and
  creating a column loses all three. A `USING` expression may call a function (create it in
  `pg_temp`, it goes with the session) but not hold a subquery. Foreign keys are dropped first and
  put back last, each exactly as `prisma migrate diff --from-empty --to-schema prisma --script`
  spells it.
- **One rule for every place a value appears.** Fill a map first (old value to new), then translate
  every column, string and JSON key through the same function, so two places can never disagree.
  A value that names a row which no longer exists gets a new value **derived** from the old one,
  the same wherever it appears.
- **A new id is dated at its row's creation.** A row that is given a UUID takes a version 7
  shifted to the column that says when the row was made (`pg_temp.id_made_at` in the worked
  example), so migrated ids fall in the order of their rows, as the ids the database draws do.
  The derived id of a row that no longer exists has no date and stays as derived.
- **Keep what a later tool needs.** If objects outside the database are keyed by the old value,
  the migration leaves a table saying what each became. Say in the schema that it is temporary.
- **It must run on an empty database too**: CI and the analytics acceptance harness replay every
  migration from nothing.
- **Atomic.** Prisma sends a migration file to Postgres as a single query, and Postgres runs a
  multi-statement query as one transaction: a failure anywhere leaves the database as it was. So:
  - no `BEGIN` / `COMMIT` in the file. Inside an explicit block the failed transaction is still
    open when Prisma records the failure, and the real error is replaced by "current transaction is
    aborted";
  - nothing that cannot run inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`, using a
    new enum value in the statement after the one that adds it);
  - open the file with the guard of the worked example (`set_config(…, true)` then a check), which
    stops a runner that commits statement by statement before it changes anything.
- After a failure Prisma keeps the migration marked as failed and refuses the next deploy:
  `npx prisma migrate resolve --rolled-back <name>`, fix, deploy again.

The schema and the migrations agree when this prints an empty migration, on a database that ran
them all: `npx prisma migrate diff --from-config-datasource --to-schema prisma --exit-code`.

## 4. Rehearse on a copy

- **Never migrate the database you work on to try a migration.** Copy it inside the database
  container (`createdb <scratch>` then `pg_dump <db> | psql <scratch>`; `createdb -T` refuses while
  the application is connected) and point `DATABASE_URL` at the copy.
- The dev container runs `prisma migrate deploy` each time it starts and reads the tree you are
  editing: a draft migration left in `prisma/migrations/` is applied to the local database by the
  next restart. Keep the draft outside the tree (a copy of `prisma/migrations/` and a Prisma config
  whose `migrations.path` points at it) until it has passed on a copy.
- The seed leaves tables empty and never produces a reference to a deleted row. Add both to the
  copy by hand before the rehearsal: a migration that was only ever run on tidy data is untested.
- **Make it fail on purpose once.** Append a failing statement to a copy of the migration, deploy it
  on a second scratch database, and compare a `pg_dump` taken before with one taken after
  (leaving `_prisma_migrations` out): they must be identical.
- Then boot the built server against the migrated copy on another port and call what the change
  touches, raw SQL first: types do not check it, specs mock it. Read the server's log for errors.
- Drop the scratch databases when done.
- Before the real run, repeat the rehearsal on a **copy of the production database**. Time it.

## 5. Prove that nothing was lost

Counting rows before and after proves little. Write a check in two steps, so it reads both shapes
of the database (`tool/id-migration-check.ts`):

- `--before <file>` reads the old shape and writes a fingerprint; `--after <file>` reads the
  migrated database and compares. It only reads, and exits non-zero on any difference.
- **Name every row by what a person recognises it by**, never by the value being changed: an
  account by its email, a project by its number, name and creator, a comment by its author and
  text, a friendship as an unordered pair. Each relation becomes a list of such lines, sorted, and
  the two lists must be equal.
- **Digest what the migration does not touch**: per table, a hash of every row without the columns
  being changed. Any other change shows.
- Count the nulls of every reference before and after: a reference must not be lost on the way.
- After the migration, ask what only the new shape can answer: every column has its new type, no
  rewritten string still carries the old form, what had to be emptied is empty, the new ids are in
  the order their rows were made in.
- It runs on production data: assume nothing the seed happens to guarantee.
- **Test the check itself.** On a migrated copy, break one thing at a time (a row given to another
  owner, a reference moved, a key left in the old form, an untouched value changed) and see each
  reported. A check that has never failed proves nothing.

## 6. What the database does not hold

For objects in the store, addresses kept in a column, or anything else the migration cannot
rewrite in its transaction, write a tool (`tool/move-storage.ts`):

- **It copies and never deletes or overwrites.** A dry run is the default and lists what it would
  do, and what it found that belongs to nothing. `--apply` does it. Running it again does nothing
  more.
- A copy keeps what the object had: content type, metadata, and who may read it. Report
  screenshots are never public, whatever the source says.
- `--check` asks the rows, not the tool's own log: every row that should own an object has it at
  its new place, readable by whom it should be.
- Deleting the old copies is a **separate** mode, run later, that refuses unless the check passes
  and deletes an object only when its copy exists.
- Run it between the migration and the moment the application writes at the new places. A copy
  made after that brings back what a person removed since.
- It runs where the data is: in the backend's runtime image, with the backend's environment. That
  image holds the compiled server and no TypeScript, so the tool is bundled into one file
  (`npm run storage:move:build`) and copied in. The local object store has no per-object ACLs, so
  what is public is only truly exercised on the deployed store: look at it in the dry run there.

## 7. Going live

The order, for a change that both the database and the store carry:

1. Back up the database and the bucket. Rehearse on the copy of production (sections 4 and 5).
2. Stop what writes: the backend and the frontend, not the database nor the store.
3. Fingerprint (`--before`), run the migration, compare (`--after`).
4. Run the storage tool: dry run, `--apply`, `--check`.
5. Start the new backend and frontend. Everyone whose token or cached state carried the old value
   signs in again.
6. Later, once nothing reads the old places: purge them, then drop what was kept for the tool.

A deployment that applies migrations and starts the backend in one go leaves no room for step 4:
run steps 3 and 4 by hand before deploying, so the deployment finds the migration already applied.
The deployment itself is the owner's to fire.

## 8. Verify and report

1. `npm run lint:check && npm run typecheck && npm run build && LC_ALL=C npm test`
2. The rehearsal of section 4, the comparison of section 5, the failure on purpose, the empty diff.
3. `npm run generate:swagger` when the contract changed, and the client version bumped.

Report what the migration does table by table, every place found beyond the first list, what the
comparison and the failure test showed, and what the rehearsal on real data must still look at.
