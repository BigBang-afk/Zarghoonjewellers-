# 13 — Phase 3 Completion Report

Phase 3 objective: upgrade RIVO from a basic ride-hailing MVP (Phase 2) into
a polished, intelligent, marketplace-ready V1 — smarter matching and
pricing, a passenger wallet and promotions/referrals/loyalty layer, driver
incentives, scheduled and business rides, a real trust/safety/dispute
system, fraud monitoring, and a much deeper admin operations surface —
while preserving the Phase 1/2 architecture, database, design system, and
working ride flow. No existing feature was redesigned; everything below is
additive or a targeted fix to something Phase 2 got wrong.

---

## 1. Features implemented

**Smart matching & pricing**
- Matching engine rewritten to a transparent, admin-configurable weighted
  score (ETA, acceptance rate, rating, idle-time fairness, optional
  favorite-driver boost) with a full per-factor breakdown returned
  alongside every candidate — never a black box, never a protected
  characteristic.
- Location-freshness filtering: a driver whose last location ping is older
  than a configurable window is excluded from matching rather than shown
  at a stale position.
- Fare estimate now returns a labeled range (`suggestedFare`,
  `minimumFare`, `typicalRangeLow/High`, `isEstimate: true`) instead of a
  single number presented as exact.
- Live demand heat-map (`GET /admin/demand-map`) computed from real
  online-driver/open-request/recent-ride density on a configurable grid —
  no simulated data, read-only visibility (pricing still only moves
  through the existing `FareRule` surge bounds).
- Counter-offer round limit and max-deviation-percentage guardrails, both
  admin-configurable.
- "N drivers are considering your request" status messaging surfaced on
  the offers endpoint and in the passenger UI.

**Passenger monetization & loyalty**
- Wallet: balance, top-up (via the existing `PaymentProvider`
  abstraction), transaction history — wired end-to-end including a
  frontend Wallet screen.
- Promotions: admin-managed codes with discount type/value/max discount/
  min fare/city/vehicle-type/new-users-only/usage-limit/expiry, redemption
  tracked via a DB-unique `(promotion, user)` constraint so a race can't
  double-redeem.
- Referral system: auto-generated code per user at registration, applied
  at registration or later, self-referral and duplicate-account guards
  (userId match and phone/email match), reward paid to both sides only
  after a configurable qualifying ride count.
- Favorite drivers: only after an actual completed ride together, threaded
  through dispatch as a soft preference (never a guarantee), with a
  post-rating "save as favorite" prompt in the passenger UI.
- Scheduled rides: book ahead of time, a periodic sweep converts a due
  `ScheduledRide` into a real `RideRequest` through the same dispatch path
  a normal booking uses.
- Business accounts: company/employee architecture with a member-facing
  dashboard (rides, spending, per-employee breakdown) — deliberately no
  invoicing/net-terms engine (Phase 4+, per the original brief).

**Driver monetization**
- Earnings center: today/week/month, 14-day/8-week/6-month charts, real
  earnings-per-hour computed from `DriverOnlineSession` logs (not an
  approximation), cancellation rate.
- Incentive campaigns: admin-configured target-ride-count + reward,
  automatic progress tracking and payout on completion, driver-facing
  progress bars.

**Trust, safety & disputes**
- Driver document submission + workflow
  (`pending → under_review → approved/rejected → expired`), never shows
  "verified" until an admin has actually approved.
- Document-expiration sweep: warns once inside a configurable window,
  flips a document (and the driver/vehicle) out of "approved" the moment
  it actually expires; an admin document-expiry queue endpoint.
- Blocking: a passenger or driver can block someone they've actually
  shared a ride with; excluded from future matching in both directions.
- Support Center: passenger/driver-facing ticket creation across 8
  categories, admin assignment/status management (already existed) plus
  the missing user-facing creation/listing endpoints.
- Disputes: direct ride-level filing (with evidence attachments) in
  addition to the existing safety-report path; five distinct admin
  actions (request more info, refund, adjust driver payout, close/reject)
  each with its own audit-log entry and wallet-transaction trail.

**Fraud/abuse monitoring**
- `RiskEvent`/`RiskScore` model with severity-weighted scoring; signals
  wired for unusual cancellation rate, impossible driver-movement speed,
  promo-reuse attempts, and referral self-dealing.
- Admin manual-review queue, per-user risk detail, mark-reviewed action,
  and a fully separate, explicit, audited user status-change action — no
  signal ever auto-punishes an account.

**Admin operations**
- Live-ops summary: active rides, pending requests, online/stale-location
  drivers, recent cancellations, open safety incidents/disputes/support
  tickets in one filterable view.
- Passenger, driver, and marketplace analytics (activation rate,
  acceptance/cancellation/rating averages, take rate, booking-mode/
  payment-method splits).
- Weekly cohort retention analytics for passengers and drivers (first-ride,
  7-day, 30-day return rates).
- Vehicle-type CRUD + per-city vehicle-type activation toggle; city
  operating-hours field now editable.
- Admin sub-role RBAC enforced on every mutating admin endpoint
  (previously any authenticated admin could do anything — see §7).

**Notifications**
- Per-user notification preferences with non-disableable safety/system
  types (already existed; extended the `NotificationType` union with
  `payment`/`support` for the new flows above).

---

## 2. Files created / modified

Backend — new files:
```
src/services/promoService.ts, referralService.ts, incentiveService.ts,
             riskService.ts, safetyService.ts, verificationService.ts,
             disputeService.ts, scheduledRideService.ts
src/api/account/router.ts, business/router.ts, support/router.ts
src/api/admin/business.ts, risk.ts, analytics.ts
src/middleware/sanitizeResponse.ts
tests/phase3.test.ts
```
Backend — significantly modified: `prisma/schema.prisma` (+13 new models,
extended ~10 existing ones), `src/types/enums.ts`, `src/config/settings.ts`
(~20 new keys), `src/services/matchingEngine.ts` (rewritten),
`fareEngine.ts`, `negotiationEngine.ts`, `rideRequestService.ts`,
`rideLifecycleService.ts`, `bookingService.ts`,
`notifications/NotificationService.ts`, `api/rides/router.ts`,
`api/passenger/router.ts`, `api/driver/router.ts`, `api/auth/router.ts`,
`api/admin/{dashboard,config,verification,trust,router}.ts`, `app.ts`
(route-order fix, see §7), `server.ts` (two new sweep intervals),
`prisma/seed.ts` (rewritten for scale — see §46/this report §1).

Frontend — new: `pages/passenger/WalletPanel.tsx`. Modified:
`api/{admin,driver,passenger,rides}.ts`, `types/index.ts`,
`pages/admin/AdminDashboard.tsx`, `pages/driver/EarningsPanel.tsx`,
`pages/passenger/{CustomerHome,OffersPanel,RatingPanel}.tsx`.

`docs/13-phase-3-completion-report.md` — this file.

---

## 3. Database migrations

Five migrations applied on top of Phase 2's schema (all committed under
`backend/prisma/migrations/`):

1. `20260910051845_phase3_marketplace_intelligence` — the bulk of the new
   schema: `IncentiveCampaign`, `DriverIncentiveProgress`,
   `IncentiveReward`, `ReferralCode`, `Referral`, `FavoriteDriver`,
   `ScheduledRide`, `BusinessAccount`, `BusinessEmployee`, `RiskEvent`,
   `RiskScore`, `NotificationPreference`, `PromoRedemption`,
   `DriverOnlineSession`, plus new columns on `City`, `FareRule`,
   `RideRequest`, `Ride`, `Promotion`, `SupportTicket`.
2. `20260910052117_promotion_rule_fields` — `Promotion.minFare`,
   `vehicleTypeId`, `newUsersOnly`.
3. `20260910053840_scheduled_ride_vehicle_type_relation` — fixed a missing
   `ScheduledRide ↔ VehicleType` relation caught by the TypeScript build.
4. `20260910054249_safety_trust_disputes_upgrade` — `UserBlock` model,
   `Dispute.decision`, extended `Dispute`/`DriverDocument`/
   `VehicleDocument` fields (`expiryWarnedAt`, new status values).

Postgres note unchanged from Phase 2 (§3 of that report): SQLite string
enums / float money are documented compromises with a mechanical
migration path once a Postgres `DATABASE_URL` is used.

---

## 4. New API endpoints

```
POST   /v1/passenger/wallet/topup            GET /v1/passenger/wallet
POST   /v1/passenger/promo/validate
GET/POST/DELETE /v1/passenger/favorites[/:driverId]
POST/GET/PATCH/DELETE /v1/passenger/scheduled-rides[/:id]

GET/POST /v1/driver/me/documents
GET      /v1/driver/me/incentives
(rewritten) GET /v1/driver/me/earnings, /me/transactions

POST/GET /v1/rides/:id/disputes
GET      /v1/ride-requests/:id/offers        (extended: statusMessage/pendingCount)

GET/POST/DELETE /v1/safety/blocks[/:userId]

GET/POST /v1/support/tickets, GET /v1/support/tickets/:id

GET/POST /v1/account/referral[/apply]
GET/PUT  /v1/account/notification-preferences

GET/POST /v1/business/accounts, GET /v1/business/accounts/:id/dashboard,
GET /v1/business/accounts/:id/employees

Admin:
GET/POST/PUT  /v1/admin/promotions, /v1/admin/incentive-campaigns
GET/POST/PATCH /v1/admin/vehicle-types, PUT /v1/admin/cities/:id/vehicle-types/:id
GET/POST       /v1/admin/business-accounts[/:id/employees]
GET            /v1/admin/drivers/document-expiry-queue
GET            /v1/admin/demand-map, /v1/admin/live-ops/summary
GET            /v1/admin/analytics/{passengers,drivers,marketplace,cohorts}
GET            /v1/admin/risk/queue, /v1/admin/risk/users/:userId
POST           /v1/admin/risk/events/:id/review
PATCH          /v1/admin/users/:id/status
POST           /v1/admin/disputes/:id/{request-info,refund,adjust,close}
```

---

## 5. New environment variables

None. Every Phase 3 feature is configured through the existing
`PlatformSetting` admin-configurable key-value store (~20 new keys — fare
range spread, matching weights, location-staleness window, counter-offer
limits, referral rewards/qualifying count, document-expiry warning window,
risk thresholds, scheduled-ride dispatch lead time) rather than new env
vars, consistent with the anti-hardcoding pattern established in Phase 2.

---

## 6. Testing results

- Backend: **24/24 Vitest + Supertest tests passing** — the existing 12
  from Phase 2 (`tests/rideFlow.test.ts`, unmodified and still green) plus
  12 new (`tests/phase3.test.ts`): promo redemption + reuse/city-scope
  guards, referral self-referral guard + reward payout on a qualifying
  ride, wallet top-up, favorite-driver completed-ride gate, counter-offer
  deviation and round-limit guardrails, a race condition (accepting an
  offer that expired a moment before the accept request landed), dispute
  filing + admin refund crediting the passenger's wallet, and admin
  sub-role RBAC (a `support_agent` blocked from settings but allowed on
  support tickets; `super_admin` bypasses).
- `tests/fixtures.ts`'s `resetDb()` wipe order extended to cover every new
  table in FK-safe order.
- `npx tsc` clean on both `backend` and `frontend` (strict mode,
  `noUnusedLocals`/`noUnusedParameters` on).
- `vite build` succeeds (421 KB / 125 KB gzipped bundle).
- **Live end-to-end scenario** run against a real running server with the
  full seed dataset, exactly the scenario specified for this phase:
  register → OTP verify → fare estimate (range) → Set My Price Rs 650 →
  competitive-offer dispatch → driver counters Rs 700 → passenger compares
  and selects the counter → live-location updates → arrive → start →
  complete → payment captured → commission recorded → driver payout
  transaction → driver earnings endpoint reflects it → ratings both
  directions → admin marketplace analytics and dashboard KPIs update.
  Every step additionally verified directly against the database (not
  just the HTTP response) — **all checks passed**, including confirming
  `passwordHash` never appears in an API response.

---

## 7. Security fixes

- **Critical routing bug (found during this phase's frontend work,
  pre-existing since Phase 2)**: `app.ts` mounted the broad `/v1`
  `ridesRouter` — which requires auth for every path under it — *before*
  the specific `/v1/public/*` mount. Express matches `app.use()` prefixes
  in registration order, so `ridesRouter`'s blanket `requireAuth` was
  intercepting every unauthenticated `/v1/public/*` request, including the
  city/vehicle-type lookups the registration screens call before a user
  has a token, and the no-account trip-sharing link. Fixed by reordering
  so specific routers register first; verified live (`/v1/public/cities`
  now 200s with no auth header, ride routes still 401 correctly).
- **`passwordHash`/`tokenHash` leakage**: many legitimate endpoints
  `include: { user: true }` (or similar) to surface a name/phone/rating,
  which returns every scalar column including these. Added a global
  response-sanitizing middleware (`sanitizeResponse.ts`) that strips both
  field names from every JSON response body, however deeply nested,
  rather than relying on every current and future call site to remember a
  `select`.
- **Admin RBAC gap**: every admin sub-role (`support_agent`,
  `read_only`, `finance`, `safety_officer`) could previously call *any*
  mutating admin endpoint — platform settings, fare rules, dispute
  refunds/payout adjustments, user suspension, business accounts — since
  only `adminRouter.use(requireRole("admin"))` was enforced, with
  sub-role checks only ever added to the admin-user-management endpoints.
  Added `requireAdminRole(...)` to every mutating endpoint across
  `admin/{config,trust,risk,verification,business}.ts`, scoped
  appropriately (e.g. platform settings → `super_admin` only; dispute
  money actions → `super_admin`/`ops_manager`/`finance`; safety-event
  resolution → `super_admin`/`ops_manager`/`safety_officer`).
  `super_admin` still bypasses all scope checks. Read-only GET endpoints
  remain open to every admin sub-role.
- Reviewed and confirmed already-correct: rate limiting (auth endpoints),
  bcrypt password hashing, hashed+rotating refresh tokens, no raw SQL
  (`$queryRaw`) anywhere, zod schemas strip unknown keys by default (no
  mass-assignment path found), and IDOR scoping on every new
  notifications/support/business/safety/wallet endpoint (all correctly
  scoped to `req.auth.userId`).

---

## 8. Mock integrations

Unchanged from Phase 2 — every mock is a real code path behind the same
interface a production adapter would implement:

- OTP delivery (console-logged/echoed code, not a real SMS gateway).
- Card/wallet/local-provider payments (`MockCardProvider` — used by the
  new wallet top-up and dispute-refund flows too).
- SMS/push/email (`ConsoleProviders`).
- Maps/routing (`HaversineMapProvider` — used by the new scheduled-ride
  fare check).
- Driver location (real when granted, fixed demo point otherwise).

## 9. Real integrations

Everything added this phase runs against the real Prisma/SQLite database
with no new external dependency: wallet ledger, promo/referral/incentive
logic, risk scoring, document-expiry sweeps, dispute resolution and its
wallet transactions, scheduled-ride dispatch — all real reads/writes, none
simulated at request time.

---

## 10. Known limitations

- **No file upload endpoint** (unchanged from Phase 2): driver documents
  remain URL strings; the new document-submission endpoint accepts a
  `fileUrl` rather than handling an upload itself.
- **`repeated_signup` risk signal defined but never triggered**: no
  device-fingerprint or IP collection exists in this stack, so that
  specific fraud signal from the spec has no data source yet; the other
  six signal types are wired.
- **Commission engine has no business-account dimension**: `FareRule`
  commission is per city+vehicle-type (+ optional zone), matching Phase
  2's model; a business account can't yet override its own commission
  rate. Architecture-only was the explicit brief for business accounts, so
  this is intentional, not an oversight.
- **No standalone Financial Ledger table**: the existing `Transaction`
  model (wallet-scoped, typed, immutable-in-practice since nothing updates
  a transaction row after creation) serves this purpose but isn't a
  dedicated ride-agnostic ledger with its own reference/audit surface as
  described in the original spec's §27 — a real gap if a future phase
  needs ledger reconciliation independent of wallets.
- **Admin frontend coverage**: the new backend surfaces (analytics,
  cohorts, live-ops summary, risk queue, promotions/incentive-campaign
  CRUD, business accounts) have working, tested APIs but only the live-ops
  badge row got a frontend widget this phase — the rest show the same
  honest "scoped for a later phase" placeholder the admin nav has used
  since Phase 1.
- **No "Simulate Driver" dev utility** — explicitly optional in the brief
  and explicitly told not to ship into production; skipped rather than
  built-and-hidden, given the time budget.
- **In-process sweep intervals**: two more `setInterval` sweeps
  (scheduled-ride dispatch, document-expiry) joined Phase 2's negotiation
  sweep — same single-instance caveat noted in Phase 2's report §13,
  same fix (durable scheduler) recommended below.

## 11. Performance considerations

- Matching/demand-map queries are bounded (radius-limited driver lookups,
  a capped grid size on the heat-map, `take`/pagination on every new list
  endpoint) — nothing added this phase does an unbounded table scan.
- Cohort-retention analytics currently aggregates in application code
  after a bounded (`weeks`-limited) query rather than a SQL `GROUP BY`,
  since Prisma's SQLite connector doesn't make date-truncation grouping
  convenient; fine at seed/demo scale (tested against 110 historical
  rides + 50 passengers), but should move to a raw aggregation query
  before real production volume.
- The document-expiry and scheduled-ride sweeps run on wide intervals (1
  hour, 1 minute respectively) chosen to match how fast those states
  actually change, not tightened unnecessarily.
- No new indexes were added; existing `@@index` coverage on
  `RiskEvent`/`Dispute`/`SafetyEvent` etc. (already present in the Phase
  2/3 schema) covers the new admin queue queries' filter columns.

## 12. Recommended Phase 4

In priority order:

1. **Finish the admin frontend** for the Phase 3 backend surfaces that
   don't have a screen yet (analytics, cohorts, risk queue, promotions/
   incentive-campaign management, business accounts) — same highest-
   leverage argument as Phase 2's report made for its own gap.
2. **Real external integrations** (SMS/payments/maps/push) — still
   entirely mocked; pick one as a template, per Phase 2's recommendation
   (still not done).
3. **File uploads** for driver/vehicle documents — still URL-only.
4. **A dedicated Financial Ledger** if reconciliation independent of
   per-user wallets becomes a real requirement (§10).
5. **Business-account billing** (invoicing, net-terms, spend-limit
   enforcement) — deliberately deferred twice now (Phase 2 brief and this
   phase's brief both said architecture-only).
6. **Durable job scheduler** for all three in-process sweeps (negotiation,
   scheduled-ride dispatch, document-expiry) ahead of horizontal scaling.
7. **Postgres migration** — same mechanical path documented in Phase 2's
   report §3, still outstanding.
8. **Harden auth token storage** (httpOnly refresh-token cookie) — still
   outstanding from Phase 2.
9. **Wallet withdrawals** — earnings/promo/referral/incentive credits all
   accrue in-wallet with no payout-initiation flow yet.

---

**Stopping here per instructions — not proceeding to Phase 4.**
