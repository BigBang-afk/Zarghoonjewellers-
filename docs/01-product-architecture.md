# 01 — Product Architecture

## 1. What RIVO is

RIVO is a two-sided ride-hailing **marketplace**, not a fixed-dispatch service. Passengers
and drivers meet on price and availability, not just proximity. The marketplace model:

1. Passenger enters pickup and destination.
2. Passenger proposes a fare **or** requests the platform-suggested fare.
3. Nearby eligible drivers receive the request.
4. Drivers accept the proposed fare or submit a counter-offer.
5. Passenger sees available driver offers.
6. Passenger compares price, ETA, rating, vehicle, and driver information.
7. Passenger chooses a driver.
8. Ride begins.
9. Passenger tracks the ride live.
10. Ride completes.
11. Payment and receipt are generated.
12. Passenger and driver rate each other.

## 2. The core differentiator: two booking modes

RIVO deliberately supports **two coexisting modes** on the same live pool of nearby
drivers, selected per-request, not per-account:

### Mode 1 — Quick Match
Passenger wants a ride now. The **Matching Engine** scores nearby eligible drivers
(distance, ETA, vehicle type, acceptance history, availability) and auto-books the
best candidate at the platform-suggested fare. Optimized for speed, not price
discovery.

### Mode 2 — Competitive Offer
Passenger proposes a price. The request fans out to nearby eligible drivers via the
**Negotiation Engine**. Drivers accept, counter, or ignore. The passenger sees a
live list of offers and picks one — on price, ETA, rating, or vehicle. Optimized for
price discovery and passenger control.

Both modes:
- Use the same `RideRequest` entity and the same driver eligibility/matching filters.
- Differ only in `booking_mode` and whether counter-offers are solicited.
- Can be offered side-by-side on the Customer Home screen so the passenger picks
  the mode per-trip, not as a locked account setting.

## 3. Vehicle types (initial)

| Type | Typical capacity | Use case |
|------|------------------|----------|
| Bike | 1 | Cheapest, fastest through traffic, short trips |
| Rickshaw | 2–3 | Low-cost local trips |
| Economy car | 4 | Default car tier |
| Standard car | 4 | More comfort/newer vehicles |
| Premium car | 4 | High-end vehicles, business trips |

Vehicle types are **data, not code** (`vehicle_types` table, see schema) — a city can
enable a subset, and new types (e.g. van, EV-only tier) can be added without a
deployment.

## 4. Single city launch, multi-city/multi-country architecture

RIVO launches in one city (Islamabad, Pakistan, in the demo data) but every
domain concept is scoped under `City` → `ServiceZone` from day one:

- **Country** → holds currency, locale, legal/regulatory defaults.
- **City** → holds operating status (`planned` / `launching` / `live` / `paused`),
  timezone, currency override.
- **Service Zone** → a polygon within a city used for zonal pricing, demand
  heatmaps, and driver eligibility (a zone can be car-only, bike-only, etc.).

No table, fare rule, or matching filter is hardcoded to one city — city/zone IDs are
foreign keys everywhere pricing, matching, and reporting happen. See
[06 — Technical Architecture](./06-technical-architecture.md) and
[08 — Database Schema](./08-database-schema.sql).

## 5. Roles

- **Passenger** — books rides, negotiates fares, rates drivers.
- **Driver** — accepts/counters requests, drives, earns.
- **Admin / Ops** — configures fares, verifies drivers, monitors the marketplace,
  handles disputes and safety, role-scoped via `AdminUsers` (see
  [09 — API Architecture](./09-api-architecture.md) for RBAC scopes).

## 6. Non-goals for Phase 1

- No real backend, database, or payment processor — UI only, against static mock data.
- No live maps SDK integration — a stylized mock map surface stands in for it.
- No production auth — screens are designed but not wired to a real identity
  provider.
