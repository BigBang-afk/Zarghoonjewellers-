# Environment variables

This page lists every setting for the three parts of the project. **No values are given here.** Secrets belong in the hosting provider's secret store or in local `.env.local` files, which are git-ignored. Never commit an `.env` file.

The three parts are:

| Part | Folder | Runs as |
| --- | --- | --- |
| Website (shop pages, admin, AI chat API) | repository root | Next.js app |
| Zarghoon dashboard (staff only) | `admin/` | Separate Next.js app on its own URL |
| Zarghoon core (database, Sales Agent, follow-ups, CLI tools) | `core/` | Library plus command-line scripts |

**Secret** below means: keep it server-side only. It must never appear in browser code, logs, screenshots or chat.

## Safe defaults

A production build with nothing configured does the following:

- **Website chat is off.** `ZARGHOON_CHAT_MODE` defaults to `off`.
- **The dashboard refuses to start.** It has no default mode.
- **Demo data is refused in production.** Demo mode in a production build (`NODE_ENV=production`) is blocked for both the chat and the dashboard unless `ZARGHOON_ALLOW_DEMO_IN_PRODUCTION=true`. That value is meant only for a local preview of a production build. Never set it on a deployed site.
- **Nothing is ever sent to customers.** There is no WhatsApp, SMS, email, Instagram or Facebook sending code. Follow-up drafts stop at "approved — not sent".

## Website (repository root)

| Variable | Secret | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Website (Prisma) database: shop products, website accounts. Pooled connection. |
| `DATABASE_URL_UNPOOLED` | yes | Direct connection, used by Prisma migrations. |
| `AUTH_SECRET` | yes | Signs website login sessions. Use a random value of at least 32 bytes, different in every environment. |
| `AUTH_TRUST_HOST` | no | `true` behind a trusted proxy or host (Vercel sets it automatically). |
| `BLOB_READ_WRITE_TOKEN` | yes | Product image uploads (Vercel Blob). |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | yes | Used only by the seed to create the first website admin. The password must be at least 12 characters with letters and numbers. Published passwords are refused. |
| `ADMIN_ROTATE_PASSWORD` | no | `true` to rotate an existing admin's password from `ADMIN_PASSWORD` during the seed. |
| `ZARGHOON_CHAT_MODE` | no | `off` (production default), `staging`, `live` or `demo` (development default). |
| `ZARGHOON_CORE_DATABASE_URL` | yes | Zarghoon core database, required for `staging` and `live`. Use the least-privilege `zarghoon_app` role. |
| `ANTHROPIC_API_KEY` | yes | Claude. Required for `live`. Without it, `staging` and `demo` use a clearly labelled offline stand-in. |
| `ZARGHOON_ALLOW_DEMO_IN_PRODUCTION` | no | Only for a local production-build preview with fake data. |
| `ZARGHOON_CHAT_DEBUG` | no | Internal debug output. Ignored in production builds. |
| `ZARGHOON_CHAT_SESSION_PER_MINUTE` / `_SESSION_PER_DAY` / `_IP_PER_MINUTE` / `_GLOBAL_PER_DAY` | no | Chat rate limits and the daily cost cap. Defaults: 8, 80, 20, 2000. |
| `ZARGHOON_AI_SERVICE_ONLY` | no | `true` serves only the chat surfaces (when this app is only the chat service for another website). |
| `ZARGHOON_EMBED_ALLOWED_ORIGINS` | no | Sites allowed to embed the chat (`frame-ancestors`). |
| `ZARGHOON_EMBED_CROSS_SITE` | no | `true` for partitioned cookies when embedded on another domain. |
| `SALES_AGENT_MODEL`, `SALES_AGENT_EFFORT`, `SALES_AGENT_MAX_TOKENS`, `SALES_AGENT_TIMEOUT_MS`, `SALES_AGENT_REFUSAL_FALLBACK` | no | Optional Sales Agent tuning (see `core/docs/sales-agent.md`). |
| `BUSINESS_INFO_PATH` | no | Owner-approved store information (address, hours, payment methods). If it is unset, the AI says it does not know. |

## Dashboard (`admin/`)

| Variable | Secret | Purpose |
| --- | --- | --- |
| `ZARGHOON_DASHBOARD_MODE` | no | `connected` (a real database) or `demo` (fake data in memory). Required: there is no default and no fallback. |
| `ZARGHOON_CORE_DATABASE_URL` | yes | Core database for `connected` mode. Use the `zarghoon_app` role. |
| `ZARGHOON_DASHBOARD_DB_ENV` | no | `staging` or `production`. The database's own label must match it, or the dashboard refuses to start. |
| `ZARGHOON_DEMO_PASSWORD` | yes | Shared password for the demo accounts (demo mode only). |
| `ZARGHOON_ALLOW_DEMO_IN_PRODUCTION` | no | As above. Local preview only. |
| `ZARGHOON_BUSINESS_TIMEZONE` | no | IANA zone; default `Asia/Karachi`. Invalid values stop the dashboard. |
| `ZARGHOON_DASHBOARD_LOGINS_PER_MINUTE` / `_PER_HOUR` | no | Login rate limits per address. Separately, accounts lock after 5 failed attempts for 15 minutes. |
| `ZARGHOON_DRAFTS_PER_MINUTE` | no | Limit on AI draft generation per staff member (default 10). |
| `ZARGHOON_FOLLOWUP_DRAFTER` | no | `template` forces offline templates even when a key is set. |
| `ANTHROPIC_API_KEY` | yes | Optional. AI-written follow-up drafts, which are always validated and staff-reviewed. |
| `FOLLOWUP_DRAFT_EFFORT` | no | Claude effort for drafts (default `low`). |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | yes | Set the same value on every instance when running more than one. |

## Core command-line tools (`core/`)

| Variable | Secret | Used by |
| --- | --- | --- |
| `ZARGHOON_CORE_DATABASE_URL` | yes | `db:migrate` (owner role), `db:audit` (the role being checked), `products:sync`, `approvals`, `crm:report` (the `zarghoon_readonly` role is enough), `followups:worker`, `staff:account` |
| `WEBSITE_DATABASE_URL` | yes | `products:sync --source website-db` (read-only `zarghoon_sync_reader` role) |
| `DATABASE_URL`, `ALLOW_TEST_SKUS` | yes / no | `products:import` |
| `ZARGHOON_ENV`, `SALES_PLAYGROUND_DATABASE_URL` | no / yes | Developer playground only (never production) |
| `ZARGHOON_TEST_PG_ADMIN_URL` | yes | Tests on a **disposable** PostgreSQL server |

## Separate credentials per environment

Staging and production must not share any of the following:

- database, database roles and passwords
- `AUTH_SECRET`
- `ANTHROPIC_API_KEY` (use a separate Anthropic workspace or key with its own spend limit)
- Blob token
- dashboard staff accounts

A leaked staging secret must never unlock production.
