# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report suspected vulnerabilities privately via GitHub's
[Report a vulnerability](https://github.com/Naucto/Backend/security/advisories/new) flow
(Security → Advisories), or by contacting the maintainers directly.

When reporting, include where possible: affected version/commit, a description of the issue and
its impact, and reproduction steps or a proof of concept. We aim to acknowledge reports
promptly and will coordinate disclosure once a fix is available.

## Supported versions

This is an actively developed application; security fixes target the `main` branch. There are
no separately maintained release branches.

## Dependency & code security

- **No secrets in the repo.** All configuration comes from environment variables (`.env`,
  gitignored) read through `ConfigService`. Credentials, tokens, and keys — including `.env`
  files and CloudFront `*.pem` keys — must never be committed. `.env.example` documents the
  variable **names** only.
- **Input is validated at the edge.** Every endpoint takes a `class-validator` DTO and the global
  `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`) strips/rejects unknown
  fields. Don't bypass it.
- **Auth.** JWT bearer access tokens (`passport-jwt`); refresh tokens are encrypted
  (AES-256-GCM) and delivered as httpOnly cookies; passwords are hashed with `bcryptjs`. Routes
  are protected by guards — `@Public()` is opt-out and deliberate.
- **Database access** goes through Prisma's parameterized query builder; raw/interpolated SQL is
  avoided. **CORS** is restricted to `FRONTEND_URL` with credentials.
- Run `npm audit` before adding or bumping a dependency; prefer well-maintained, patched
  versions. See the Security section of [`AGENTS.md`](./AGENTS.md) for contributor guidance.

## Known issues being addressed

- CI runs the build and test suite on every PR to `main` but does not yet run lint/`typecheck`,
  and there is no pre-commit hook — see the tooling backlog in [`AGENTS.md`](./AGENTS.md).
