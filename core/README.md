# Zarghoon AI — Core

The business backend of **Zarghoon AI**, the operating system for Zarghoon
Jewellers. It is a modular TypeScript monolith over PostgreSQL (Supabase).
All business facts, rules and audit live here. Future AI agents only call
these services through validated tools.

**Current phase:** Phase 1, Sales + CRM + Product Intelligence. The CRM
foundation, the Claude-powered **Sales Agent** and the **website chat**
(demo mode by default in development) are built. WhatsApp, Instagram,
Facebook, TikTok, Google Business and ads are **not connected**, by design.

## What's here

| Area | Capabilities |
| --- | --- |
| Products | search, lookup, deterministic inventory status, safe CSV import ([docs/products.md](docs/products.md)) |
| Customers | normalized identifiers, identity matching, conflict detection (no auto-merge), do-not-contact |
| Leads | lifecycle, deterministic 0–100 scoring with audit trail, duplicate-signal protection |
| Product interests | fact-based tracking that feeds scoring |
| Conversations | channel-agnostic messages, idempotent ingestion, human takeover |
| Follow-ups | scheduling rules (records only, nothing is sent) |
| Customer 360 | single read model for the future Sales Agent |
| Handoff | human takeover with reason/urgency, AI replies blocked in code and DB |
| Approvals & audit | approval workflow for sensitive actions; append-only, redacted audit log |
| Sales Agent | Claude tool-use agent over the services above, with code-enforced fact grounding and handoffs ([docs/sales-agent.md](docs/sales-agent.md)) |
| Website chat | Session-isolated website channel over the Sales Agent: rate limits, product cards, contact capture ([docs/website-chat.md](docs/website-chat.md)) |

Read **[docs/crm.md](docs/crm.md)** for the CRM rules and
**[docs/sales-agent.md](docs/sales-agent.md)** for the Sales Agent.

Try the agent: `npm run sales` (in-memory demo data; uses Claude when
`ANTHROPIC_API_KEY` is set, otherwise an offline stand-in).

## Layout

```
core/
  supabase/migrations/   SQL migrations (never edit a committed one; add a new file)
  src/
    agents/              llm client abstraction + Sales Agent (prompt, tools, executor, validator, safety)
    config/              env loading, owner-approved business info (Zod)
    database/            Db interface, node-postgres adapter, in-memory PGlite (dev/test only)
    demo/                DEMO fixtures and offline demo model
    lib/                 errors, money (decimal), identifiers, redaction, logger, validation
    schemas/             domain types, enums and row mappers
    services/
      products/          product service + import pipeline
      crm/               customers, leads, scoring, interests, conversations,
                         follow-ups, handoff, Customer 360
      approvalService.ts, auditService.ts, staffRules.ts
    types/               ActionContext, Clock
    index.ts             createZarghoonCore({ db }) composition root
  tests/
    unit/                pure logic
    integration/         services against real SQL (in-process PGlite)
  scripts/               CLIs (product import, sales playground, live agent check)
  data/                  sample CSV (no real prices)
  docs/                  documentation
```

## Getting started

Requires Node 20+.

```bash
cd core
npm install
npm run typecheck
npm test            # no database or credentials needed
```

Tests run against **PGlite**, a real PostgreSQL compiled to WebAssembly,
in-process, with the actual migrations applied. Constraints, triggers and RLS
are therefore exercised for real, and nothing touches a live database. One
optional test exercises the production `pg` driver against a **disposable**
Postgres:

```bash
TEST_DATABASE_URL=postgres://... npx vitest run tests/integration/pgAdapter.test.ts
```

CI (`.github/workflows/core-ci.yml`) runs both.

### Database (Supabase)

```bash
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations in order
```

On plain Postgres (e.g. Neon), apply the files in `supabase/migrations/` in
filename order. The RLS migration skips Supabase-only roles if they are
absent.

### Environment

Copy `.env.example` to `.env` (gitignored). `DATABASE_URL` is a **server-only**
credential that bypasses RLS. Never expose it to browser code.

## Usage

```ts
import { createPgDb, createZarghoonCore } from "./src/index.js";

const core = createZarghoonCore({ db: createPgDb(process.env.DATABASE_URL!) });
const ctx = { actor: { type: "ai", agentName: "sales_agent" }, requestId: "req-123" } as const;

const { customer } = await core.customers.createCustomer({ phone: "0300-1234567" }, ctx);
const lead = await core.leads.createLead({ customerId: customer.id, sourceChannel: "website" }, ctx);
await core.productInterests.recordProductInterest(
  { customerId: customer.id, sku: "ZJ-NK-001", interestType: "asked_price" }, ctx);
const c360 = await core.customer360.getCustomer360(customer.id);
```

## Security model

- All access goes through server code. RLS is enabled on every table with no
  policies, and `anon`/`authenticated` grants are revoked. Browsers get
  nothing directly, not even products, because that table holds internal
  cost columns.
- All SQL is parameterized. Dynamic column names come only from fixed
  whitelists.
- Secrets come only from environment variables. Logs and audit entries are
  redacted, and message metadata containing secrets is rejected.
- `toPublicError` exposes business errors and hides infrastructure details.
