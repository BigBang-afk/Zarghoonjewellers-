# Security audit — Phase 1, Step 12 (18 Oct 2026)

**Scope:**

- the website (repository root)
- the Zarghoon core (`core/`)
- the staff dashboard (`admin/`)
- the database migrations and roles

**Method:**

- code review
- secret scans of the working tree and the full git history
- `npm audit`
- automated tests, on PGlite and on real PostgreSQL 16
- an end-to-end run on a disposable staging database

No real customer data, live database, live domain or paid service was used.

## Fixed in this step

| # | Finding | Severity | Fix |
| --- | --- | --- | --- |
| 1 | Website on Next.js 16.3.5: critical RCE in `next/og` (GHSA-vcvr-r3jv-pc5j) plus other advisories | Critical | Upgraded to 16.3.8 (patch release; `eslint-config-next` too). `sharp` and `brace-expansion` updated by `npm audit fix` |
| 2 | Product import: **any** approved `price_change` approval authorised overwriting critical values (price, weight, karat…) on **any** product, with any new value | High | The approval now lists the exact changes (SKU, field, from, to); apply is refused unless the file produces exactly that list. New `--request-approval` CLI flag |
| 3 | Approvals could be edited or reused by anything with database write access (decision reset to pending, payload changed, reused) | High | Migration `20261021000001_approval_integrity`: decisions are final, requests immutable, decided approvals undeletable, single use via `consumed_at` (atomic, concurrency-safe) |
| 4 | Sales Agent grounding counted the **conversation history** as verified facts. An old price from an earlier reply ("stale") or a figure the customer claimed ("contradictory") passed validation | High | Only tool results, the stored profile and staff messages ground facts. A customer's figure may be repeated as a budget but never confirmed as a price |
| 5 | Sales Agent could state invented commitments without numbers ("payment received", "order shipped", "delivered tomorrow", "discount applied", "gold rate is stable") | High | New validator rule (English and Roman Urdu) with negation/condition handling. The same class of claim is now refused in follow-up drafts (`transaction_claim`) |
| 6 | Apps connected with the database owner role (superuser/bypass-RLS on a typical Supabase setup) | Medium | `core/supabase/roles/least_privilege.sql` (`zarghoon_app`, `zarghoon_readonly`) and `npm run db:audit`, verified on staging |
| 7 | Website login had no attempt limit (password guessing) | Medium | 5 failures per username / 20 per address in 15 minutes lock sign-in (in memory, per instance) |
| 8 | Website admin product API (POST/DELETE) had no Origin check (relied only on SameSite=Lax) | Low | Cross-site requests are refused (403) |
| 9 | Demo mode (fake data) could be switched on in a production build by a single setting | Medium | Requires `ZARGHOON_ALLOW_DEMO_IN_PRODUCTION=true` as well, for the chat and the dashboard |
| 10 | Dashboard business time zone was interpolated into SQL (operator-controlled, quotes stripped) | Low | Validated as a real IANA name of safe characters; an invalid value stops the dashboard |
| 11 | No health endpoint for the dashboard | — | Public `GET /api/health` that reveals only up/down |

## Verified as already safe

- **Secrets:** none committed. Only `.env.example` files are tracked, and every value in them is a placeholder. Two `sk-ant-…` strings in tests are obvious fakes, used to test redaction. No real credentials appear in git history.
- **Published website admin password:** refused at sign-in everywhere (`src/lib/security/insecureCredentials.ts`). The seed has no default credentials and refuses weak or published passwords.
- **SQL:**
  - every query is parameterised
  - interpolated fragments are fixed constants or whitelisted column names
  - page offsets are validated integers
- **XSS:**
  - no `dangerouslySetInnerHTML`
  - the embed script's only `innerHTML` is a static template
  - React escapes everything else
- **CSRF:**
  - chat requires a custom header plus a same-origin check
  - dashboard Server Actions have Next.js origin checks, and cookies are SameSite=Strict
- **Logs:**
  - structured JSON through `redact`
  - no message text, phone numbers, emails or connection strings
- **Dashboard authorisation:**
  - every page and action re-reads the session from the database
  - roles and assignment scope are enforced in SQL, and sales/support see only assigned customers
  - covered by `tampering.spec.ts`
- **Approvals:**
  - the AI can request approvals but never decide them; a staff role is required both in the dashboard capability check and in the core service
  - no Sales Agent tool can approve, pay, refund, change prices or orders, or send messages. Unknown tools are rejected (tested with an injection attempt)
- **Human takeover:** a database trigger blocks AI messages during a takeover. Tested end to end.

## Remaining risks (not fixed here)

1. **Rate limits are kept in memory per server instance.** These cover chat, dashboard login, website login and draft generation. With several instances an attacker gets N× the budget. A shared store such as Redis or Upstash is needed before scaling out.
2. **Website sessions are NextAuth JWTs.** They cannot be revoked before expiry. A changed admin password does not end existing sessions. Shorten `maxAge`, or move to database sessions.
3. **Website customer registration** has a 6-character minimum password and no rate limit. It is pre-existing website behaviour, left unchanged so the shop's sign-up is not altered.
4. **Development and build tooling advisories remain:**
   - the `eslint-config-next` glob chain (high, lint only)
   - the Prisma CLI's `deepmerge-ts` (high, CLI only)

   Their fixes need major upgrades (Prisma 7), so they were not forced.
5. **Self-approval:** a manager can approve a request they made themselves. Consider requiring a different approver for money-related types.
6. **Customer data cannot simply be deleted.** Customer rows are protected by foreign keys (leads, conversations…). The append-only audit log is designed to reject the `ON DELETE SET NULL` updates a deletion would cause. A data-deletion request therefore needs a documented manual procedure: anonymise rather than delete.
7. **Multi-factor authentication** is not implemented for the dashboard or the website admin.
8. **Free-text grounding is heuristic.** New ways of phrasing an invented claim may get past the commitment rules. The prompt, the tool design (no transactional tools) and staff review remain the main safeguards.
9. **The live website was not reachable** from the audit environment (network policy). Its hosting, headers and dependencies were not audited.

## Credentials to rotate

- **No Anthropic key** was found in the repository or its history. Any key ever pasted into a chat, issue, log or commit must be treated as compromised. Delete it at <https://console.anthropic.com/settings/keys>, create a new one with a spend limit, and store it only in the host's secret store.
- **The previously published website admin password** is blocked by the code. Any account that used it must still be rotated with `ADMIN_PASSWORD` + `ADMIN_ROTATE_PASSWORD=true`.
