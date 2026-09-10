# 17 — Backup & Recovery

## 1. Backups today (SQLite / pilot scale)

`backend/scripts/backup-sqlite.mjs` (run via `npm run backup` from
`backend/`) produces a complete, consistent snapshot of the live
database using SQLite's own `VACUUM INTO` statement — not a raw file
copy, which risks capturing a half-written page if it runs mid-write.
`VACUUM INTO` is safe to run against a database the app is actively
using.

- **Output**: `backend/backups/rivo-<ISO-timestamp>.db` — gitignored,
  never committed.
- **Retention**: the script prunes to the newest N backups after each
  run (`--retain=N`, default 14). Verified locally: running it
  repeatedly with `--retain=2` correctly kept only the 2 newest files
  and deleted the rest.
- **Schedule**: not automated yet — run manually or wire it into a cron
  job / scheduled CI job pointed at the production host. A sensible
  pilot cadence is daily, matching the 14-backup default retention (two
  weeks of daily snapshots).

This tool is explicitly scoped to SQLite (`file:` datasource URLs) and
refuses to run against anything else — see §2 for what replaces it once
production moves to Postgres.

## 2. Backups for real production (Postgres)

Once the datasource moves to Postgres
(`docs/15-production-configuration.md` §2), replace this script with
the managed database's own backup mechanism rather than reimplementing
one:
- **Managed Postgres (RDS/Cloud SQL/etc.)**: enable automated daily
  snapshots with point-in-time recovery. This is a platform setting, not
  application code.
- **Self-managed Postgres**: `pg_dump` on a schedule, or continuous WAL
  archiving for point-in-time recovery if the RPO in §4 demands it.

The `backup-sqlite.mjs` script's *retention logic* (keep-newest-N,
prune-the-rest) is a reasonable pattern to mirror in whatever replaces
it, even though the underlying mechanism changes completely.

## 3. What's protected from accidental deletion

Financial and ride records are never hard-deleted by any code path in
this system:

- **Account deletion** (`docs/`/Phase 4 §26, `api/admin/privacy.ts`)
  anonymizes the `User` row's own PII (name, phone, email, password
  hash) — it never deletes `Ride`, `Payment`, `Transaction`, or
  `Commission` rows. Those stay intact, referencing the now-anonymous
  user id, so accounting/audit history is never lost to a user's
  deletion request.
- **Admin panels** have no "delete ride" / "delete payment" / "delete
  transaction" endpoint anywhere in `src/api/admin/` — checked directly
  against the router source, not assumed. The closest things to
  deletion are status transitions (`cancelled`, `refunded`, `disputed`)
  which are additive audit trail, not row removal.
- **`AuditLog` rows** (who changed what, when) are append-only — no
  update or delete endpoint exists for them either.

The one place actual row deletion happens outside of tests/seed data is
narrow and intentional: the cleanup background job
(`backend/src/jobs/cleanupJob.ts`) deletes only *already-expired* OTP
codes and revokes (doesn't delete) expired refresh tokens — neither is
financial or ride data.

## 4. Recovery objectives (targets, not measured guarantees)

These are the targets this setup is designed for at pilot scale — not a
claim that they've been tested against a real production incident,
since no production incident has occurred:

| | Target |
|---|---|
| RPO (Recovery Point Objective) | ≤ 24 hours, matching the daily backup cadence in §1 |
| RTO (Recovery Time Objective) | Time to provision a fresh instance + restore the latest backup file — minutes for the SQLite case (§5), platform-dependent for managed Postgres restore |

Tightening RPO (e.g. hourly backups, or continuous WAL archiving once on
Postgres) is a scheduling/infra change, not an application change.

## 5. Restore procedure (SQLite / pilot)

1. Stop the backend process (or take it out of the load balancer if
   running more than one instance — though see
   `docs/15-production-configuration.md` §2 on why SQLite doesn't
   actually support multiple concurrent-writer instances in the first
   place).
2. Copy the chosen backup file over the live database path:
   ```
   cp backend/backups/rivo-<timestamp>.db backend/prisma/dev.db
   ```
   (or whatever `DATABASE_URL`'s `file:` path resolves to in that
   environment).
3. Restart the backend. `prisma generate`/`migrate deploy` are not
   needed for this step — the backup already contains the schema as of
   whenever it was taken.
4. **If the restored backup predates a since-applied migration**: run
   `npx prisma migrate deploy` after restoring, so the restored database
   catches back up to the current migration history. Verify with
   `npx prisma migrate status`.
5. Confirm `GET /ready` returns `{ ok: true }` before resuming traffic.

## 6. Migration rollback procedure

Prisma migrations are forward-only by design — there is no
`prisma migrate down`. Two ways a bad migration gets undone, in order of
preference:

1. **Roll forward with a corrective migration** (preferred whenever the
   bad migration didn't cause data loss): write a new migration that
   reverses the change (drop the column that shouldn't have been added,
   etc.) and deploy it normally. This preserves the migration history's
   integrity and works whether or not a restore is also needed.
2. **Restore from backup** (when the migration already caused data
   loss, e.g. an unwanted `DROP COLUMN` that took real data with it):
   follow §5, restoring to the last backup taken *before* the bad
   migration ran, then re-apply only the migrations that were fine.

Either way: a migration that changes or removes data (not just adds it)
should have a backup taken immediately before it runs in production, on
top of the regular schedule in §1 — cheap insurance against exactly this
scenario.
