# 16 — CI/CD Foundation

## 1. What exists

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request. Two jobs, both required to pass before a PR merges:

**`backend`** (in `backend/`):
1. `npm ci` — install exact locked dependencies.
2. `prisma generate` — regenerate the Prisma client from the schema.
3. `tsc -p tsconfig.json --noEmit` — typecheck the whole backend. This is
   the backend's static-analysis gate; there's no separate lint config
   configured for it yet (see §3).
4. `prisma migrate diff --from-migrations ... --to-schema-datamodel ...
   --exit-code` — fails the build if the committed migration history
   under `prisma/migrations/` doesn't produce the exact schema in
   `schema.prisma`. This is what catches "I edited schema.prisma but
   forgot to run `prisma migrate dev`" before it ships.
5. `npm test` (`vitest run`) — the full backend test suite. `vitest`'s
   own `globalSetup.ts` builds a fresh throwaway SQLite test database via
   `prisma db push` before the suite runs, so this step is also
   effectively a second, stronger schema-validity check (a diff can pass
   syntactically but a `db push` against it can still fail on a real
   constraint conflict).

**`frontend`** (in `frontend/`):
1. `npm ci`
2. `npm run lint` (`oxlint`) — static analysis.
3. `npm run build` (`tsc -b && vite build`) — typechecks and produces the
   production bundle. A broken build fails here, not after merge.

Both jobs were run locally against the current codebase before this
workflow was written (not just written and assumed to work) — the
migration-diff command, the typecheck, the test suite, and the frontend
lint+build all pass clean as of this commit.

## 2. What's deliberately *not* here

**No deploy job.** This workflow answers "is this change safe to ship,"
never "ship this change." A deploy pipeline — building a container
image, pushing it to a registry, triggering a platform deploy — is a
separate workflow to add later, and per Phase 4's explicit instruction,
it must never auto-deploy without a human approval step (a GitHub
Environment with required reviewers, or a manual `workflow_dispatch`
trigger, are the standard ways to enforce that once it exists).

**No auto-merge.** Passing CI is a necessary gate, not a merge trigger.

## 3. Known gaps (not silently glossed over)

- The backend has no dedicated linter config (no ESLint setup exists in
  `backend/`) — `tsc --noEmit` is standing in as its static-analysis
  gate for now. Adding a real lint config (ESLint + the same
  `@typescript-eslint` rules the codebase's style already implies) is
  reasonable follow-up work, not done here because adding a linter
  config to a mature ~15k-line backend and then *fixing every finding it
  produces* is its own significant piece of work, not something to bolt
  on as a side effect of writing a CI doc.
- No code-coverage threshold enforcement — the test suite runs and must
  pass, but coverage isn't measured or gated on.
- No dependency-vulnerability scanning step (e.g. `npm audit` as a CI
  gate, or Dependabot/Renovate) configured yet.
- CI runs on GitHub-hosted runners against SQLite (matching how the
  suite already runs locally) — once the production datasource moves to
  Postgres (`docs/15-production-configuration.md` §2), the migration
  diff and `db push` steps should also run against a throwaway Postgres
  service container in CI, not SQLite, so CI is actually testing the
  same database engine production uses.
