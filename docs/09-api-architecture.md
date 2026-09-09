# 09 — API Architecture

## 1. Style

- **REST + JSON** over HTTPS for request/response operations (auth, CRUD,
  booking actions).
- **WebSocket** (`wss://realtime.rivo.app`) for everything latency-sensitive
  (offers streaming in, location updates, chat, notifications) — see
  [06 — Technical Architecture § Real-time system](./06-technical-architecture.md).
- **Versioned** under `/v1/...`; breaking changes ship as `/v2/...` behind a
  deprecation window, never as a silent behavior change on `/v1`.
- Services sit behind a single **API Gateway / BFF** so clients never call
  internal services directly; the gateway does authN, rate limiting, request
  validation, and routes to the owning service.

## 2. Base URL & environments

```
https://api.rivo.app/v1        production
https://api.staging.rivo.app/v1 staging
```

## 3. Authentication

```
POST /v1/auth/otp/request        { phone }                → { requestId }
POST /v1/auth/otp/verify         { requestId, code }       → { accessToken, refreshToken, user }
POST /v1/auth/token/refresh      { refreshToken }          → { accessToken, refreshToken }
POST /v1/auth/logout             (bearer)                  → 204
```

Access tokens: short-lived JWT (15 min), carrying `sub` (user id), `role`, and
for admins, `admin_role` + `city_scope`. Refresh tokens: opaque, rotating,
revocable server-side (stored hashed).

## 4. Role-based scopes

| Scope | Who | Example |
|---|---|---|
| `passenger` | passenger role | book rides, manage own profile/wallet |
| `driver` | driver role | go online, respond to requests, view own earnings |
| `admin:read` | any admin role | dashboard, reports |
| `admin:ops` | ops_manager, super_admin | manage rides, cities, pricing |
| `admin:finance` | finance, super_admin | payments, commissions, payouts |
| `admin:safety` | safety_officer, super_admin | safety events, disputes |
| `admin:super` | super_admin | admin user management, audit logs |

Every endpoint declares its required scope; the gateway rejects unscoped
requests with `403` before the request reaches a service — matching
`AdminUsers.role` from the schema.

## 5. Core resource endpoints (representative, not exhaustive)

### Rides & the marketplace

```
POST   /v1/ride-requests
  { pickup, destination, vehicleTypeId, bookingMode, proposedFare? }
  → 201 { rideRequest }                    creates a RideRequest; quick_match
                                            auto-fills proposedFare = suggestedFare

GET    /v1/ride-requests/:id               → { rideRequest, offers[] }
DELETE /v1/ride-requests/:id               → 204   (passenger cancels)

GET    /v1/ride-requests/:id/offers        → { offers[] }   poll fallback; primary
                                              delivery is the `ride_offer.*` WS event

POST   /v1/ride-offers/:id/accept          (driver)  → { offer }
POST   /v1/ride-offers/:id/decline         (driver)  → 204
POST   /v1/ride-offers/:id/counter         (driver)  { counterPrice } → { counterOffer }

POST   /v1/counter-offers/:id/accept       (passenger) → { ride }   books the ride
POST   /v1/counter-offers/:id/reject       (passenger) → 204

POST   /v1/rides/:id/arrive                (driver)  → { ride }
POST   /v1/rides/:id/start                 (driver)  → { ride }
POST   /v1/rides/:id/complete              (driver)  → { ride, payment }
POST   /v1/rides/:id/cancel                (either)  { reason } → { ride }

GET    /v1/rides/:id                       → { ride, statusHistory[] }
GET    /v1/rides                           → { rides[] }   history, paginated
```

### Fare estimation

```
POST   /v1/fare-estimates
  { pickup, destination, vehicleTypeId, cityId }
  → { suggestedFare, minimumFare, maximumFare, breakdown }
```
Calls the Fare Engine directly (no request/offer created) — used to render
per-vehicle-type estimates on Customer Home before the passenger commits.

### Driver operations

```
PATCH  /v1/drivers/me/availability   { status: online|offline } → { driverProfile }
PATCH  /v1/drivers/me/location       { lat, lng, heading, speed } → 204  (high-frequency; also accepted over WS)
GET    /v1/drivers/me/earnings       ?range=today|week|month     → { summary, entries[] }
```

### Payments & wallet

```
POST   /v1/payments/:rideId/capture        → { payment }
POST   /v1/payments/:rideId/refund         { amount? } → { payment }
GET    /v1/wallet                          → { wallet, recentTransactions[] }
POST   /v1/wallet/withdraw                 { amount, payoutMethodId } → { transaction }
```

### Safety

```
POST   /v1/safety/sos            { rideId, lat, lng } → 201 { safetyEvent }   optimistic client-side ack
POST   /v1/rides/:id/share       → { shareToken, shareUrl }
GET    /v1/public/trip/:shareToken → { liveLocation, eta, driver: { name, vehicle } }  -- no auth, read-only, time-boxed
```

### Admin

```
GET    /v1/admin/dashboard/kpis          ?cityId= → { kpis }
GET    /v1/admin/live-map                ?cityId= → { drivers[], activeRides[] }
GET    /v1/admin/drivers/verification-queue        → { pending[] }
POST   /v1/admin/drivers/:id/verify      { decision: approve|reject, reason? }
GET    /v1/admin/pricing/fare-rules      ?cityId=
PUT    /v1/admin/pricing/fare-rules/:id  { baseFare, perKmRate, ... }
GET    /v1/admin/audit-logs              ?targetTable=&targetId=
```

## 6. Real-time channels (WebSocket)

Clients connect once (`wss://realtime.rivo.app?token=<access_token>`) and
subscribe to channels scoped to what they're allowed to see:

```
passenger:{userId}          → ride.status_changed, ride_offer.*, counter_offer.*, chat.message, notification.created
driver:{userId}              → ride_request.created (eligible only), ride.status_changed, chat.message, notification.created
ride:{rideId}                → shared channel for the two participants during an active ride
admin:city:{cityId}:live-map → driver.location.updated (coarse), ride.status_changed (aggregate)
```

Server authorizes each subscription against the token's `sub`/`role`/
`city_scope` — a passenger can never subscribe to another user's channel.

## 7. Error contract

```json
{
  "error": {
    "code": "RIDE_OFFER_EXPIRED",
    "message": "This offer has expired.",
    "requestId": "a1b2c3"
  }
}
```
Stable machine-readable `code` per failure mode (documented per endpoint),
human `message` safe to show, `requestId` for support/log correlation.
Standard HTTP status semantics: `400` validation, `401` unauthenticated,
`403` unauthorized, `404` not found, `409` conflict (e.g. offer already
accepted by someone else), `422` business-rule rejection, `429` rate limited.

## 8. Rate limiting

Per-IP and per-account token buckets at the gateway; tighter limits on
`/auth/otp/*` (prevent OTP abuse) and `/ride-requests` (prevent request
spam) than on read endpoints. Limits are city/plan-configurable, not
hardcoded, mirroring the Fare Engine's configurability principle.

## 9. Idempotency

State-changing POSTs that could be safely retried (`accept`, `counter`,
`complete`, `capture`) accept an `Idempotency-Key` header; the gateway
dedupes retries within a 24h window and returns the original response.
