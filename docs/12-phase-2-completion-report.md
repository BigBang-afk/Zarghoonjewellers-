# 12 — Phase 2 Completion Report

Phase 2 objective: make the core passenger → ride request → driver → offer →
passenger selection workflow **actually work**, end to end, against a real
backend and database. This report covers what was built, how to run it, and
exactly what is real vs. mocked.

No architecture from Phase 1 was redesigned. The brand, database entity
model, API shape, negotiation model (Quick Match vs. Competitive Offer),
and design system are all preserved and implemented as specified — the one
addition is a `RefreshToken`/`OtpCode`/`PlatformSetting` table set, which
Phase 1 didn't enumerate but is needed to make auth and admin-configurable
matching/negotiation values real rather than hard-coded.

---

## 1. What was built

**Backend** (`/backend`) — a real Node.js/TypeScript/Express API with a
Prisma-modeled SQLite database (Postgres-portable), Socket.IO real-time
gateway, and a Vitest test suite:

- Full **role-based auth**: passenger/driver/admin registration, OTP phone
  verification, password login, JWT access + rotating refresh tokens,
  forgot/reset password, RBAC middleware (role + admin sub-role scopes).
- **Fare Engine**: admin-configurable `FareRule`s (base/per-km/per-min/min/
  max/commission per city+vehicle-type, optional per-zone override) plus a
  live demand multiplier from online-driver/open-request ratios.
- **Matching Engine**: eligibility filtering (online, verified, right
  vehicle type, in-radius) + weighted scoring (ETA, acceptance rate,
  rating, idle-time fairness), with a configurable expanding search
  radius.
- **Negotiation Engine**: Quick Match (sequential single-driver dispatch,
  auto-escalates on decline/expiry) and Competitive Offer (broadcast to N
  drivers, accept/counter/decline, passenger compares and picks) — both
  built on the same `RideRequest`/`RideOffer`/`CounterOffer` tables, all
  timers server-owned and swept every 5s.
- **Booking transaction**: race-safe driver double-booking prevention via
  two atomic conditional updates inside one Prisma interactive
  transaction (see `backend/src/services/bookingService.ts`).
- **Full ride status state machine**: `driver_selected → driver_arriving →
  driver_arrived → ride_started → ride_completed`, plus
  `cancelled_by_passenger/driver`, `expired`, `disputed`, every transition
  writing a `RideStatusHistory` row and validated server-side.
- **Ride completion**: computes final fare, commission (from the
  `FareRule`, never hard-coded), driver payout, records `Payment` +
  `Commission` + a driver `Wallet` `Transaction`.
- **Ratings**: one per (ride, rater) enforced by a DB unique constraint,
  running-average aggregate update.
- **Driver earnings**: today/week/month aggregation from real wallet
  transactions.
- **Admin APIs**: real-database KPIs (no placeholder numbers), live map,
  driver verification queue + approve/reject (with audit log + driver
  notification), searchable/filterable passengers/drivers/vehicles/ride
  requests/rides/ratings, payments/commissions, disputes/support tickets/
  safety events, cities/service zones/fare rules/platform settings CRUD,
  audit log viewer.
- **Safety**: SOS (writes a `SafetyEvent`, alerts the admin live-map
  channel — explicitly does **not** claim to contact emergency services),
  report driver/passenger (creates a `Dispute` + `SafetyEvent`), trip
  sharing (signed token, public read-only endpoint).
- **Real-time layer**: Socket.IO with `user:{id}`, `ride:{id}`, and
  `admin:live-map` rooms; every event is also persisted first (sockets are
  a delivery accelerator, not the source of truth).
- **Service abstractions, explicitly labeled dev/mock where relevant**:
  `MapProvider` (Haversine — real math, no live routing), `PaymentProvider`
  (`cash` real; `card`/`wallet`/`local_provider` via a labeled
  `MockCardProvider`), `NotificationProvider` (in-app + socket are real;
  SMS/push/email log to console in dev), `OtpService` (real generation/
  expiry/single-use logic; dev mode echoes the code in the API response
  instead of needing a real SMS gateway).
- **Seed data**: 10 passengers, 30 drivers + vehicles (25 approved, 5
  pending verification), 8 completed rides with payments/commissions/
  ratings, 4 active rides across different statuses, 5 pending requests
  with live offers (including a competitive counter-offer example),
  support tickets, a dispute, a safety event, promotions — every value
  clearly commented as seed/demo data.
- **Tests**: 12 Vitest + Supertest tests against a real (ephemeral SQLite)
  database covering the full happy path (Quick Match end-to-end including
  payment/commission/wallet/rating) plus Competitive Offer + counter-offer
  acceptance, offer expiry + Quick Match escalation, passenger
  cancellation, driver cancellation, no-drivers-available, concurrent
  double-booking prevention, unauthorized access (own-resource and
  wrong-driver), invalid fare, and invalid status transitions.

**Frontend** (`/frontend`) — the Phase 1 UI rewired to the real backend:

- API client with auth-token injection and automatic refresh-on-401.
- `AuthContext` + `ProtectedRoute` (role-gated), Socket.IO client wired to
  the auth session.
- Login, passenger registration, driver registration (with vehicle info),
  OTP verification — all real network calls.
- **Customer Home**: real cities/vehicle-types/fare-estimates from the
  API, real saved/recent places, Quick Match and Set-Your-Price both
  create a real `RideRequest`, followed by a real Searching panel (Quick
  Match) or Offers panel (Competitive — sortable, shows live counter-
  offers, only lets you select an offer once a driver has actually
  responded), a live ride tracking panel (real status polling + socket
  push, SOS, share-trip), and a rating panel.
- **Driver Home**: real availability toggle (blocked until admin-approved),
  real incoming-request card with Accept/Counter/Decline hitting the real
  negotiation endpoints, a real active-ride panel driving the ride through
  every status, a real earnings panel.
- **Admin Dashboard**: Dashboard, Driver Verification, Passengers, Drivers,
  and Ride Requests are fully wired to live data; the remaining nav items
  are honestly labeled as scoped for a later phase (same pattern Phase 1
  used, now explicit that four more sections are real).

---

## 2. Files created / modified

~65 new backend files under `backend/src/`, `backend/prisma/`,
`backend/tests/`; ~40 new/rewritten frontend files under `frontend/src/`
(new `api/`, `auth/`, `config/`, `services/`, `shared/`, `types/`
directories; `pages/` reorganized into `passenger/`, `driver/`, `admin/`,
`auth/` subfolders). Full listing:

```
backend/
  prisma/schema.prisma, seed.ts, migrations/
  src/api/{auth,passenger,driver,rides,admin,safety,notifications,public}/...
  src/services/{fareEngine,matchingEngine,negotiationEngine,bookingService,
                 rideLifecycleService,ratingService,rideRequestService}.ts
  src/services/{maps,payments,notifications,otp}/...
  src/middleware/{auth,validate,errorHandler,rateLimit}.ts
  src/realtime/socket.ts
  src/config/{env,settings}.ts
  src/types/enums.ts
  src/utils/{prisma,jwt,password,apiError,asyncHandler,geo}.ts
  src/shared/{profileLookup,audit}.ts
  src/app.ts, src/server.ts
  tests/{fixtures,helpers,globalSetup,rideFlow.test}.ts

frontend/
  src/api/{client,auth,rides,passenger,driver,admin,safety,notifications,public}.ts
  src/auth/{AuthContext,ProtectedRoute,tokenStore}.tsx|ts
  src/services/socket.ts
  src/shared/{Toast,islamabadPlaces}.tsx|ts
  src/types/index.ts, src/config/env.ts
  src/components/ui/{Input,States}.tsx  (new primitives)
  src/pages/auth/{Login,RegisterPassenger,RegisterDriver}.tsx
  src/pages/passenger/{CustomerHome,SearchingPanel,OffersPanel,
                        LiveRidePanel,RatingPanel}.tsx
  src/pages/driver/{DriverHome,ActiveRidePanel,DriverRatingPanel,
                     EarningsPanel}.tsx
  src/pages/admin/{AdminDashboard,DriverVerificationPanel,DirectoryPanel}.tsx
  src/App.tsx (routing + providers)

docs/12-phase-2-completion-report.md  (this file)
```

Also: `apps/web` renamed to `frontend` per Phase 2's requested top-level
`/frontend /backend` structure.

---

## 3. Database setup instructions

Dev database is SQLite (zero external services, per "keep the application
runnable" — see docs/08's header for why, and the Postgres migration note
below).

```bash
cd backend
npm install
cp .env.example .env
npx prisma migrate deploy   # applies the two committed migrations
```

**Moving to Postgres for staging/production**: change
`datasource db { provider = "postgresql" }` in `prisma/schema.prisma`, set
`DATABASE_URL` to a real Postgres connection string, run
`npx prisma migrate dev` once to generate a fresh Postgres-native migration
(the SQLite migrations don't apply to Postgres directly), and widen the two
SQLite-driven compromises noted in the schema header: `String` enum columns
→ real Postgres `ENUM` types, `Float` money columns → `Decimal`. Both are
mechanical since the field names/shapes don't change.

---

## 4. Environment variables required

See `backend/.env.example` (copy to `.env`) and `frontend/.env.example`
(copy to `.env`). Everything needed for local dev has a working default —
nothing beyond `cp .env.example .env` is required to run the app.

**Backend:**
| Variable | Required for dev? | Notes |
|---|---|---|
| `DATABASE_URL` | Yes (has default) | `file:./dev.db` for SQLite dev |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Yes (has default) | Dev defaults refused at boot if `NODE_ENV=production` |
| `CORS_ORIGIN` | Yes (has default) | Frontend origin(s) |
| `MOCK_OTP` / `MOCK_PAYMENTS` / `MOCK_NOTIFICATIONS` | No (default `true`) | Set `false` once real provider credentials exist |
| `SMS_PROVIDER_*`, `PAYMENTS_PROVIDER_*`, `PUSH_PROVIDER_*`, `MAPS_PROVIDER_*` | **No — not implemented** | Commented placeholders for Phase 3 |

**Frontend:**
| Variable | Notes |
|---|---|
| `VITE_API_URL` | Defaults to `http://localhost:4000/v1` |
| `VITE_SOCKET_URL` | Defaults to `http://localhost:4000` |

---

## 5. How to run the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Open the printed local URL. The "Phase 2 preview" bar lets you jump
between Landing / Customer App / Driver App / Admin Dashboard; each route
is now auth-protected and redirects to `/login` if you're signed out.

## 6. How to run the backend

```bash
cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev
```
Backend listens on `http://localhost:4000` (REST under `/v1`, health check
at `/health`, Socket.IO on the same port).

## 7. How to run database migrations

```bash
cd backend
npx prisma migrate deploy      # apply committed migrations (CI/prod-safe)
# or, while changing prisma/schema.prisma during development:
npx prisma migrate dev --name <description>
```

## 8. How to seed demo data

```bash
cd backend
npm run seed
```
Wipes and recreates all seed data (safe to re-run any time in dev — never
run against a production database). Prints the test-account credentials
on completion.

## 9. Test accounts

All seed/demo data, fixed passwords for reproducible testing:

| Role | Phone | Password | Notes |
|---|---|---|---|
| Passenger | `+923001000001` … `+923001000010` | `Passenger123!` | 10 accounts |
| Driver | `+923002000001` … `+923002000030` | `Driver123!` | Last 5 (`…026`–`…030`) are `pending` verification — good for testing the admin approval flow |
| Admin (super_admin) | `+923000000001` | `Admin123!` | Full access |
| Admin (ops_manager) | `+923000000002` | `Admin123!` | Scoped to Islamabad |

Backend tests: `cd backend && npm test` (12/12 passing).

---

## 10. What is fully functional

- Registration (passenger + driver), OTP phone verification, password
  login/logout, forced-verification gating (drivers can't go online until
  admin-approved).
- Ride request creation with a real Fare Engine estimate.
- Quick Match: real sequential dispatch, driver accept auto-books the
  ride, decline/expiry escalates to the next-best driver.
- Competitive Offer: real broadcast to multiple eligible drivers,
  accept/counter/decline, passenger sees a live, sortable list and can
  only book an offer once a driver has actually accepted or countered
  (fixed during E2E verification — see §13).
- The full ride status lifecycle, both directions of cancellation, ride
  completion with real fare/commission/payout calculation and wallet
  crediting.
- Ratings (duplicate-prevented, aggregate-updated) both directions.
- Driver earnings (today/week/month, real transaction data).
- Admin Dashboard KPIs, Live Map, Driver Verification (with real
  approve/reject + audit log + driver notification), Passengers, Drivers,
  Ride Requests — all live database data.
- Real-time push (Socket.IO) for new requests, offers, counter-offers,
  status changes, notifications — verified in-browser across two
  concurrent sessions (passenger + driver) plus an admin session.
- Safety: SOS event logging + admin alert, report → dispute, trip-share
  token + public read-only tracking page.
- Server-side validation, RBAC, rate limiting, audit logging, and the
  booking race-condition guard (verified under real concurrent requests
  in both the automated test suite and manual testing).

## 11. What is mocked

Every item below is a real code path with an explicit dev/mock adapter
behind the same interface a production adapter would implement — none of
it pretends to be a live external integration:

- **OTP delivery** — a real 6-digit code is generated, stored with
  expiry, single-use; it's logged to the server console and echoed in the
  dev API response instead of sent via a real SMS gateway.
- **Card/wallet/local-provider payments** — `MockCardProvider` always
  succeeds; cash is the one fully "real" method (nothing to mock).
- **SMS / push / email** — `ConsoleProviders` log to the server console.
  In-app notifications (DB row + Socket.IO push) are real.
- **Maps/routing** — `HaversineMapProvider` computes real straight-line
  distance × a road-detour factor, and ETA from a per-vehicle-type
  average speed. No live traffic, no real road network.
- **Driver location** — the frontend sends real `navigator.geolocation`
  when granted, otherwise a fixed Islamabad demo point (never a fabricated
  moving position).
- **Calling** — the UI has a "Call" button; it explicitly tells the user
  masked calling requires a real telephony integration rather than
  pretending to place a call.
- **Chat** — the REST endpoints and socket event are real and tested at
  the API layer; the frontend exposes the entry point but the full
  chat UI is a Phase 3 build-out (matches the "minimal chat" scope
  decision recorded in the rides router).

## 12. What requires external API credentials (Phase 3)

| Capability | Needs | Where it plugs in |
|---|---|---|
| Real SMS OTP | Twilio (or similar) account SID/token/from-number | New `SmsProvider` implementation in `backend/src/services/notifications/`, swapped in for `ConsoleProviders`; set `MOCK_OTP=false` |
| Real card payments | Stripe (or similar) secret key | New `PaymentProvider` implementing `authorize/capture/refund`, swapped in for `MockCardProvider` in `services/payments/index.ts`; set `MOCK_PAYMENTS=false` |
| Real push notifications | FCM server key | New `PushProvider` implementation |
| Real routing/maps | Google Maps or Mapbox API key | New `MapProvider` implementing `estimateRoute`, swapped in for `HaversineMapProvider` |
| Real emergency-services dispatch | A local emergency API/partnership (jurisdiction-specific — no generic "API key" exists) | `backend/src/api/safety/router.ts` `/sos` handler |

None of these are read from environment variables today (see the commented
placeholders in `.env.example`) — they're deliberately absent rather than
wired to empty strings, so it's obvious nothing is silently half-configured.

## 13. Known limitations

- **Auth token storage**: plain `localStorage` (documented trade-off in
  `frontend/src/auth/tokenStore.ts`) — vulnerable to XSS reading the
  refresh token. Production hardening: httpOnly cookie-based refresh
  tokens.
- **Passenger city selection**: the frontend currently books against
  whichever city is `status=live` first (there's only one at launch,
  matching the Phase 1 single-city launch posture); multi-city passenger
  city-switching UI is Phase 3.
- **In-process timers**: offer/counter-offer/request expiry runs on a
  5-second `setInterval` sweep in the single backend process — correct for
  one instance, needs a durable job scheduler (or DB-native TTL) once the
  backend is horizontally scaled.
- **SQLite dev database**: great for a zero-infra demo; two schema
  compromises (string enums, float money) are documented in
  `prisma/schema.prisma`'s header and resolved by the Postgres migration
  path in §3.
- **No file uploads**: driver documents/vehicle photos are stored as URL
  strings (seed data uses placeholder URLs); real upload handling
  (S3/Cloudinary-style) is Phase 3.
- **Admin nav breadth**: Dashboard, Live Map, Driver Verification,
  Passengers, Drivers, and Ride Requests are fully live; the remaining ~18
  admin sections (Payments UI, Commissions UI, Promotions UI, Disputes UI,
  Support UI, Cities/Zones/Pricing editing UI, Analytics, Reports,
  Settings UI, Admin Users UI, Audit Logs UI) have working, tested backend
  APIs (§10 lists which) but no dedicated frontend screen yet — they show
  the same honest "scoped for a later phase" placeholder Phase 1 used.
- **A bug found and fixed during E2E verification**: the passenger Offers
  panel initially let you try to "select" a driver who had merely received
  the request but not yet responded (`status=pending`, no accept/counter).
  The backend correctly rejected this (`409 OFFER_NOT_AVAILABLE`); the fix
  makes the frontend only offer selection once a driver has actually
  accepted or countered, showing "Waiting for driver to respond…"
  otherwise. Caught by running the Competitive Offer flow through a real
  browser against the real backend, not just unit-level assumptions —
  worth calling out because it's exactly the class of bug that only shows
  up end-to-end.
- **Two more bugs found the same way**: `POST /counter-offers/:id/accept`
  and the ride-status-update endpoint were returning inconsistent response
  shapes (a bare `Ride` row missing `passenger`/`driver`/`vehicle`
  relations) that crashed the frontend on read. Fixed by making every ride
  mutation endpoint return the same fully-populated shape as
  `GET /rides/:id`.

## 14. Recommended Phase 3

In priority order:

1. **Finish the admin frontend** for the sections with working APIs but no
   UI yet (§13) — highest leverage since the backend work is already done.
2. **Real external integrations**: pick one of SMS/payments/maps and wire
   a production adapter behind the existing interface, as a template for
   the rest.
3. **Chat UI** and **driver navigation/turn-by-turn** screens (backend
   ready, frontend entry points stubbed).
4. **File uploads** for driver/vehicle documents (currently URL-only).
5. **Move the negotiation-expiry sweeper** to a durable scheduler (or
   Postgres `pg_cron`) ahead of any horizontal scaling.
6. **Harden auth token storage** (httpOnly refresh-token cookie) before
   any real user data goes through this.
7. **Postgres migration** for a production-representative environment
   (mechanical — see §3).
8. **Wallet withdrawals** — earnings currently accrue in-wallet with no
   payout-initiation flow yet (flagged in `EarningsPanel.tsx`).

---

**Stopping here per instructions — not proceeding to Phase 3.**
