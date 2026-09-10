# 15 — Production Configuration

Everything in this doc reflects what's actually wired into the codebase
today (Phase 4), not an aspirational target. Where something is a known
gap for a real production deploy, it's called out explicitly rather than
implied to be solved.

## 1. Environments

Three environments, distinguished purely by `NODE_ENV` + the env vars
loaded alongside it — no environment-specific code branches anywhere in
`src/`:

| Environment | `NODE_ENV` | Database | Payment/SMS/Push providers |
|---|---|---|---|
| Development | `development` | SQLite file (`prisma/dev.db`) | Console/mock providers (`MOCK_OTP=true`, `MOCK_PAYMENTS=true`, `MOCK_NOTIFICATIONS=true`) |
| Staging | `production` (same code path as prod) | Postgres (see §2) | Real providers, sandbox/test credentials |
| Production | `production` | Postgres | Real providers, live credentials |

Staging and production run the identical build artifact; the only
difference is which secrets/URLs are injected as env vars. This is
deliberate — it's the only way staging actually validates what will run
in production.

## 2. Database: SQLite today, Postgres for real production

The Prisma schema (`backend/prisma/schema.prisma`) runs on SQLite in
dev/pilot and is written to be Postgres-portable (no SQLite-specific
features are relied on — see the schema's own header comment about
enums being stored as `String` columns specifically so the swap doesn't
require a data-model rewrite). SQLite is genuinely fine for the pilot's
scale and for a single-instance deployment; it is **not** fine once you
need multiple backend instances behind a load balancer (SQLite has no
real concurrent-writer story across processes) or once the dataset grows
past what a single file comfortably handles.

**Before a real (non-pilot) production launch**, this needs:
1. `datasource db { provider = "postgresql" }` in `schema.prisma`.
2. A managed Postgres instance (RDS/Cloud SQL/etc.) — connection string
   goes in `DATABASE_URL`, never hard-coded.
3. `npx prisma migrate deploy` against it (see §5) — the existing
   migration history in `prisma/migrations/` replays cleanly since it
   was authored against the portable schema.
4. Re-running the seed script is optional and pilot-only — real
   production starts from an empty (migrated) database, not seed data.

This is flagged here rather than done because switching the datasource
provider without an actual Postgres target to test the migration replay
against would be untested, unverifiable work — exactly the kind of thing
this project's approach has consistently avoided claiming as "done."

## 3. Environment variables

Backend (`backend/.env`, template at `backend/.env.example`):

| Variable | Required in prod | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` for staging and prod |
| `PORT` | no (default 4000) | |
| `DATABASE_URL` | yes | Postgres connection string in real prod |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | yes | `env.ts` **refuses to start** in production if either still contains the literal `dev-` default — see `backend/src/config/env.ts` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | no | default `15m` / `30d` |
| `CORS_ORIGIN` | yes | comma-separated allowed origins — set to the real frontend domain(s), never `*` |
| `MOCK_OTP` / `MOCK_PAYMENTS` / `MOCK_NOTIFICATIONS` | yes (set to `false`) | dev-only bypasses; production must use real providers |
| `PAYMENTS_PROVIDER_WEBHOOK_SECRET` | yes | HMAC secret for webhook signature verification (`services/payments/MockCardProvider.ts` is the template — a real provider adapter issues/uses its own scheme) |
| `SMS_PROVIDER_*`, `PAYMENTS_PROVIDER_SECRET_KEY`, `PUSH_PROVIDER_SERVER_KEY`, `MAPS_PROVIDER_API_KEY` | only once that integration goes live | commented out in `.env.example` — see §7 |

Frontend (`frontend/.env`, template at `frontend/.env.example`):

| Variable | Notes |
|---|---|
| `VITE_API_URL` | the backend's public `/v1` base URL |
| `VITE_SOCKET_URL` | the backend's Socket.IO origin |

**Never in source control**: both `.env` files are gitignored (verified:
`backend/.gitignore` and `frontend/.gitignore` both list `.env`). Only
the `.env.example` templates — which contain no real secrets, only
placeholder/dev-only values — are committed.

## 4. Secrets management

For a real deployment, env vars should be injected by the platform's
secret store (e.g. AWS Secrets Manager / Parameter Store, GCP Secret
Manager, a Kubernetes Secret, or the hosting platform's own env var UI —
Render/Railway/Fly all have one) rather than an `.env` file sitting on
disk on the server. The application code doesn't care how the env vars
arrive — `config/env.ts` just reads `process.env`, so this is purely an
infra/deploy-pipeline decision, not a code change.

## 5. Migrations in production

- **Never** `prisma migrate dev` against production — that command can
  prompt for destructive resets. Production always uses
  `prisma migrate deploy`, which only applies pending migrations from
  `prisma/migrations/` and never generates or resets anything.
- Run `prisma migrate deploy` as a discrete release step **before** the
  new application version starts serving traffic, not as a side effect
  of the app booting.
- See `docs/16-backup-recovery.md` for the rollback procedure when a
  migration needs to be reversed.

## 6. What "production-ready" means for the app process itself

Already in place from Phase 4's observability work (`docs/13`-era code,
see `backend/src/`):
- `GET /health` (liveness) and `GET /ready` (readiness, checks real DB
  connectivity) — wire these into your platform's health-check config.
- Structured JSON logs (`utils/logger.ts`) with automatic redaction of
  passwords/tokens/OTP codes/card fields — safe to ship to any log
  aggregator without an extra scrubbing step.
- `helmet()` security headers and CORS locked to `CORS_ORIGIN` — already
  in `app.ts`, not something to add later.
- Rate limiting on every abuse-prone endpoint category, with limits
  adjustable at runtime via `PlatformSetting` (no redeploy needed to
  tighten a limit under attack).

Not yet in place (real Phase 5 scope, not claimed as done here):
- A process manager / multi-instance orchestration config (PM2 cluster
  mode, or container orchestration replica count) — the app is written
  to be stateless-safe for this (JWT auth, no in-process session state
  except the rate-limiter and Prisma settings cache, which are both
  fine to be per-instance), but no actual multi-instance deploy config
  exists in this repo.
- A CDN / static-asset hosting config for the built frontend bundle.
- TLS termination config (assumed to be handled by the hosting
  platform's load balancer, not the Node process itself).
