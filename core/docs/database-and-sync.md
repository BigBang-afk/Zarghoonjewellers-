# Database setup, migrations and website product sync

This covers connecting Zarghoon AI to a real PostgreSQL/Supabase database,
applying migrations safely, copying the existing website's products into the
Zarghoon AI catalogue, and running the website chat against a persistent
staging database.

Nothing here connects to a database by itself. Every command reads its
connection string from a **server-side environment variable**. You set that
variable yourself, for one command, on a trusted machine.

| Variable | Used by | Notes |
| --- | --- | --- |
| `ZARGHOON_CORE_DATABASE_URL` | `db:migrate`, `products:sync`, `approvals`, `crm:report`, website chat (staging/live) | The Zarghoon AI core database. This credential bypasses RLS. |
| `DATABASE_URL` (core/.env) | `products:import` (CSV importer) | The same core database. |
| `WEBSITE_DATABASE_URL` | `products:sync --source website-db` | The existing website's database. **Use a read-only role.** |

## 1. Create the databases (Supabase)

Use **separate Supabase projects** for staging and production. Never test against production.

1. Create the project. Then open Project Settings → Database → Connection string → **Direct connection** (port 5432) and copy it.
2. Append `?sslmode=require` to the copied string.
3. Keep the connection string in a password manager or your host's secret store. Do not put it in git, and do not put it in any `NEXT_PUBLIC_*` variable.

## 2. Apply migrations: `npm run db:migrate`

The migrator (`src/database/migrator.ts`) records two things in the database itself:
- which environment the database belongs to (`zarghoon_meta`);
- which migrations have been applied, with checksums (`zarghoon_schema_migrations`).

It refuses to run when:
- the database has not been initialised for Zarghoon AI, or is labelled for a different environment than `--env`;
- the database already contains Zarghoon tables that it did not create (e.g. applied by hand or with `supabase db push`);
- an applied migration file was edited, or a new file sorts before an applied one;
- the target is `production` and `--allow-production` was not given. Pass that flag only with the owner's approval.

Each migration runs in its own transaction. If one fails, nothing from it remains.

```bash
cd core
export ZARGHOON_CORE_DATABASE_URL='postgresql://…staging…?sslmode=require'   # this shell only

npm run db:migrate -- --env staging                 # dry run: shows the target (no password) and the plan
npm run db:migrate -- --env staging --init          # once, on an EMPTY database: label it "staging"
npm run db:migrate -- --env staging --apply         # apply pending migrations
```

Use `--env production` for production. It also needs `--allow-production` to make any change.

## 3. Synchronise products from the existing website: `npm run products:sync`

Sync is one-way: from the website into Zarghoon AI. It never writes to the website.

Sources:
- `--source website-db`: this repository's website (`Product` and `ProductImage` tables), read through `WEBSITE_DATABASE_URL`.
  - Weight comes from `netWeight`. `grossWeight` includes the wastage percentage, so it is not a weight.
  - Metal and karat come from a fixed quality table, e.g. "22K Gold (916)" → gold, 22K. A quality not in the table is left unknown.
  - The website stores no SKU, price or stock, so those stay unknown.
- `--source json --file export.json`: a product export from any platform, already converted to the [source product format](../src/services/products/sync/sourceProduct.ts).

SKUs are **never generated**. A product without a SKU is reported as `needs_sku`. It is synced only once the owner adds it to an approved mapping CSV (`source_product_id,sku`) passed with `--sku-map`.

### Rules

| Field | Rule |
| --- | --- |
| Metal, karat, weight, approved price, currency | **Fill only.** Set only when empty in Zarghoon AI. A different source value is flagged and the stored value is kept. |
| Name, description, category, collection, product URL | Updated from the source. |
| Stock | Changed only by an explicit source value (status or quantity). An absent value never means "in stock". |
| Images | New HTTPS URLs are added; existing ones are kept. |
| Products missing from the source | Reported, never deleted or deactivated. |

Every record is validated. Invalid records, duplicate source IDs, duplicate SKUs, and SKUs already linked to another source product are reported and skipped.

### Workflow (preview → approval → apply)

```bash
cd core
export ZARGHOON_CORE_DATABASE_URL='…'  WEBSITE_DATABASE_URL='…read-only role…'

# 1. Preview (writes nothing)
npm run products:sync -- --source website-db --sku-map skus.csv --report preview.json

# 2. Request approval (records the plan's hash)
npm run products:sync -- --source website-db --sku-map skus.csv --request-approval --staff-id <manager uuid>

# 3. An owner/manager approves it
npm run approvals
npm run approvals -- --approve <approval id> --staff-id <owner uuid>

# 4. Apply
npm run products:sync -- --source website-db --sku-map skus.csv --apply --approval-id <id> --staff-id <uuid>
```

`--apply` recomputes the plan inside a locked transaction. If the source or the catalogue changed after approval, the hash will not match and apply is refused. An approval can be used once. Each apply is written to the audit log (`product_sync`).

### Read-only role for the website database

```sql
create role zarghoon_sync_reader login password '<generated>';
grant connect on database <website db> to zarghoon_sync_reader;
grant usage on schema public to zarghoon_sync_reader;
grant select on "Product", "ProductImage" to zarghoon_sync_reader;
```

## 4. Website chat on the persistent database

| `ZARGHOON_CHAT_MODE` | Database | Model |
| --- | --- | --- |
| `demo` | in-memory, DEMO data, lost on restart | Claude if `ANTHROPIC_API_KEY` is set, else the offline stand-in |
| `staging` | `ZARGHOON_CORE_DATABASE_URL` (a **staging** database with test data) | Claude if the key is set, else the offline stand-in |
| `live` | `ZARGHOON_CORE_DATABASE_URL` (production) | Claude (required) |

Staging mode labels the chat **Staging — test data only**.

Check what the chat has stored with the read-only report. It masks phone numbers and emails and does not print message text:

```bash
npm run crm:report
```

The opt-in Playwright spec `e2e/staging.spec.ts` (`E2E_STAGING=1`) checks the staging chat against the sample data in `core/data/staging/`.

## 5. Tests on real PostgreSQL

The suite runs on in-process PGlite by default. To run it on a real server instead, set an admin URL for a **disposable** server:

```bash
ZARGHOON_TEST_PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres npm test
```

Each test file then creates a temporary `zj_test_<random>` database, migrates it with the real migrator, and drops it afterwards.
