# Contribution Guide

follow these conventions when contributing to this repository

# Branch naming

Branches should be named directly from the corresponding Jira task.

(ex. NCTO-7-ide-vs-code-issue)

# Commit naming:
[PART] [TYPE] Commit message

The message after the tags starts with a **capital letter**.

## example:
[AUTH] [ADD] Add Microsoft OAuth provider and refresh-token cookie

### PART:
describes what part you're working on in one word

### TYPE:
- [ADD] - adding new features
- [REMOVE] - removing features
- [UPDATE] - updating existing features
- [REFACTO] - refactoring without changing functionality
- [CLEAN] - cleaning dead code, comments, imports, etc.
- [FIX] - fixing bugs

# Commit content:

There is no pre-commit hook in this repo, so lint and tests are **not** run automatically — make
sure your change is clean before committing:

- `npm run lint` — ESLint (note: it runs with `--fix` and will modify files).
- `npm run build` — must compile under the strict `tsconfig`.
- `npm run test` — unit tests.

CI runs the build and test suite on every push/PR to `main` and must pass before merge.

If you changed the database schema (`prisma/models/*.prisma`), include the generated migration
(`npx prisma migrate dev --name <desc>`); never hand-edit files under `prisma/migrations/`.

# Code conventions

Code style, architecture, and project-structure conventions live in [`AGENTS.md`](./AGENTS.md)
(it applies to both human contributors and AI agents).

`TODO` / `FIXME` comments must reference a Jira ticket, e.g. `// TODO(NCTO-123): ...`.

# Pull Requests
Fill in the PR template (`.github/pull_request_template.md`): link the Jira ticket and describe
what was done.

Request at least one reviewer.

After each requested change (review feedback), make a new commit and copy the commit ID into the
PR comment.
