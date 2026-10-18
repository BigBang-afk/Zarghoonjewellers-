# Zarghoon AI — Management Dashboard

A private, staff-only dashboard for Zarghoon Jewellers: customers, leads,
conversations, products, follow-ups, human handoffs, approvals and the audit
log. It is a **separate Next.js app** from the public website (the website's
code could not be verified as the live store), and it reads and writes only
through the Zarghoon AI core services in `../core`.

> Do not deploy this publicly without the owner's approval. It holds private
> customer information.

## Run it locally (demo mode, fake data)

```bash
cd core && npm install && cd ..
cd admin && npm install
cp .env.example .env.local
# edit .env.local: set ZARGHOON_DEMO_PASSWORD to a password you choose (12+ chars, letters and numbers)
npm run dev            # builds core, then http://localhost:3100
```

A gold **DEVELOPMENT DEMO — FAKE DATA** banner is shown on every page. Demo
data lives in memory and is recreated on restart.

### Demo accounts

| Username | Role | Sees |
| --- | --- | --- |
| `demo-owner` | owner | everything, approvals, audit, demo reset |
| `demo-manager` | manager | everything, approvals, audit |
| `demo-sales` | sales (Ali) | only Ali's customers + the unassigned handoff queue |
| `demo-sales2` | sales (Sara) | only Sara's customers + the queue |
| `demo-support` | support | only assigned customers + the queue |

All use the `ZARGHOON_DEMO_PASSWORD` you set.

## How to…

1. **Log in** — open http://localhost:3100, sign in as `demo-owner`.
2. **View customers** — *Customers* in the sidebar. Search by name, phone, email or city; filter by lead status, temperature, language; sort by last contact, score, name or date.
3. **See hot leads** — *Overview → Hot leads / Very hot leads*, or *Leads* and the *Hot* / *Very hot* tabs.
4. **Open Customer 360** — click a customer's name. You see identity and contact, messages (customer / AI / staff / system), interested pieces, the score breakdown, follow-ups, orders, handoff status and assigned salesperson.
5. **Check product inventory** — *Products*. Filter by stock status or "missing" information. Unknown price, weight, karat or stock shows **Needs confirmation**. Approvers also see *Sync & import records*.
6. **Manage follow-ups** — *Follow-ups* tabs: Today, Overdue, Upcoming, Completed, Cancelled. Mark completed or cancel. Schedule new ones from a customer or lead page. Nothing is sent to the customer.
7. **Test human handoff** — sign in as `demo-sales`, open *Human Handoffs*, **Take over** the discount request (AI stays paused, the conversation and lead become yours), then **Resolve** — tick "Hand the conversation back to the AI" to let the AI reply again.
8. **Reset demo data safely** — sign in as `demo-owner` → *Settings* → **Reset demo data**. It only exists in demo mode; the server refuses it in connected mode.

## AI Follow-up Center (Step 9)

Drafts are prepared from verified CRM data and **never sent**. Approving a draft marks it ready for a future, permitted channel. Details: `core/docs/followup-engine.md`.

1. **Open the Follow-up Center** — *AI Follow-ups* in the sidebar. Tabs: Due today, Overdue, Upcoming, Drafts to review, Approved (not sent), Needs attention, Completed, Cancelled, History. "Suggested follow-ups" come from fixed rules.
2. **Select a customer** — click a name to open the follow-up (or *Open Customer 360*).
3. **Generate a draft** — *Generate AI draft*. With `ANTHROPIC_API_KEY` set on the server, Claude writes it; otherwise a reviewed template is used and labelled "not AI". Every draft is checked by fixed rules (no unverified prices, discounts, delivery dates, gold rates or stock claims).
4. **Review** — read the draft, its "why", and the Eligibility panel; edit it (a new version that still needs approval).
5. **Approve or reject** — *Approve draft* / *Reject draft*. Approved = "Approved — not sent".
6. **Reschedule** — *Manage → Reschedule*. Customer follow-ups move out of quiet hours (21:00–10:00 Pakistan time by default; owners can change it in Settings).
7. **Test do-not-contact protection** — open *DEMO Sana Iqbal* (opted out): no follow-ups can be scheduled. Open *DEMO Kamran Shah* as `demo-sales2` (no consent recorded): customer follow-ups are refused until consent is recorded under *Contact permissions*.
8. **View history** — the *History* tab, each follow-up's draft history and activity log, *Notifications*, and *Analytics* (delivery, response time and conversion are "Not available" because nothing is sent).

Managers can run *Process due follow-ups now*; in connected mode run `npm run followups:worker` (core) from a scheduler.

## Connected mode (staging or production database)

```bash
# 1. Database must be initialised and migrated with the core migrator (see core/docs/database-and-sync.md)
cd core
ZARGHOON_CORE_DATABASE_URL=… npm run db:migrate -- --env staging --apply

# 2. Give staff a sign-in (password typed at a hidden prompt, never as an argument)
ZARGHOON_CORE_DATABASE_URL=… npm run staff:account -- --env staging --create --name "Owner Name" --role owner --username owner

# 3. Run the dashboard
cd ../admin
ZARGHOON_DASHBOARD_MODE=connected ZARGHOON_CORE_DATABASE_URL=… ZARGHOON_DASHBOARD_DB_ENV=staging npm run build && npm start
```

The dashboard refuses to start (and shows *Dashboard unavailable*, with no
data) if the database is unreachable, carries a different environment label,
or has pending migrations. It never falls back to demo data.

## Security model

- **Separate staff sign-in** (core `staff_credentials`): scrypt password hashes, 5 failures lock an account for 15 minutes, per-address and per-username rate limits. The website's customer accounts and its seeded admin are not used.
- **Sessions**: random 256-bit token in an HttpOnly, SameSite=Strict cookie (`__Host-` + Secure in production); only its SHA-256 is stored. 2 hours idle / 12 hours maximum; ends immediately on sign-out, password change or deactivation.
- **Server-side authorization everywhere**: every page and Server Action re-reads the session from the database. Role and scope are enforced in core SQL (`core/src/services/dashboard`), not by hiding buttons. Records outside a user's scope are "not found".
  - owner / admin / manager: whole business, approvals, audit, internal costs.
  - sales / support: only customers they are assigned to (lead, conversation, follow-up or handoff) plus the open unassigned handoff queue.
- **Mutations use the existing CRM services** (follow-up rules, do-not-contact, closed leads, approver roles, "AI cannot release a takeover"), which also write the audit log. Customer 360 and conversation views are audited too.
- **Headers**: CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `noindex`, `Cache-Control: no-store`, HSTS in production. No secrets or database code reach the browser.
- **Not yet implemented**: sending messages to customers, editing products/prices/stock, staff management in the UI (use the CLI), order management, multi-factor authentication, a shared rate-limit store for multiple instances.

## Tests

```bash
npm run typecheck && npm run lint
npm test                                        # component tests (Vitest + Testing Library)
E2E_DEMO_PASSWORD=… npx playwright test         # end-to-end against demo mode (port 3100)
cd ../core && npm test                          # services, authorization and data-isolation tests
```
