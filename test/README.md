The shared-session regression suite uses a real, isolated PostgreSQL database.
Apply the Prisma migrations to that database, then run:

```sh
REVIEW_TEST_DATABASE_URL=postgresql://... npm run test:admin-session
```

It creates test accounts and roles, and checks cookie and bearer authentication,
custom permission assignment and revocation, CSRF, refresh rotation, and logout.
Use a disposable database: fixtures are deliberately retained for inspection.
