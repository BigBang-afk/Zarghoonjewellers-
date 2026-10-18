# Staging deployment plan

This is the plan for an isolated staging copy of Zarghoon AI. It needs **no new paid services**: the free tiers of the providers the project already uses are enough to start. Do not do any of the following without the owner's explicit approval:

- deploy to the live domain
- change DNS
- connect Meta, WhatsApp, Instagram, Facebook or TikTok
- import real customers
- buy anything

## 1. What staging consists of

| Piece | Where | Notes |
| --- | --- | --- |
| Staging core database | A **new, separate** PostgreSQL project (for example a free Supabase project named `zarghoon-staging`) | Never the production database, and never a branch of it with real data. |
| Website + chat API | A preview deployment of this repository (for example a Vercel *Preview* environment) | Gets its own `*.vercel.app` URL. The live domain is not attached. |
| Dashboard | A second project from the `admin/` folder | Its own preview URL, `ZARGHOON_DASHBOARD_MODE=connected`, `ZARGHOON_DASHBOARD_DB_ENV=staging`. |
| Follow-up worker | Optional; `npm run followups:worker -- --env staging --once` run by hand or by a scheduled job | It only prepares drafts and notifications. It never sends anything. |

## 2. Set up the staging database (once)

Run these from a trusted computer. Connection strings come from the environment only, never from command arguments.

```bash
cd core
export ZARGHOON_CORE_DATABASE_URL='<staging OWNER connection string>'   # e.g. Supabase "postgres" role, direct port 5432

npm run db:migrate -- --env staging            # dry run: shows the plan, changes nothing
npm run db:migrate -- --env staging --init     # labels the EMPTY database "staging"
npm run db:migrate -- --env staging --apply    # applies all migrations, each in its own transaction

# Least-privilege roles: re-run after every migration
psql "$ZARGHOON_CORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/roles/least_privilege.sql
psql "$ZARGHOON_CORE_DATABASE_URL" -c '\password zarghoon_app'
psql "$ZARGHOON_CORE_DATABASE_URL" -c '\password zarghoon_readonly'

# Check it, using the connection the apps will use
ZARGHOON_CORE_DATABASE_URL='<staging zarghoon_app connection string>' npm run db:audit -- --env staging

# Staff accounts (passwords are typed in, never passed as arguments)
npm run staff:account -- --env staging --create --name "Owner Name" --role owner --username owner
```

Load only fake data, such as `core/data/staging/` and the fake 555-01xx phone numbers and `@example.invalid` emails. **Do not import real customers into staging.**

## 3. Configure the two preview deployments

- **Website (Preview environment only):**
  - `ZARGHOON_CHAT_MODE=staging`
  - `ZARGHOON_CORE_DATABASE_URL` set to the `zarghoon_app` connection string
  - its own `AUTH_SECRET`
  - a separate staging website database for `DATABASE_URL` / `DATABASE_URL_UNPOOLED`
  - `ANTHROPIC_API_KEY` is optional. Use a **staging-only key** with a low monthly spend limit. Without it, the chat runs the labelled offline stand-in.
- **Dashboard:**
  - `ZARGHOON_DASHBOARD_MODE=connected`
  - `ZARGHOON_DASHBOARD_DB_ENV=staging`
  - `ZARGHOON_CORE_DATABASE_URL` set to `zarghoon_app`
  - `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
  - optionally a staging Anthropic key
- **Never set `ZARGHOON_ALLOW_DEMO_IN_PRODUCTION` on a deployment.**
- **Protect both previews** (for example Vercel "Deployment Protection"), so only you can open them.

See [environment.md](environment.md) for every variable.

## 4. HTTPS, health and logs

- **HTTPS:** Vercel and Supabase serve HTTPS only. In production the dashboard sends HSTS and uses `__Host-` cookies, so it refuses to work over plain HTTP.
- **Health checks:**
  - dashboard: `GET /api/health` returns `{"status":"ok"}` (200) or `{"status":"unavailable"}` (503). It shows no other detail.
  - website: `GET /zarghoon-ai.js` (static) and `GET /api/chat`, which reports whether the chat is available.
  - database: `npm run db:audit -- --env staging`
- **Logs:**
  - Every service writes one-line JSON logs, with secret-looking keys and values redacted.
  - Message text, phone numbers and emails are not logged.
  - Read them in the hosting provider's log viewer and keep them as briefly as its free tier allows.

## 5. Backups and restore

- **Before every migration,** take a manual backup:
  ```bash
  pg_dump --format=custom --no-owner "$OWNER_URL" > zarghoon-<env>-<date>.dump
  ```
  Store it encrypted and outside the repository.
- **Scheduled backups:** Supabase free projects have no point-in-time recovery, so schedule a daily `pg_dump` (for example a GitHub Actions cron job writing to private storage). Before production, consider Supabase's paid daily backups. **That costs money and needs the owner's approval.**
- **Restore:** restore into a **new, empty** database, then check it:
  ```bash
  pg_restore --no-owner -d "$NEW_DB_URL" file.dump
  npm run db:audit -- --env <env>
  ```
  Then point the apps at the restored database. Practise this once on staging before go-live.

## 6. Migration rollback

- Migrations are forward-only, and each one runs in a transaction: a failed migration changes nothing.
- Committed migrations are never edited. Fix forward with a new migration.
- If a released migration causes problems:
  1. Stop the apps: set `ZARGHOON_CHAT_MODE=off` and pause the dashboard deployment.
  2. Either restore the pre-migration backup (section 5), or write and apply a corrective migration on staging first.
  3. Re-run `db:audit`.
- The apps refuse to start against a database with pending migrations or the wrong label. A half-migrated database is never used silently.

## 7. Failure recovery

| Failure | What happens | What to do |
| --- | --- | --- |
| Core database down | Chat replies with a safe "the team will help you" message and logs the error; the dashboard shows "unavailable"; health returns 503 | Restore the service or the backup; no data is guessed meanwhile |
| Claude down, slow or refusing | The Sales Agent falls back to a fixed safe reply and hands off to staff; follow-up drafts fall back to templates | Nothing; check spend and rate limits |
| Leaked key or password | — | Rotate it (section 8) and redeploy |
| Bad deploy | — | Roll back to the previous deployment in the hosting dashboard (instant on Vercel) |

## 8. Credentials

- **Production gets its own credentials:**
  - database and roles
  - `AUTH_SECRET`
  - Anthropic key
  - Blob token
  - staff accounts

  Never copy them from staging.
- **Any Anthropic key that has ever been pasted into a chat, an issue, a log or a commit is compromised.**
  1. Delete it at <https://console.anthropic.com/settings/keys>.
  2. Create a new key with a spend limit.
  3. Store the new key only in the hosting provider's secret store.
  4. Redeploy.
- **Rotate a database password:** run `\password <role>` as the owner, update the secret and redeploy.
- **Rotate the website admin password:** set `ADMIN_PASSWORD` and `ADMIN_ROTATE_PASSWORD=true` for one deploy, then remove both.
- **Rotate a dashboard staff password:** use `npm run staff:account`. Changing a password signs out that person's sessions.

## 9. What must be true before production

Production readiness is tracked in the Step 12 report. In short:

1. The owner verifies the live site and approves the plan.
2. The production database is created and labelled, and its backups are tested.
3. Credentials are separate and rotated.
4. `db:audit` passes as `zarghoon_app`.
5. Staging has been used end to end by the owner with fake data.
6. Customer-facing features (`ZARGHOON_CHAT_MODE=live`) stay **off** until the owner explicitly turns them on.
