# Management dashboard (core side)

The dashboard app lives in `admin/` (see `admin/README.md`). Its backend is in core, exported as `@zarghoon/core/dashboard`.

| Module | Purpose |
| --- | --- |
| `services/staffAuth/staffAuthService.ts` | Staff sign-in: scrypt hashes, lockout, hashed session tokens, idle/absolute expiry, password change. Migration `20261019000001_staff_auth.sql`. |
| `services/dashboard/access.ts` | Roles → capabilities; the SQL scope predicate for sales/support. |
| `services/dashboard/dashboardService.ts` | Read model: overview metrics, customers, Customer 360 (+ history), leads, conversations, products, sync records, follow-up buckets, handoffs, approvals, activity, orders. Every query is scoped to the viewer. |
| `services/dashboard/dashboardActions.ts` | Staff actions; each checks active staff + scope + role, then calls the existing CRM service. |
| `dashboard/runtime.ts` | `demo` (in-memory, fake data) or `connected` (verified label, no pending migrations). No default and no fallback. |
| `demo/dashboardDemo.ts` | Fake data created through the real services. |
| `scripts/staff-account.ts` | `npm run staff:account` — create/reset staff sign-in (password from a hidden prompt or stdin). |

Metrics are counted, never estimated: revenue is the sum of orders in `confirmed`, `in_production`, `ready` or `delivered`, and shows "Not available" when there are none.

Tests: `tests/integration/staffAuth.test.ts`, `dashboard.test.ts` (data isolation, metrics, Customer 360), `dashboardActions.test.ts` (permissions and business rules), `tests/unit/dashboardConfig.test.ts`.
