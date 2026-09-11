# 21 — Phase 5 Completion Report

Phase 5 objective: take RIVO from a pilot-ready single-city platform
(Phase 4) toward **growth, scale, and production readiness** —
deepening the matching/pricing/growth engines the pilot will actually
run on, then building the operational surface (dispatch/cancellation
analytics, lost & found, expanded corporate accounts, marketing,
partnerships, feature flags, experimentation, a public status page, and
an executive dashboard) a real operator needs, and closing the loop with
a security pass, a load-testing foundation, backup/recovery
verification, and an expanded automated test suite. Twenty-five commits,
in order, on `claude/rivo-marketplace-phase-1-v7504v`. Nothing from
Phase 1-4 was redesigned; every item below is additive, or — where noted
explicitly in §5 and §8 — a targeted fix to a real bug found along the
way, documented honestly rather than glossed over.

---

## 1. Scope and structure

Phase 5 falls into two halves, both covered here:

- **§1-10 (growth & matching depth)**: multi-city platform upgrades,
  a multi-currency decimal-safety pass, i18n-aware money/date
  formatting, driver acquisition campaigns, guided driver onboarding,
  driver referral qualification, a customer retention engine, promotion
  engine 2.0, configurable supply/demand thresholds, and a driver-facing
  demand heat map.
- **§11-27 (operations & production readiness)**: advanced dispatch
  stage tracking, smart cancellation management, a lost & found
  workflow, expanded business/fleet accounts, analytics UI polish, a
  marketing campaign system, a partner referral program, a scoped
  partner API platform, feature flags, A/B testing, Launch Mode UI +a
  public status page, an executive command-center dashboard, a
  security/privacy/performance verification pass, a load-testing
  foundation with backup/recovery verification, and an expanded
  automated test suite.

## 2. Growth & matching depth (§1-10)

- **Multi-city platform upgrades**: `City` gained
  `customerRequirements` (jurisdiction-specific passenger requirements,
  JSON, admin-configurable — mirrors the existing `driverRequirements`
  pattern) and `searchRadiusKm` (a per-city override of the
  platform-wide `matching.initialRadiusKm`, clamped to the platform
  default rather than allowed to silently disable radius limits).
- **Multi-currency decimal-safety pass**: replaced unsafe
  floating-point money math with currency-aware rounding helpers across
  every financial write path — ride completion, disputes, referral
  rewards, driver incentives, fare estimation, promo discounts, wallet
  top-ups, payouts. The old `round2()` helper hard-coded 2 decimal
  places regardless of currency, which is wrong for a currency with a
  different number of minor units.
- **i18n-aware formatting**: every hard-coded `"Rs {amount}"` across
  passenger/driver/admin UIs (which assumed PKR regardless of the
  ride's actual currency — a real bug once cities carry their own
  `currencyCode`) now routes through the existing `formatMoney` helper,
  now locale-aware; RTL icon-mirroring fixes for ar/ur/fa layouts.
- **Driver acquisition campaigns**: a new `DriverAcquisitionCampaign`
  model, distinct from the existing `IncentiveCampaign` (which rewards
  already-active drivers for ride volume) — this targets the top of the
  funnel, with a funnel dashboard (applied → documents submitted →
  approved → first ride) per campaign and city-wide.
- **Guided driver onboarding**: replaced a dead-end "verification
  pending" message with a real 9-step guided flow (account, vehicle,
  six required documents, admin approval) and a live progress
  percentage; each document shows its own real status, including a
  specific rejection reason per document rather than one generic
  "rejected" state for the whole application.
- **Driver referral qualification**: `qualifyReferralOnFirstRide()` had
  a hard dependency on `passengerProfile` despite `applyReferralCode`
  already being role-agnostic — a driver referring another driver could
  get a `Referral` row created that then never qualified. Fixed, with a
  referral UI shipped for both roles.
- **Customer retention engine**: automated lifecycle nudges — a welcome
  message the moment OTP verification completes, a second-ride nudge if
  a passenger's first ride goes unfollowed for a few days, and 7-day/
  30-day inactivity re-engagement (the 30-day nudge generates a real
  single-use promo code, not just a message).
- **Promotion engine 2.0**: extended `Promotion` with `existingUsersOnly`
  (the inverse of `newUsersOnly`, for win-back codes), min/max completed
  rides (loyalty-tier segmentation), day-of-week/time-of-day windows,
  and per-promotion campaign analytics (redemption rate, revenue impact,
  segment breakdown).
- **Supply/demand thresholds + heat maps**: the demand-map and
  supply-dashboard endpoints hard-coded `1.5` as the "high demand" ratio
  threshold in two separate places with no tiering — replaced with
  admin-configurable `supplyDemand.greenMaxRatio`/`yellowMaxRatio` and a
  real green/yellow/red admin heat map. The demand-grid computation was
  extracted into `services/demandMapService.ts` (one implementation, not
  two) and reused for a new driver-facing `GET /driver/me/demand-map`,
  scoped to the driver's own city.

## 3. Advanced dispatch, cancellation, and lost & found (§11-15)

- **Dispatch stage tracking**: `findEligibleDrivers()` now returns and
  persists a `dispatchStage` (`closest_eligible` → `expand_radius` →
  `expand_pool` → `none_available`) and, on failure, a machine-readable
  `noMatchReason` — replacing a bare boolean "matched or not" with a
  real explanation of *why* dispatch behaved the way it did. A genuine
  new "expand pool" tier retries at max radius with a wider staleness
  cutoff before giving up. `GET /admin/dispatch/analytics` surfaces
  stage/no-match-reason breakdowns, avg time-to-match, and avg
  drivers-contacted, all live-queried — not estimated.
- **Smart cancellation management**: a full policy engine
  (`cancellationService.ts`) gated on four checks, in order —
  `cancellation.penaltyEnabled` (default **off** platform-wide),
  a configurable free window since booking, the stated reason never
  being attributable to the *other* party (a passenger citing "driver
  too far" is never charged, policy or not), and — for the passenger
  side — an atomic wallet-balance check that never creates a negative
  balance or an IOU. A qualifying fee is paid into the driver's wallet
  as real compensation, not just withheld. Driver-side lateness has no
  monetary mechanism (drivers aren't pre-funded) — it's recorded as an
  elevated-severity risk event instead of silently doing nothing.
- **Lost & found**: built on the existing `SupportTicket`/
  `SupportMessage` infrastructure rather than a parallel chat system —
  every report gets its own ticket (category `lost_item`) so the
  passenger↔driver back-and-forth reuses endpoints admin already
  monitors, while `LostItemReport` carries the structured item/status
  fields a generic ticket can't. Full flow: passenger reports (only
  after `ride_completed`) → driver confirms found/not found → either
  party resolves (`returned`/`closed`).

## 4. Business, fleet, and analytics (§16-17)

- **Business accounts expansion**: `BusinessDepartment` (per-department
  monthly spend caps, enforced at ride-request time, not just stored)
  and `BusinessInvoice` (an admin-generated, admin-attested "mark paid"
  snapshot record — no payment-gateway auto-charge for corporate
  net-terms exists, consistent with how driver payouts work).
  `FleetAccount` lets a company own multiple `DriverProfile` rows under
  one commission-share arrangement, with an admin dashboard covering the
  fleet's aggregate earnings and per-driver breakdown.
- **Driver + customer analytics dashboard polish**: a shared
  `RideHistoryPanel` wired into both `CustomerHome` and `DriverHome`
  (ride-history endpoints existed with zero frontend surface before
  this), plus a `PlatformAnalyticsPanel` wiring the pre-existing
  passenger/driver/marketplace analytics endpoints into a real admin
  screen for the first time.

## 5. Marketing, partners, and the partner API (§18-20)

- **Marketing campaign system**: `MarketingCampaign` model with strict
  `marketingOptIn: true` audience enforcement (never sends to a user who
  hasn't consented), a background job (`marketing_campaign_dispatch`,
  60s interval) that sends due campaigns through the existing
  `NotificationService.notify()` — no parallel send pipeline — and an
  admin CMS with audience preview before sending.
- **Partner program**: `Partner`/`PartnerReferral`/`PartnerPayout`
  models. `applyPartnerCode()` runs as a fallback inside registration's
  existing referral-code path when a code doesn't match a personal
  `ReferralCode` — one shared registration flow handles both partner and
  personal referrals rather than a second parallel code system.
  Referral qualification hooks into the same post-ride-completion path
  used for personal referrals. Payout recording has an owed-amount guard
  (`PAYOUT_EXCEEDS_OWED`) — an admin can't record a payout larger than
  what's actually owed.
- **Partner API platform (scoped)**: `POST /v1/partner-api/{fare-estimate,
  rides}` and `GET /v1/partner-api/rides/:id`, authenticated by a
  sha256-hashed API key (`rivo_partner_<64-hex>`, shown once at
  generation — the same pattern as `RefreshToken.tokenHash`). Explicitly
  narrow by design: books only for an *existing* RIVO passenger found by
  phone (404s otherwise — a partner can never create an account through
  this API), and has no cancellation, negotiation, or account-management
  endpoints. Rate-limited independently of the general API limiter,
  keyed on the `Authorization` header rather than IP.

  **A real bug was found and fixed here, not glossed over**: the auth
  middleware (`requirePartnerApiKey`) was initially a plain async
  function that threw directly on an invalid key. Express does not await
  async middleware, so the rejected promise became an **unhandled
  rejection that crashed the entire process** — discovered live when an
  invalid-key test killed the dev server and every subsequent request,
  including an unrelated admin call, failed with a connection refusal.
  Fixed by wrapping the middleware in the project's existing
  `asyncHandler` utility (the same one every route handler already
  uses). `tests/phase5.test.ts` now carries a direct regression test:
  an invalid key must return 401, and the app must answer a normal
  request immediately afterward, proving it never went down.

## 6. Feature flags, A/B testing, Launch Mode, and the command center (§21-24)

- **Feature flags**: deterministic percentage rollout via
  `sha256(key:userId) % 100` — never `Math.random()`, so a given user's
  in/out result is stable across calls and restarts — plus role and
  city targeting. `GET /account/feature-flags` evaluates every flag for
  the signed-in user in one call; a `FeatureFlagsProvider` fetches it
  once per session and exposes `useFeatureFlag(key)`, which never throws
  (a missing or unloaded flag reads as `false`).
- **A/B testing**: deliberately distinct from feature flags — experiments
  carry named, weighted variants (not just on/off), and assignment is
  **sticky**: once a user is bucketed on first evaluation, that choice
  is persisted in `ExperimentAssignment` (unique on
  `(experimentId, userId)`) and reused forever, even if an admin later
  changes the variant weights or the user becomes ineligible. Verified
  live and in an automated test: skewing weights 99/1 after a user is
  already assigned does not re-roll them.
- **Launch Mode + public status page**: Pilot Mode (Phase 4) and the
  pre-launch waitlist (Phase 4) had complete, tested backends but **zero
  frontend surface** — an admin could not actually turn pilot mode on,
  mint an invitation code, or see who signed up without hitting the API
  directly. A consolidated "Launch Mode" admin panel closes that gap.
  New this phase: `SystemIncident`/`SystemIncidentUpdate` models (an
  incident is a title/severity plus a timeline of updates —
  investigating → identified → monitoring → resolved), an admin panel to
  post/update/delete incidents, and a public, unauthenticated `/status`
  page (polling every 30s) whose overall status is the worst open
  incident's severity, forced to `major_outage` if the database itself
  is unreachable regardless of what any incident says.
- **Command center**: four analytics endpoints (executive summary, unit
  economics, acquisition, weekly retention cohorts — three from Phase 3/4)
  had complete backends and **zero frontend surface**. A single
  "Command Center" admin page now covers GBV/revenue/completion rate/
  repeat rate/driver retention/supply-demand ratio, a per-ride unit-
  economics breakdown down to contribution margin (each figure labeled
  `"actual"` or `"estimate"` — an estimate badge with an explanatory
  tooltip, never presented as measured), acquisition-source ROI, and
  retention cohorts — filterable by city and date range.

## 7. Database migrations

Fourteen Phase 5 migrations, in order, all generated with
`prisma migrate dev` against the real schema (never hand-written SQL):

1. `phase5_city_config_expansion` — `City.customerRequirements`/`searchRadiusKm`
2. `phase5_financial_record_currency` — decimal-safety-pass support fields
3. `phase5_driver_acquisition_campaigns` — `DriverAcquisitionCampaign`
4. `phase5_retention_notification_log` — `RetentionNotificationLog`
5. `phase5_promotion_engine_v2` — `Promotion` rule-dimension fields
6. `phase5_dispatch_stage_tracking` — `RideRequest.dispatchStage`/`noMatchReasonCode`
7. `phase5_smart_cancellation_reasons` — `Ride`/`RideRequest.cancellationReasonCode`
8. `phase5_lost_and_found` — `LostItemReport`
9. `phase5_business_expansion_and_fleet` — `BusinessDepartment`, `BusinessInvoice`, `FleetAccount`
10. `phase5_marketing_campaigns` — `MarketingCampaign`
11. `phase5_partner_program` — `Partner`, `PartnerReferral`, `PartnerPayout`
12. `phase5_partner_api_platform` — `Partner` API-key fields, `RideRequest.partnerId`
13. `phase5_feature_flags` — `FeatureFlag`
14. `phase5_ab_testing` — `Experiment`, `ExperimentAssignment`
15. `phase5_system_status_page` — `SystemIncident`, `SystemIncidentUpdate`

CI's `prisma migrate diff --exit-code` drift check (Phase 4 §16) covered
every one of these on push.

## 8. Security, privacy, observability, and performance pass (§25)

A dedicated audit of every mutating Phase 5 admin endpoint (dispatch,
cancellations, trust, business, marketing, partners, feature flags,
experiments, system status, pilot mode) confirmed all are correctly
role-gated and audit-logged, with one real pre-existing gap found and
fixed (`DELETE /admin/waitlist/:id` was missing its audit log entry).
Beyond that, three real issues were found and fixed, not just reviewed:

- **Privacy leak**: `GET /public/system-status` used Prisma's
  `include` on incident/update relations, which put admin user ids
  (`createdById`/`postedById`) into an **unauthenticated** response.
  Changed to an explicit `select` that only returns public-safe fields,
  with a matching lean `PublicSystemIncident` frontend type instead of
  reusing the full admin type.
- **CSV/formula injection**: waitlist `fullName`/`contact`/`cityName`
  are attacker-controlled (submitted via the public `/public/waitlist`
  form with no character restriction) and were only quote-escaped
  before being written into a CSV an admin later opens — a value
  starting with `=`/`+`/`-`/`@` is interpreted as a formula by some
  spreadsheet apps. Fixed in both the backend export endpoint and the
  new frontend CSV builder by prefixing such values with a tab before
  quoting.
- **Unbounded query**: `GET /admin/waitlist` had no `take` limit and
  returned `entries.length` as `"total"` instead of a real count —
  newly reachable at real page-load scale once the Launch Mode UI wired
  it up this phase. Capped at 1000 with a separate accurate count query.

## 9. Load testing foundation + backup/recovery verification (§26)

`backend/scripts/load-test.mjs` (`npm run load-test`) is a
dependency-free Node script — the tool
[19 — Performance Targets](./19-performance-targets.md) §6 had
explicitly deferred as "not done here... Phase 5 scope." It drives
paced, weighted traffic across three state-safe scenarios (an
unauthenticated read, a passenger fare estimate — pure computation, no
DB row created — and an admin dashboard read) and cross-checks its own
client-observed latency against the server's real
`GET /admin/observability` snapshot.

Building it surfaced a genuine gotcha: an *unpaced* run (concurrent
workers firing as fast as a local round-trip allows) exhausts the
general API limiter (300 req/min/IP) in well under a second — tens of
thousands of 429s that looked like a 99.6% error rate on the first run,
but were the rate limiter correctly doing its job, not a server failure.
The script now buckets 429s separately from real errors and paces the
total request rate via `--rps` (default 4/s). One real, labeled run
(SQLite, single dev container, 5 workers @ 4 req/s for 20s, zero errors,
zero rate-limit rejections) is on record in
[19 — Performance Targets](./19-performance-targets.md) §6: every
endpoint class came back comfortably under its documented p95 target
(fare-estimate 11ms vs. an 800ms target), cross-checked against the
server's own zero-failure observability snapshot — explicitly labeled a
dev-sandbox sanity check, never a production capacity claim.

Backup/recovery was re-verified against the current (Phase 5) schema:
ran `npm run backup`, pointed a separate Prisma Client at the resulting
file, confirmed `Experiment`/`SystemIncident`/`Partner` row counts all
read back correctly, and confirmed `npx prisma migrate status` reports
the restored file fully up to date across all 25 migrations. Documented
in [17 — Backup & Recovery](./17-backup-recovery.md) §1.

## 10. Testing results

**Backend**: 58 tests across 4 files, all passing — `tests/rideFlow.test.ts`
(12, pre-Phase-5), `tests/phase3.test.ts` (12, pre-Phase-5),
`tests/phase4.test.ts` (20, pre-Phase-5), `tests/phase5.test.ts` (14,
new this phase — feature-flag role targeting, sticky A/B assignment
surviving a weight change, the full partner API flow including a direct
regression test for the process-crash bug in §5, the lost & found flow,
and smart-cancellation fee/exemption/policy-off behavior).

A real test-infrastructure bug was found and fixed while writing these:
`tests/fixtures.ts`'s `resetDb()` deletes `platformSetting` rows
directly via Prisma, bypassing `config/settings.ts`'s `setSetting()` —
the only path that invalidates its ~5-second in-process settings cache.
A setting one test changed (e.g. enabling the cancellation policy) could
leak into the very next test within that cache window even after a full
DB wipe, which is exactly what broke the "policy disabled by default"
test until `resetDb()` was updated to also call the existing
`invalidateSettingsCache()` export.

`tsc --noEmit` clean on both backend and frontend throughout every task
this phase. Frontend production build (`vite build`) succeeds clean.
Every new backend endpoint was also verified live via curl against a
running dev server during its own task — not just unit-tested — with
findings (like the partner-API crash) called out honestly in the commit
that fixed them rather than discovered and then hidden.

**Not done**: no real k6/Artillery capacity test against a staging
Postgres environment — see §9 and
[19 — Performance Targets](./19-performance-targets.md) §6 for exactly
what that would still take.

## 11. Known limitations

- Everything in Phase 4's own known-limitations list still applies
  unless specifically addressed above: payments/maps/SMS/push remain
  architecturally complete but not connected to a real provider; SQLite
  is fine for pilot scale but not multi-instance deployment;
  `AdminUser.cityScope` is still not enforced as a query filter on any
  admin list endpoint; no mobile app store presence.
- No real capacity/load test exists — only the dev-sandbox sanity run
  described in §9, explicitly not a substitute for one.
- Feature flags and experiments have no cleanup/archival policy — an
  admin who forgets to delete a stale flag leaves it evaluating forever
  (cheap to check, but no automated staleness warning exists).
- The partner API platform has no per-partner request-volume dashboard
  beyond the rate limiter itself — an admin can see a partner's ride
  history but not a live "requests this hour" view.
- A/B testing has no built-in statistical-significance calculation —
  assignment counts are shown, but comparing conversion rates between
  variants for significance is a manual admin exercise, not computed by
  the platform.

## 12. Recommended next steps

Listed for whoever picks this up next — **not started here**, per this
phase's explicit instruction to stop after Phase 5:

1. A real k6/Artillery capacity test against a staging Postgres
   environment, using `backend/scripts/load-test.mjs`'s scenario design
   as a starting point but at real production-shaped concurrency.
2. Everything still open from Phase 4's own recommended-next-steps list
   (§15 of [20 — Phase 4 Completion Report](./20-phase-4-completion-report.md)):
   real payment/map/SMS/push provider integration, legal review of a
   privacy policy/terms of service, app store submission assets, the
   SQLite→Postgres decision, and enforcing `AdminRole.cityScope`.
3. A statistical-significance helper for the A/B testing results view,
   once real experiments have run long enough to need one.
4. A per-partner live request-volume view in the Partners admin panel.

---

**Stopping here per instructions.** Phase 5 is finished — growth engine
depth (acquisition, onboarding, referrals, retention, promotions 2.0,
supply/demand tuning), full dispatch/cancellation observability, lost &
found, expanded corporate/fleet accounts, marketing campaigns, a partner
program with a scoped external API, feature flags, sticky-assignment A/B
testing, a Launch Mode admin surface, a public status page, an executive
command-center dashboard, a security pass with three real fixes applied,
a load-testing foundation with one real labeled run on record,
re-verified backup/recovery, and an expanded automated test suite with
one real test-infrastructure bug fixed along the way. Not proceeding to
Phase 6.
