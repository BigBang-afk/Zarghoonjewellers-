# 05 — Admin Journey

How the operations team uses the Admin Web Dashboard (see
[02 — Feature Map](./02-feature-map.md) for the full 26-section inventory).

## A. Daily operations check (🟢 Dashboard, built)

An ops admin logs in and lands on **Dashboard**, which answers "is the
marketplace healthy right now?" in one screen:

- **KPI cards** (top row): rides today, active rides, online drivers, gross
  booking value, platform revenue, avg. fare, avg. ETA, driver acceptance rate.
- **Secondary stats strip**: total/active passengers, total drivers, completed/
  cancelled today, driver earnings, avg. duration, driver/passenger
  cancellation rates, repeat passenger rate.
- **Live Map panel**: driver dots colored by status (online / on trip /
  pending), no personal data exposed at this zoom level (see
  [06 — Technical Architecture § Privacy on the live map](./06-technical-architecture.md)).
- **Cities panel**: per-city status (live / launching / planned), driver count,
  zone count — the multi-city posture made visible.
- **Recent ride requests table**: ID, passenger, driver, vehicle, mode
  (Quick Match / Competitive), fare, status.
- A standing **alert badge** for drivers awaiting verification, linking to the
  Driver Verification queue.

## B. Driver verification queue (Phase 2 workspace, entry point built)

Admin reviews a driver's submitted documents (ID, license, vehicle registration,
insurance, photos) against `driver_documents`/`vehicle_documents`, and:

- **Approves** → driver can go online.
- **Rejects** → reason recorded, driver notified, can resubmit.
- **Requests more info** → document stays `pending`, note added.

Every decision writes an `AuditLogs` row (admin id, action, target, timestamp).

## C. Ride operations

- **Ride Requests / Active Rides / Completed Rides / Cancelled Rides** — filtered
  views over the same `rides`/`ride_requests` tables the Dashboard summarizes,
  for drilling into a specific ride (timeline, status history, chat log,
  location breadcrumbs).
- Cancelling, reassigning, or force-completing a ride from here is a
  privileged action, logged to `AuditLogs`.

## D. Finance

- **Payments** — transaction-level view across all payment methods.
- **Commissions** — platform take by city/vehicle-type/time period; commission
  rules are configured here, not hardcoded (see Fare Engine,
  [06](./06-technical-architecture.md)).
- **Promotions** — create/manage promo codes, discount rules, eligible cities.

## E. Trust & safety

- **Support** — ticket queue, SLA status.
- **Disputes** — passenger/driver disputes over fare, behavior, or route,
  resolved with a documented outcome.
- **Safety** — `SafetyEvents` feed (SOS triggers, trip-share activity,
  in-app reports), triaged by severity.
- **Fraud / Risk** — flags from the fraud/risk scoring pipeline (fake accounts,
  GPS spoofing, collusive cancellation patterns, payment fraud) queued for
  manual review.

## F. Configuration

- **Cities** — add a city, set its operating status, currency, timezone
  (🟢 read-only panel built on Dashboard; create/edit flow is Phase 2).
- **Service Areas** — draw/edit zone polygons within a city.
- **Pricing** — configure the Fare Engine's per-city, per-vehicle-type inputs
  (base fare, per-km, per-minute, minimum fare, surge rules, commission %) —
  see [06 — Technical Architecture § Fare Engine](./06-technical-architecture.md).
  This is the enforcement point for "fare engine must be configurable by
  administrators, not hard-coded."

## G. System

- **Analytics / Reports** — trend charts and exportable reports beyond the
  Dashboard's real-time snapshot.
- **Notifications** — compose/broadcast system notifications to passengers or
  drivers (by city, segment, or individually).
- **Admin Users** — manage admin accounts and role scopes (RBAC — see
  [09 — API Architecture](./09-api-architecture.md)).
- **Settings** — platform-wide configuration (feature flags, support contact
  info, legal text).
- **Audit Logs** — searchable log of every privileged admin action.

## Role-based access

Not every admin sees every section. `AdminUsers.role` gates the nav (e.g. a
Support agent sees Support/Disputes/Safety but not Pricing or Admin Users) —
enforced server-side per [09 — API Architecture](./09-api-architecture.md), not
just hidden in the UI.
