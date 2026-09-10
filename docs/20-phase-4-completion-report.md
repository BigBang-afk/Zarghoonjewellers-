# 20 — Phase 4 Completion Report

Phase 4 objective: take RIVO from a feature-rich single-city MVP (Phase 3)
to a platform architected for a **controlled real-world pilot launch** —
multi-city-capable, production-ready, localized, operationally manageable,
monetizable, scalable, measurable, and architecturally ready for real
payment/map/notification integrations, while the actual initial launch
stays scoped to one pilot city. Eighteen commits, in order, on
`claude/rivo-marketplace-phase-1-v7504v`. Nothing from Phase 1-3 was
redesigned; everything below is additive or a targeted fix to something
Phase 4's own work got wrong along the way (documented honestly in §5 and
§12, not glossed over).

---

## 1. Architecture changes

- **Multi-city + currency abstraction**: `City.paymentMethods` /
  `driverRequirements` became real admin-configurable JSON fields (not
  hard-coded per city). A `CurrencyMeta` registry (`utils/money.ts`
  backend, `shared/money.ts` frontend) maps currency code → symbol/decimal
  precision; `resolveUserCurrency()`/`resolvePlatformDefaultCurrency()`
  (`shared/currency.ts`) derive currency from a user's city rather than
  assuming PKR anywhere. A second real city (Dubai/AED) was seeded with an
  entirely different vehicle mix, fare scale, commission rate, and driver
  requirements, and status `"planned"` (not `"live"`) — proving the
  multi-city data model works end-to-end while the public-facing city list
  still surfaces only the one live pilot city (Islamabad).
- **Payment provider architecture**: `PaymentProvider` interface extended
  with `checkStatus`/`transactionLookup`/optional
  `verifyWebhookSignature`. New idempotent webhook endpoint
  (`api/public/webhooks.ts`) backed by a `WebhookEvent` table with a
  `@@unique([provider, eventId])` constraint — a provider's redelivery is
  a genuine no-op, not just an ignored duplicate.
- **Driver payout architecture**: `Wallet` gained `pendingBalance`/
  `paidBalance` alongside the existing `balance`; a single
  `payoutService.ts` is the only place any of the three numbers move,
  shared by both the webhook-driven and admin-driven completion paths.
- **Map provider architecture**: `MapProvider` interface gained
  `geocode`/`reverseGeocode`; the dev `HaversineMapProvider` implements
  both honestly against real `Location` rows (never fabricates a place
  name) and degrades to a labeled approximate-coordinate string when
  nothing matches.
- **Dispatch engine hardening**: a configurable hop-cap
  (`matching.maxDispatchHops`) stops Quick Match from silently escalating
  through every eligible driver in a sparse area.
- **Observability**: a structured JSON logger with automatic secret
  redaction, per-request correlation ids, and an in-process
  failure-counter/latency-percentile service
  (`GET /admin/observability`) — see §9/§11.
- **Background jobs formalized**: every recurring job (negotiation sweep,
  scheduled-ride dispatch, document-expiry reminders, plus two new ones —
  payment reconciliation and a cleanup sweep) now runs through one
  registry (`jobs/registry.ts`) with an overlap guard and structured
  logging, instead of five raw `setInterval` calls scattered in
  `server.ts`.

## 2. New features

- **Localization (i18n)**: en/ur ship with real translations today;
  architecture is language-agnostic (any BCP-47-ish code works, RTL
  detection via a `RTL_LOCALES` set) — see §6.
- **Corporate accounts v1**: OWNER/ADMIN/MEMBER roles, an admin- and
  self-service-settable `RidePolicy` (max ride amount, allowed vehicle
  types/zones) plus a monthly spend limit, both enforced at ride-request
  time — not just stored and ignored.
- **Growth engine**: acquisition attribution captured at registration
  (`acquisitionSource`/`acquisitionCampaign`), a promotions `campaignType`
  taxonomy, an admin-managed marketing CMS (`ContentItem` — homepage
  banners, FAQ, announcements, city-launch campaigns), a public waitlist
  form with CSV export.
- **Support v2**: a real `SupportMessage` reply thread (both the ticket
  author and admin can post into it) separate from an admin-only
  `internalNotes` field the author never sees; ticket creation accepts
  evidence attachments.
- **Safety operations center**: investigator assignment + notes on a
  `SafetyEvent`, separate from resolution — assignment/investigation never
  auto-enforces anything; only a human resolves.
- **Data privacy**: self-service account view/export/marketing-consent
  toggle/deletion request; admin review queue that anonymizes a User row's
  PII on completion while financial/ride records are never touched.
- **Pilot Mode**: an admin on/off switch scoped to one city, with
  driver/passenger supply caps and optional invitation-only sign-up (a
  "beta user list" is single-use invitation codes, one per approved
  person).
- **Analytics v2**: an executive dashboard (GBV, revenue, completion/
  cancellation rate, avg fare, avg driver ETA, active passengers/drivers,
  repeat rate, driver retention, a supply/demand indicator, support
  tickets, refunds) and a unit-economics dashboard (revenue/driver-payout/
  promotion-cost/refunds per ride, contribution margin), both filterable
  by date/city/vehicle/payment method and both labeling every figure
  `"actual"` or `"estimate"` — never presenting a guess as measured.
- **Rate limiting extension**: admin-configurable limiters (readable/
  writable live via `PlatformSetting`, no redeploy) added for offer/
  counter-offer actions, ride and support chat, referral application,
  promo-code validation, and payment endpoints.

## 3. Database migrations

Four Phase 4 migrations, in order:

1. `20260910062520_phase4_multicity_payouts_growth_cms` — the large one:
   `City.paymentMethods`/`driverRequirements`, `User` acquisition/consent/
   deletion fields, `Wallet.pendingBalance`/`paidBalance`,
   `PayoutRequest`, `WebhookEvent`, `ContentItem`, `NotificationTemplate`,
   `WaitlistEntry`, `InvitationCode`, `Promotion.campaignType`,
   `SupportTicket` internalNotes/attachments/dueAt, `SafetyEvent`
   assignedAdmin/notes.
2. `20260910064235_driver_location_accuracy` — `DriverProfile.
   lastLocationAccuracyM`.
3. `20260910070041_phase4_support_messages` — the `SupportMessage` model
   + its relation to `SupportTicket`/`User`.
4. `20260910125127_phase4_db_performance_indexes` — composite indexes
   matching the negotiation sweep's and webhook listing's actual filter
   shapes (`RideRequest`/`RideOffer`/`CounterOffer` on `(status,
   expiresAt)`, `WebhookEvent` on `(status, createdAt)`, `User` on
   `deletionRequestedAt`).

Every migration was generated with `prisma migrate dev` against the real
schema (never hand-written SQL), and CI now runs a
`prisma migrate diff --exit-code` drift check on every push — see
[16 — CI/CD](./16-cicd.md).

## 4. API changes

The full endpoint-by-endpoint reference — every route, auth requirement,
validation, response shape, and error — lives at
[14 — API Reference](./14-api-reference.md), generated by reading the
actual router source rather than restating the design doc. Highlights:
`/v1/public/webhooks/:provider`, `/v1/driver/me/payouts*`,
`/v1/business/accounts/:id/{policy,employees}`, `/v1/account/{export,
deletion-request,marketing-consent}`, `/v1/admin/{pilot-mode,
invitation-codes,observability,privacy/*,analytics/{executive,unit-
economics,acquisition}}`, `/v1/support/tickets/:id/messages`. All
endpoints remain under the existing `/v1` prefix — no version bump, no
breaking change to an existing client.

## 5. Security improvements

A dedicated review pass (full findings in the commit `9ad46ba`) audited
every Phase 4 addition and fixed four real issues before this report was
written, not after:
- **Critical**: the payment-webhook HMAC secret had no production
  startup guard (unlike the JWT secrets) — fixed to refuse to start in
  production on the default value.
- **High**: a real double-spend race in driver payout requests (two
  concurrent requests could both withdraw against the same stale balance
  read) — fixed with an atomic conditional update; the same pattern
  applied to payout completion/failure for the analogous lower-
  probability race.
- **Medium**: driver payout requests had no rate limiter; five admin
  finance GET endpoints (payments, commissions, payouts, webhooks,
  provider-status) had no role gate at all, letting any admin sub-role
  read financial data meant for `finance`/`super_admin`. Both fixed.
- Also caught and fixed during the documentation pass (not the security
  review itself): `POST /admin/admin-users`'s role validator had drifted
  out of sync with the shared `AdminRole` type and silently rejected
  `city_admin`/`marketing` — now validates against the enum directly so
  it can't drift again.

Two regression tests lock in the payout race fix and the finance
role-gate fix (`tests/phase4.test.ts`).

## 6. Localization status

**Real today**: en/ur, selectable per-user (persisted on `User.locale`),
with actual translated notification templates
(`services/notifications/templates.ts`) for every major ride-status
event, a frontend `LocaleProvider`/`useT()` context, and RTL document-
direction switching. **Architecture-ready, not yet translated**: ar/ps/fa
— adding either is a dictionary file + `NotificationTemplate` rows, no
backend code change (the `RTL_LOCALES` set already includes all three).

## 7. Payment integration status

**Architecturally real, financially still mock**: the `PaymentProvider`
interface (authorize/capture/refund/status/webhook/transaction-lookup) is
fully implemented against a `CashProvider` and `MockCardProvider`, both
backed by an in-memory ledger — no real money moves. The webhook path
(signature verification, idempotency, reconciliation job) is built and
tested against the mock's HMAC scheme, which is the exact shape a real
provider adapter (Stripe, a local Pakistani gateway, etc.) would plug
into by implementing the same interface — swapping the provider is an
adapter-class change, not an architecture change. **Not done**: no real
provider account exists or has been integrated; see §14.

## 8. Map integration status

**Architecturally real, geospatially honest, not a real map**: geocoding/
reverse-geocoding/route-estimation are implemented against real
`Location` rows in the database (never fabricated place names), with
honest degradation ("approximate — no known address nearby") when
nothing matches. **Not done**: no real map provider (Google Maps, Mapbox)
is integrated — `MAPS_PROVIDER_API_KEY` is a documented, unused env var
placeholder (`.env.example`) for exactly this swap-in.

## 9. Notification integration status

**Architecturally real, delivery still console-mock**: `notify()`/
`notifyFromTemplate()` write a real `Notification` row and push over the
real Socket.IO gateway on every call — that part is fully functional, not
mocked. External SMS/push fan-out goes through `ConsoleProviders.ts`
(logs to console, matching `MOCK_NOTIFICATIONS=true`). **Not done**: no
real SMS (Twilio-class) or push (FCM-class) provider is integrated —
`SMS_PROVIDER_*`/`PUSH_PROVIDER_SERVER_KEY` are documented, unused env
var placeholders for exactly this swap-in.

## 10. Production configuration

Full detail in [15 — Production Configuration](./15-production-configuration.md).
Summary: dev/staging/prod distinguished purely by env vars (no
environment-specific code branches); the JWT and webhook secrets now both
refuse to start in production on their dev defaults; SQLite today,
schema already written Postgres-portable for when real production scale
requires it; `.env.example` complete and gitignored alongside the real
`.env` in both `backend/` and `frontend/`.

## 11. Testing results

**Backend**: 44 tests across 3 files, all passing —
`tests/rideFlow.test.ts` (12, pre-Phase-4), `tests/phase3.test.ts` (12,
pre-Phase-4), `tests/phase4.test.ts` (20, new this phase — multi-city
currency, corporate ride-policy enforcement, driver payout lifecycle
including the concurrency regression test, webhook idempotency and
signature verification, data-privacy deletion flow, Pilot Mode capacity/
invitation-code ordering, support-ticket reply threads and internalNotes
privacy, localized notifications, observability counters, admin-role
integrity, the finance role-gate regression test, and one full
passenger→driver→payment→analytics end-to-end scenario). `tsc --noEmit`
clean on both backend and frontend. Frontend production build (`vite
build`) succeeds clean; `oxlint` passes with warnings only, no errors.
Every new backend endpoint referenced in this report was also verified
live via curl or a real Playwright browser session against a running dev
server during its own task, not just unit-tested — see the individual
Phase 4 commit messages for what was checked in each case.

**Not done**: no load test has been run — see
[19 — Performance Targets](./19-performance-targets.md) for targets vs.
the real instrumentation now in place to check them once traffic exists.

## 12. Known limitations

- Payments, maps, SMS/push are architecturally complete but not
  connected to a real provider (§7-9) — this is the single largest gap
  between "pilot-ready architecture" and "pilot-ready to accept real
  payments."
- SQLite is fine for the pilot's scale and a single backend instance;
  not fine for multi-instance deployment or a dataset that outgrows one
  file (§10, §15 §2).
- `AdminUser.cityScope` is set on the JWT but not currently enforced as
  a query filter by any admin list endpoint (every admin list is
  platform-wide unless it accepts an explicit `cityId` query param) —
  flagged in [14 — API Reference](./14-api-reference.md), not fixed
  here since it's a scope-widening change to every admin list endpoint,
  not a contained fix.
- No mobile app store presence yet — the Capacitor Android project still
  has default placeholder icon/splash and no privacy policy/terms exist
  anywhere in the repo (honest checklist:
  [18 — App Store Checklist](./18-app-store-checklist.md)).
- No load test has been run (§11).
- The backend has no dedicated linter — `tsc --noEmit` stands in as its
  static-analysis gate in CI (documented gap, [16 — CI/CD](./16-cicd.md)).

## 13. Pilot launch checklist

Ready today:
- [x] One pilot city fully configured (Islamabad, `status: "live"`)
- [x] Multi-city architecture proven with a real second city, not just
      schema
- [x] Pilot Mode available to cap driver/passenger supply and gate
      sign-up by invitation
- [x] Health/readiness endpoints, structured logging, failure counters
- [x] Rate limiting on every abuse-prone endpoint, admin-adjustable live
- [x] Automated backups (`npm run backup`) + documented restore
      procedure
- [x] CI running typecheck/migration-drift-check/tests/lint/build on
      every push
- [x] Security review completed, findings fixed

Not ready — required before accepting real users/money:
- [ ] Real payment provider credentials + integration (§7, §14)
- [ ] Real map provider credentials + integration (§8, §14)
- [ ] Real SMS/push provider credentials + integration (§9, §14)
- [ ] Privacy policy + terms of service, reviewed by counsel (§12)
- [ ] Postgres migration if the pilot is expected to run multi-instance
      or at meaningful scale (§10)
- [ ] Load testing against the actual performance targets (§11,
      [19](./19-performance-targets.md))

## 14. Required external credentials

None of these are set or available in this environment — listed so
whoever launches the pilot knows exactly what to go get:

| Credential | Env var | Used for |
|---|---|---|
| Payment provider secret key | `PAYMENTS_PROVIDER_SECRET_KEY` | Real card/local-provider payment capture (§7) |
| Payment provider webhook secret | `PAYMENTS_PROVIDER_WEBHOOK_SECRET` | Verifying the provider's webhook signature — **must not** be left at the dev default in production (§5) |
| SMS provider (Twilio-class) | `SMS_PROVIDER_ACCOUNT_SID`, `SMS_PROVIDER_AUTH_TOKEN`, `SMS_PROVIDER_FROM_NUMBER` | Real OTP/notification SMS delivery (§9) |
| Push provider (FCM-class) | `PUSH_PROVIDER_SERVER_KEY` | Real push notification delivery (§9) |
| Maps provider (Google Maps/Mapbox-class) | `MAPS_PROVIDER_API_KEY` | Real geocoding/routing/ETA (§8) |
| Production JWT secrets | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Already enforced — the app refuses to start in production without real values |
| Postgres connection string | `DATABASE_URL` | Only once/if the datasource moves off SQLite (§10) |
| Apple Developer account + provisioning | — | Only if shipping an iOS app (§13/[18](./18-app-store-checklist.md)) |
| Android release keystore | — | Signing a real Play Store build ([18](./18-app-store-checklist.md)) |

## 15. Recommended Phase 5

In rough priority order for an actual pilot launch:
1. Integrate one real payment provider (whichever fits the pilot city's
   market) end-to-end against the existing `PaymentProvider` interface —
   this is the single highest-value Phase 5 item.
2. Integrate one real map provider against the existing `MapProvider`
   interface.
3. Draft and get legal review on a privacy policy and terms of service;
   fill in the Play Console Data Safety / App Store Connect Privacy
   Nutrition Label forms from them.
4. Real app icon/splash assets and a decision on one app vs. a passenger/
   driver split, then actual store submission.
5. A real load test against the targets in
   [19 — Performance Targets](./19-performance-targets.md), using it to
   decide whether the SQLite→Postgres move (§10) is needed before launch
   or can wait.
6. Enforce `AdminRole.cityScope` as an actual query filter across admin
   list endpoints, once there's a second live (not just planned) city
   for it to matter for.
7. A real SMS/push provider integration.

---

**Stopping here per instructions.** Phase 4 is finished — multi-city
architecture, localization, real payment/map/notification integration
points (not yet connected to a live provider), corporate accounts,
growth/CMS/support/safety tooling, observability, data privacy, rate
limiting, background jobs, database performance, Pilot Mode, analytics
v2, frontend wiring, an expanded test suite, and a security review with
real fixes applied. Not proceeding to Phase 5.
