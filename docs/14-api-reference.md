# 14 — API Reference (as implemented)

This is a reference for the **actual implemented** Phase 1-4 REST API, generated
by reading every router under `backend/src/api/` and its mount points in
`backend/src/app.ts`. Where [09 — API Architecture](./09-api-architecture.md)
describes the intended design, this document describes what the code does
today — endpoint by endpoint, with the real path, auth requirement,
validation, and response shape. If the two ever disagree, this file is right
and 09 is the older aspirational doc.

Base URL: **`/v1`** (mounted directly on the Express app — see `createApp()`
in `backend/src/app.ts`). Two ungated liveness/readiness endpoints exist
outside `/v1`: `GET /health` (process up) and `GET /ready` (DB reachable, 503
if not).

All request bodies are validated with a `zod` schema via `validateBody()`
before the handler runs; a failing body never reaches application code — it
short-circuits with a `400 VALIDATION_ERROR` carrying the zod flatten() error
under `details`. Query-string params are mostly hand-parsed per-route (not
all query filters go through `validateQuery`), so query validation is noted
per-endpoint only where it's enforced.

## Error envelope

Every error response (from a thrown `ApiError` or an unhandled exception,
see `backend/src/middleware/errorHandler.ts`) has the same shape:

```json
{
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "Human-readable message.",
    "requestId": "uuid",
    "details": { "...": "optional, e.g. zod flatten() output" }
  }
}
```

Common status codes (`backend/src/utils/apiError.ts`):

| Status | Meaning | Typical `code` |
|---|---|---|
| 400 | Bad request / validation | `VALIDATION_ERROR`, or a route-specific code (`INVALID_CITY`, `INVALID_CREDENTIALS`, …) |
| 401 | Not authenticated | `UNAUTHENTICATED` |
| 403 | Authenticated but not permitted | `FORBIDDEN` |
| 404 | Not found | `NOT_FOUND` |
| 409 | Conflict with current state | route-specific (`PHONE_ALREADY_REGISTERED`, `DRIVER_ON_TRIP`, …) |
| 422 | Understood but can't be processed | route-specific (`TOPUP_FAILED`, …) |
| 429 | Rate limited | `RATE_LIMITED` |
| 500 | Unhandled/internal (incl. Prisma errors) | `INTERNAL_ERROR` |

A route not matched by any router returns `404 NOT_FOUND` from the global
`notFoundHandler`.

## Authentication

Auth is a **Bearer JWT access token** (`Authorization: Bearer <token>`),
issued by `POST /v1/auth/login` or `POST /v1/auth/otp/verify`, short-lived
(`env.jwtAccessTtl`), paired with an opaque, rotating, revocable refresh
token exchanged at `POST /v1/auth/token/refresh`. The access token's claims
(`backend/src/utils/jwt.ts`, populated onto `req.auth` by `requireAuth` in
`backend/src/middleware/auth.ts`):

- `sub` — user id
- `role` — `passenger` \| `driver` \| `admin`
- `adminRole` — set only when `role === "admin"`, one of the `AdminRole`
  values below
- `cityScope` — an admin's city restriction, if any (defined on the token but
  **not currently enforced** as a query filter by any reviewed admin route —
  every admin list endpoint is platform-wide unless it accepts an explicit
  `cityId` query param)

Three auth middlewares gate routes:

- **`requireAuth`** — valid Bearer token required, else `401`.
- **`requireRole(...roles)`** — `req.auth.role` must be one of the listed
  `UserRole`s, else `403`. Used for `passenger` / `driver` / `admin`.
- **`requireAdminRole(...adminRoles)`** — `role` must be `admin` **and**
  `adminRole` must be one of the listed roles, else `403`. `super_admin`
  always bypasses this check regardless of the list passed in.

`AdminRole` (`backend/src/types/enums.ts`), in full:

```
super_admin, ops_manager, support_agent, finance, safety_officer,
read_only, city_admin, marketing
```

Every route mounted under `/v1/admin` first passes through the router-level
`requireAuth, requireRole("admin")` (see `admin/router.ts`) — so *any* admin
account, regardless of `adminRole`, can reach an admin GET endpoint that adds
no further `requireAdminRole` gate (most read/list endpoints). Mutating
endpoints almost always add an explicit `requireAdminRole(...)` allow-list,
documented per-endpoint below as **Admin: `role1|role2|...`**. `city_admin`
is defined in the enum but, as of this review, is not referenced by any
`requireAdminRole(...)` call in the routers — no endpoint currently gates on
it specifically.

Below, "Auth" lines are shorthand: **none** = no auth; **Bearer** = any
authenticated user regardless of role; **Bearer, passenger** /
**Bearer, driver** = `requireRole` scoped; **Admin (any)** = any signed-in
admin; **Admin: `x|y`** = `requireAdminRole("x","y")` (remember `super_admin`
always passes).

---

## 1. Auth — `/v1/auth`

Router-level: `authRateLimit` applied to every route in this router (15 min
window, 20 requests).

### POST /v1/auth/register/passenger
Auth: none.
Body: `{ fullName, phone, email?, password, photoUrl?, referredByCode?, invitationCode?, acquisitionSource?, acquisitionCampaign?, marketingOptIn? }`
Response: 201 `{ userId, referralApplied, otp: { requestId, expiresAt, devCode } }`
Errors: 409 `PHONE_ALREADY_REGISTERED`; Pilot Mode may reject registration (see `enforcePilotModeForRegistration`).
Notes: creates `User` (status `pending_verification`) + `PassengerProfile` + `Wallet`, mints a referral code, best-effort applies `referredByCode`, then requests a registration OTP.

### POST /v1/auth/register/driver
Auth: none.
Body: `{ fullName, phone, email, password, photoUrl?, cityId, vehicle: { vehicleTypeCode, make, model, year?, color?, plateNumber }, referredByCode?, invitationCode?, acquisitionSource?, acquisitionCampaign?, marketingOptIn? }`
Response: 201 `{ userId, referralApplied, otp: {...}, note }`
Errors: 409 `PHONE_ALREADY_REGISTERED`, 400 `INVALID_CITY`, 400 `INVALID_VEHICLE_TYPE`, 409 `PLATE_ALREADY_REGISTERED`.
Notes: creates `User` + `Wallet` (city currency) + `DriverProfile` (verificationStatus `pending`) + one `Vehicle` (status `pending`). Driver cannot go online until an admin approves verification.

### POST /v1/auth/otp/request
Auth: none. Body: `{ phone, purpose: "registration"|"login"|"reset_password" }`
Response: `{ requestId, expiresAt, devCode }`
Errors: 404 if `purpose != "registration"` and no user exists for `phone`.

### POST /v1/auth/otp/verify
Auth: none. Body: `{ requestId, code }`
Response (purpose `reset_password`): `{ purpose, resetToken }` (15-min JWT, `scope: "password_reset"`).
Response (other purposes): `{ purpose, user, accessToken, refreshToken }` — marks phone verified, sets `status: "active"`, issues a session.
Errors: 400 `OTP_NOT_LINKED` if the code isn't tied to a user.

### POST /v1/auth/login
Auth: none. Body: `{ phone, password }`
Response: `{ user, accessToken, refreshToken }`
Errors: 400 `INVALID_CREDENTIALS`; 403 if account `banned`/`suspended`.

### POST /v1/auth/forgot-password
Auth: none. Body: `{ phone }`
Response: `{ ok: true, otp?: {...} }` — always 200 even for unknown phone (doesn't reveal account existence).

### POST /v1/auth/reset-password
Auth: none. Body: `{ resetToken, newPassword }`
Response: `{ ok: true }`
Errors: 400 `INVALID_RESET_TOKEN`.

### POST /v1/auth/token/refresh
Auth: none. Body: `{ refreshToken }`
Response: `{ accessToken, refreshToken }` (rotated). Errors: 401 if expired/invalid/revoked.

### POST /v1/auth/logout
Auth: none. Body: `{ refreshToken }`
Response: 204. Revokes the given refresh token.

### GET /v1/auth/me
Auth: Bearer.
Response: `{ user, passengerProfile, driverProfile, adminProfile, wallet }` (whichever profile relations exist for the caller).

---

## 2. Account (self-service, cross-role) — `/v1/account`

Router-level: `requireAuth` on everything.

### GET /v1/account/referral
Auth: Bearer.
Response: `{ code, referralsMade: [{ id, referredName, status, rewardAmountReferrer, createdAt, rewardedAt }], totalRewardedRs }`

### POST /v1/account/referral/apply
Auth: Bearer. Rate-limited (`referralRateLimit`, admin-configurable).
Body: `{ code }` Response: 201 `{ ok: true }`

### GET /v1/account/notification-preferences
Auth: Bearer.
Response: `{ preferences: [{ type, enabled, locked }] }` — one row per `NotificationType`; `safety`/`system` are always `locked: true`.

### PUT /v1/account/notification-preferences
Auth: Bearer. Body: `{ type: NotificationType, enabled: boolean }`
Response: `{ preference }` Errors: 400 `PREFERENCE_LOCKED` for `safety`/`system`.

### PATCH /v1/account/locale
Auth: Bearer. Body: `{ locale }` (2-10 chars, any BCP-47-ish string accepted). Response: `{ locale }`

### GET /v1/account/me
Auth: Bearer. Response: `{ account: { id, fullName, phone, email, photoUrl, role, status, locale, marketingOptIn, acquisitionSource, acquisitionCampaign, deletionRequestedAt, createdAt, primaryCity } }`

### PATCH /v1/account/marketing-consent
Auth: Bearer. Body: `{ marketingOptIn: boolean }` Response: `{ marketingOptIn }`

### GET /v1/account/export
Auth: Bearer. No body.
Response: 200, `Content-Disposition: attachment` JSON dump of the caller's own data: `{ exportedAt, account, passengerProfile, driverProfile, wallet, transactions, ratingsGiven, ratingsReceived, rides, supportTickets, notifications }` (each collection capped, e.g. 500 rows).

### POST /v1/account/deletion-request
Auth: Bearer. Response: 201 `{ deletionRequestedAt }` Errors: 400 `ALREADY_DELETED`, 409 `DELETION_ALREADY_REQUESTED`.

### DELETE /v1/account/deletion-request
Auth: Bearer. Response: 204 (cancels a pending request). Errors: 404 if none pending, 400 `ALREADY_DELETED`.

---

## 3. Passengers — `/v1/passenger`

Router-level: `requireAuth, requireRole("passenger")`.

**Saved / recent locations**

### GET /v1/passenger/locations/saved
Response: `{ locations }` (the caller's non-deleted saved places).

### POST /v1/passenger/locations/saved
Body: `{ label, address, lat, lng }` Response: 201 `{ location }`

### DELETE /v1/passenger/locations/saved/:id
Response: 204 (soft-delete). Errors: 404 if not owned by caller.

### GET /v1/passenger/locations/recent
Response: `{ locations }` — up to 5 distinct recent ride-request destinations, most recent first.

**Geocoding** (Phase 4 §6, proxies `mapProvider`)

### GET /v1/passenger/locations/geocode?address=...
Response: `{ result }` Errors: 400 `ADDRESS_REQUIRED`.

### GET /v1/passenger/locations/reverse-geocode?lat=&lng=
Response: `{ result }` Errors: 400 `INVALID_COORDINATES`.

**Ride history**

### GET /v1/passenger/ride-history
Response: `{ rides }` — up to 50 terminal (completed/cancelled) rides, newest first, with driver/vehicle/pickup/destination/payment included.

**Wallet** (Phase 2 §9)

### GET /v1/passenger/wallet
Response: `{ balance, pendingBalance, currencyCode, transactions }` (last 50).

### POST /v1/passenger/wallet/topup
Rate-limited (`paymentRateLimit`, admin-configurable).
Body: `{ amount: number (0, 100000], method: "card"|"local_provider" = "card" }`
Response: 201 `{ balance, transaction }` Errors: 422 `TOPUP_FAILED` if the provider capture doesn't return `captured`.

**Promo preview**

### POST /v1/passenger/promo/validate
Rate-limited (`promoRedemptionRateLimit`).
Body: `{ code, cityId, vehicleTypeId, fareAmount }` Response: result of `validatePromoCode(...)` (preview only, no redemption recorded).

**Favorite drivers** (Phase 2 §12)

### GET /v1/passenger/favorites
Response: `{ favorites: [{ id, driverId, name, rating, vehicle, addedAt }] }`

### POST /v1/passenger/favorites/:driverId
Response: 201 `{ favorite }` Errors: 400 `NO_COMPLETED_RIDE` unless the passenger has a `ride_completed` ride with that driver.

### DELETE /v1/passenger/favorites/:driverId
Response: 204.

**Scheduled rides** (Phase 2 §13)

### POST /v1/passenger/scheduled-rides
Body: `{ cityId, zoneId?, vehicleTypeId, pickup: {address,lat,lng}, destination: {address,lat,lng}, bookingMode, proposedFare?, scheduledFor }`
Response: 201 `{ scheduledRide }`

### GET /v1/passenger/scheduled-rides
Response: `{ scheduledRides }` (up to 100, newest-scheduled-first, with pickup/destination/vehicleType/rideRequest).

### PATCH /v1/passenger/scheduled-rides/:id
Body: `{ scheduledFor }` Response: `{ scheduledRide }` (via `rescheduleRide`, scoped to the caller's own scheduled ride).

### DELETE /v1/passenger/scheduled-rides/:id
Response: `{ scheduledRide }` (cancelled, via `cancelScheduledRide`).

---

## 4. Drivers — `/v1/driver`

Router-level: `requireAuth, requireRole("driver")`.

**Availability + location**

### PATCH /v1/driver/me/availability
Body: `{ status: "online"|"offline" }`
Response: `{ driverProfile }` Errors: 409 `DRIVER_ON_TRIP`; 403 if going online before `verificationStatus === "approved"`.
Notes: opens/closes a `DriverOnlineSession` log row; broadcasts `driver.availability_changed` to admins via socket.

### PATCH /v1/driver/me/location
Body: `{ lat, lng, accuracyMeters? }` Response: 204. Errors: 409 `DRIVER_OFFLINE`.
Notes: runs an impossible-movement fraud check (`checkImpossibleMovement`) unless GPS accuracy is worse than `maps.poorAccuracyThresholdM` (in which case it's skipped and recorded as a location failure instead).

### GET /v1/driver/me
Response: `{ driverProfile }` (with user/vehicles/city). Errors: 404 if no driver profile.

**Incoming requests / active ride** (polling fallback to the socket feed)

### GET /v1/driver/me/incoming-requests
Response: `{ offers: [{ id, rideRequestId, bookingMode, pickup, destination, distanceKm, etaMin, offerPrice, paymentMethod, expiresAt, passenger }] }` — the driver's own pending, unexpired `RideOffer`s.

### GET /v1/driver/me/active-ride
Response: `{ ride | null }` — the driver's current non-terminal ride, if any.

**Ride history / earnings**

### GET /v1/driver/ride-history
Response: `{ rides }` (up to 50 terminal rides).

### GET /v1/driver/me/earnings
Response: `{ walletBalanceRs, pendingBalanceRs, paidBalanceRs, today, week, month, charts: { daily, weekly, monthly }, earningsPerHourRs, completedRides, cancelledRides, acceptanceRate, cancellationRate, rating }` — all computed live from `ride_payout` transactions and `DriverOnlineSession` logs (no fabricated numbers).

### GET /v1/driver/me/transactions?type=&from=&to=&page=&pageSize=
Response: `{ transactions, total, page, pageSize }` (paginated, `pageSize` capped at 100).

**Verification / documents**

### GET /v1/driver/me/documents
Response: `{ documents }`

### POST /v1/driver/me/documents
Body: `{ docType: DocType, fileUrl, expiresAt? }` Response: 201 `{ document }` (via `submitDriverDocument`).

**Payouts** (Phase 4 §5)

### GET /v1/driver/me/payouts
Response: `{ payouts }` (up to 50).

### POST /v1/driver/me/payouts
Body: `{ amount: number>0, method: PaymentMethod }` Response: 201 `{ payout }`

### POST /v1/driver/me/payouts/:id/cancel
Response: `{ payout }`

**Incentives**

### GET /v1/driver/me/incentives
Response: driver incentive-campaign progress summary (`getDriverIncentiveSummary`).

---

## 5. Vehicles

There is no standalone `/v1/vehicles` router. Vehicles are created inline
during `POST /v1/auth/register/driver` (one vehicle per new driver account)
and thereafter managed/read only through:

- **Admin directory**: `GET /v1/admin/vehicles` (see §14.2) — search/filter
  across all vehicles, with driver + vehicleType included.
- **Admin verification**: vehicle `status` flips `pending → active` as a
  side effect of `POST /v1/admin/drivers/:id/verify` approving the driver.
- **Vehicle documents**: submitted via the driver document endpoints above
  (`docType` includes `vehicle_registration`, `insurance`, `route_permit`)
  and reviewed via `POST /v1/admin/driver-documents/:id/review`; vehicle
  document *expiry* is surfaced in `GET /v1/admin/drivers/document-expiry-queue`.
- **Vehicle types (catalog)**: public read at `GET /v1/public/vehicle-types`;
  admin CRUD at `GET|POST /v1/admin/vehicle-types`, `PATCH /v1/admin/vehicle-types/:id`,
  and per-city enablement at `PUT /v1/admin/cities/:cityId/vehicle-types/:vehicleTypeId`
  (see §14.5).

---

## 6. Ride Requests, Offers, Counter-Offers & Rides — `/v1` (bare mount)

All routes in this section are on `ridesRouter`, mounted at bare `/v1` —
i.e. paths below are the *full* path, not appended to a prefix. Router-level:
`requireAuth` (individual routes add `requireRole` as noted).

### POST /v1/fare-estimates
Auth: Bearer, passenger role.
Body: `{ cityId, zoneId?, vehicleTypeId, pickup: {lat,lng}, destination: {lat,lng} }`
Response: `{ route, fare }` — no `RideRequest` row is created; this is preview-only.
Errors: 400 `INVALID_VEHICLE_TYPE`.

### POST /v1/ride-requests
Auth: Bearer, passenger role. Rate-limited (`rideRequestRateLimit`: 15 / 5 min).
Body: `{ cityId, zoneId?, vehicleTypeId, pickup: {address,lat,lng}, destination: {address,lat,lng}, bookingMode: "quick_match"|"competitive_offer", proposedFare?, paymentMethod?: PaymentMethod = "cash", preferFavoriteDriver?, promoCode?, businessAccountId? }`
Response: 201, shape returned by `createRideRequest(...)` (request + fare + dispatch info).
Errors: 400 validation; 403 if `businessAccountId` given but caller isn't a member; 429 rate limited.

### GET /v1/ride-requests/:id
Auth: Bearer (passenger who owns it, driver who has/had an offer on it, or admin).
Response: `{ request }` (with pickup/destination/vehicleType/passenger/ride). Errors: 403/404.

### DELETE /v1/ride-requests/:id
Auth: Bearer, passenger role (owner only).
Response: result of `cancelRideRequest(...)`.

### GET /v1/ride-requests/:id/offers
Auth: Bearer, passenger role (owner only).
Response: `{ request: { id, status, proposedFare, suggestedFare }, statusMessage, pendingCount, respondedCount, offers: [{ id, status, offerPrice, etaMin, distanceKm, expiresAt, driver: {...}, vehicle: {...}, counterOffer }] }` — the live negotiation view (pending + accepted offers, with any pending counter-offer attached).

### POST /v1/ride-requests/:id/select-offer
Auth: Bearer, passenger role. Body: `{ offerId }`
Response: 201 `{ ride }` — via `selectOffer(...)`, creates the `Ride`.

**Driver responses to offers** — all `requireRole("driver")`, rate-limited via `offerActionRateLimit` (admin-configurable window/limit).

### POST /v1/ride-offers/:id/accept
Response: result of `driverAcceptOffer(...)`.

### POST /v1/ride-offers/:id/counter
Body: `{ counterPrice: number>0 }` Response: 201 `{ counterOffer }`.

### POST /v1/ride-offers/:id/decline
Response: result of `driverDeclineOffer(...)`.

**Passenger responses to counter-offers** — all `requireRole("passenger")`, `offerActionRateLimit`.

### POST /v1/counter-offers/:id/accept
Response: 201 `{ ride }` (via `passengerAcceptCounterOffer`).

### POST /v1/counter-offers/:id/reject
Response: result of `passengerRejectCounterOffer(...)`.

**Rides**

### GET /v1/rides?status=&from=&to=&page=&pageSize=
Auth: Bearer. Scoped to the caller's own rides (passenger/driver) or all rides for admin.
Response: `{ rides, total, page, pageSize }` (pageSize capped 100, default 20).

### GET /v1/rides/:id
Auth: Bearer, must be a party to the ride (or admin).
Response: `{ ride }` — full detail incl. payment/commission and statusHistory.

### POST /v1/rides/:id/status
Auth: Bearer, passenger or driver (must be a party).
Body: `{ target: RideStatus, reason? }` Response: `{ ride }` — via `updateRideStatus(...)`, which enforces the `RIDE_STATUS_TRANSITIONS` state machine.

### POST /v1/rides/:id/disputes
Auth: Bearer, passenger or driver, must be a party.
Body: `{ reason, evidence?: string[] (max 10) }` Response: 201 `{ dispute }`. Emits `dispute.filed` on the ride's socket room.

### GET /v1/rides/:id/disputes
Auth: Bearer, must be a party. Response: `{ disputes }`.

### POST /v1/rides/:id/ratings
Auth: Bearer, passenger or driver.
Body: `{ score: 1-5, comment? }` Response: 201 `{ rating }` (via `submitRating`).

### GET /v1/rides/:id/messages
Auth: Bearer, must be a party. Response: `{ messages }` (ride chat, ascending order).

### POST /v1/rides/:id/messages
Auth: Bearer, must be a party. Rate-limited (`chatRateLimit`, admin-configurable).
Body: `{ body: string (1-1000 chars) }` Response: 201 `{ message }`. Emits `chat.message` on the ride's socket room and a `ride_update` notification to the counterpart.

---

## 7. Payments / Wallet

There's no single `/v1/payments` router — payment/wallet functionality is
spread across the role routers plus one unauthenticated webhook surface:

- **Passenger wallet**: `GET/POST /v1/passenger/wallet*` (§4).
- **Driver payouts**: `GET/POST /v1/driver/me/payouts*` (§4).
- **Business account spend policy** (`maxRideAmount`, allowed vehicle
  types/zones): `/v1/business/accounts/:id/policy` (§8).
- **Admin finance**: `GET /v1/admin/payments`, `/commissions`, `/payouts*`,
  `/webhooks`, `/payments/:providerReference/provider-status` (§14.3).
- **Payment provider webhooks** (unauthenticated, signature-verified):
  `POST /v1/public/webhooks/:provider` (§13).

---

## 8. Business Accounts — `/v1/business`

Router-level: `requireAuth`. Every route additionally requires the caller be
a `BusinessEmployee` of the `:id` account (`requireMembership`); mutating
routes further require `role: "owner"|"admin"` on that membership
(`requireManager`). This is *self-service* for business employees — the
platform-admin-side management (create account, add employee, force-update
policy) is the separate `/v1/admin/business-accounts*` surface in §14.9.

### GET /v1/business/accounts
Auth: Bearer. Response: `{ accounts: [{ role, ...businessAccount }] }` — every account the caller belongs to, with their role in each.

### GET /v1/business/accounts/:id/dashboard
Auth: Bearer, member. Response: `{ totalRides, completedRides, totalSpendingRs, employeeBreakdown: [{userId,name,rideCount,spendingRs}], rides: [...] }` (last 100 rides for the account).

### GET /v1/business/accounts/:id/employees
Auth: Bearer, member. Response: `{ employees }`.

### GET /v1/business/accounts/:id/policy
Auth: Bearer, member. Response: `{ policy: {maxRideAmount?, allowedVehicleTypeIds?, allowedZoneIds?}, monthlySpendLimit }`.

### PUT /v1/business/accounts/:id/policy
Auth: Bearer, owner|admin member. Body: `{ maxRideAmount?, allowedVehicleTypeIds?, allowedZoneIds? }` Response: `{ policy }`.

### POST /v1/business/accounts/:id/employees
Auth: Bearer, owner|admin member. Body: `{ userId, role: "admin"|"member" = "member" }` Response: 201 `{ employee }`. Errors: 403 if a non-owner tries to grant `admin`.

### DELETE /v1/business/accounts/:id/employees/:userId
Auth: Bearer, owner|admin member. Response: 204. Errors: 400 `CANNOT_REMOVE_OWNER`; 403 if a non-owner removes an admin.

---

## 9. Support — `/v1/support`

Router-level: `requireAuth`. Any authenticated user (passenger or driver)
manages only their own tickets; admin-side triage lives in
`/v1/admin/support-tickets*` (§14.4).

### POST /v1/support/tickets
Body: `{ category: SupportCategory, subject, description?, rideId?, attachments?: string[] (max 10) }`
Response: 201 `{ ticket }` (author-safe projection, no `internalNotes`). `priority` auto-set to `high` for category `safety`, else `medium`. Errors: 404/403 if `rideId` given but caller isn't a party to that ride.

### GET /v1/support/tickets
Response: `{ tickets }` — the caller's own, newest first.

### GET /v1/support/tickets/:id
Response: `{ ticket }` (incl. `ride`, `messages`). Errors: 404 if not owned by caller.

### POST /v1/support/tickets/:id/messages
Rate-limited (`chatRateLimit`). Body: `{ body: string (1-2000 chars) }`
Response: 201 `{ message }`. Errors: 404 if not owner; 400 `TICKET_CLOSED`. Reopens a `resolved` ticket to `waiting`.

---

## 10. Notifications — `/v1/notifications`

Router-level: `requireAuth`.

### GET /v1/notifications?unreadOnly=true
Response: `{ notifications, unreadCount }` (up to 50).

### POST /v1/notifications/:id/read
Response: `{ notification }`. Errors: 404 if not owned by caller.

### POST /v1/notifications/read-all
Response: `{ ok: true }`.

---

## 11. Safety — `/v1/safety` (+ one public route)

`safetyRouter` (mounted `/v1/safety`): `requireAuth` on all routes.
`publicSafetyRouter` (mounted separately at `/v1/public`, see app.ts) holds
one unauthenticated route for trusted contacts.

### POST /v1/safety/sos
Body: `{ rideId?, lat, lng, note? }`
Response: 201 `{ safetyEvent, message }` — creates a `critical` `SafetyEvent` and pages the admin safety queue via socket (`safety.sos_triggered`). Explicitly **does not** contact emergency services — the response message says so.

### POST /v1/safety/report
Body: `{ rideId, againstUserId, reason, evidence?: string[] (max 10) }`
Response: 201 `{ dispute, safetyEvent }` — creates both a `Dispute` and a `medium`-severity `SafetyEvent` in one transaction. Errors: 404 ride not found; 403 if caller isn't a party.

### GET /v1/safety/blocks
Response: `{ blocks }` (the caller's blocked users, via `listBlocks`).

### POST /v1/safety/blocks/:userId
Body: `{ reason? }` Response: 201 `{ block }` (via `blockUser`).

### DELETE /v1/safety/blocks/:userId
Response: 204 (via `unblockUser`).

### POST /v1/safety/share-trip/:rideId
Response: `{ shareToken, shareUrl }`. Errors: 404/403 if caller isn't a party. Also logs a `low`-severity `trip_shared` `SafetyEvent`.

### GET /v1/public/trip/:shareToken
Auth: **none** — a trusted contact opening a shared-trip link has no RIVO account.
Response: `{ status, pickup: {address,lat,lng}, destination: {address,lat,lng}, driver: {name, vehicle, plate} }`. Errors: 404 `"This trip link is invalid or has expired."`.

---

## 12. Public (no-auth) — `/v1/public`

`publicRouter`, mounted `/v1/public`; no auth on any of these.

### GET /v1/public/cities
Response: `{ cities: [{id,name,status,currencyCode}] }` — only `live`/`launching` cities.

### GET /v1/public/vehicle-types?cityId=
Response: `{ vehicleTypes: [{id,code,name,capacity}] }` — active types, optionally filtered to those enabled for a city.

### GET /v1/public/content?type=&cityId=
Response: `{ items }` — active marketing CMS items (banners/FAQ/announcements), optionally filtered by `type` and city (city-null items always included).

### POST /v1/public/waitlist
Rate-limited (`publicFormRateLimit`: 10/hour).
Body: `{ fullName, contact, cityName, userType: "passenger"|"driver", marketingConsent = false }`
Response: 201 `{ id }`.

---

## 13. Public webhooks — `/v1/public/webhooks`

`webhooksRouter`, mounted `/v1/public/webhooks`; no JWT auth (a payment
provider can't send our tokens) but every event is durably recorded and
deduplicated by a `(provider, eventId)` unique constraint, and signature-
verified when the provider adapter supports it.

### POST /v1/public/webhooks/:provider
Body: `{ eventId, eventType: "payment.captured"|"payment.failed"|"refund.completed"|"payout.completed"|"payout.failed", providerReference, amountRs? }`
Header: `X-RIVO-Webhook-Signature` (checked against the raw request body when the provider supports it).
Response: always `200 { ok: true }` (with `ignored`/`duplicate` flags as applicable) — deliberately never a 5xx on processing failure, since a provider retry can't fix an application-level failure; failures are recorded to `WebhookEvent` and paged to admins (`webhook.processing_failed`) instead.
Errors: 401 `Invalid webhook signature.` if signature verification fails for a provider that supports it.

---

## 14. Admin — `/v1/admin`

Router-level (`admin/router.ts`): every admin route first requires
`requireAuth, requireRole("admin")`. Routes below additionally list an
**Admin:** scope only where the handler adds `requireAdminRole(...)`; where
none is listed, any signed-in admin (any `adminRole`) can call it — this
includes almost every GET/list endpoint. `super_admin` always passes any
`requireAdminRole` check.

### 14.1 Dashboard / Analytics

**Live operations** (`admin/dashboard.ts`):

#### GET /v1/admin/dashboard/kpis?cityId=
Admin (any). Response: real-time platform KPIs — `totalPassengers, activePassengers, totalDrivers, onlineDrivers, ridesRequestedToday, completedToday, cancelledToday, activeRides, grossBookingValueRs, platformRevenueRs, driverEarningsRs, avgFareRs, avgDurationMin, driverCancellationRatePct, passengerCancellationRatePct, repeatPassengerRatePct, pendingDriverVerifications`. All computed live from Prisma aggregates — no placeholder numbers.

#### GET /v1/admin/live-map?cityId=
Admin (any). Response: `{ drivers: [{id,status,lat,lng,lastLocationAt,locationStale}], activeRides, pendingRequestsCount, staleDriverCount }`.

#### GET /v1/admin/demand-map?cityId=&gridSize=&range=
Admin (any). `cityId` required (400 `CITY_REQUIRED` if missing). Response: a coarse demand grid (`gridSize` 2-10) over the city's active area — `{ cells: [{row,col,centerLat,centerLng,onlineDrivers,openRequests,demandRatio,cancellationRatePct,flags:{highDemand,lowSupply,highCancellation}}], gridSize, range, bounds }`. `range` ∈ `lastHour|today|yesterday|last7days`. Read-only visibility; never a second pricing path.

#### GET /v1/admin/live-ops/summary?cityId=&vehicleTypeId=&sinceHours=
Admin (any). Response: `{ windowHours, activeRides, pendingRequests, onlineDrivers, staleLocationDrivers, cancellationsInWindow, openSafetyIncidents, openDisputes, openSupportTickets, quickActions }`.

#### GET /v1/admin/supply/dashboard?cityId=
Admin (any). Response: `{ onlineDrivers, availableDrivers, busyDrivers, offlineDrivers, staleGpsDrivers, driversAwaitingVerification, openRequestsCount, alerts: string[] }` — plain-language supply alerts computed from real positions/requests.

**Analytics** (`admin/analytics.ts`):

#### GET /v1/admin/analytics/passengers?cityId=
Admin (any). Response: passenger activation/retention aggregates.

#### GET /v1/admin/analytics/drivers?cityId=
Admin (any). Response: driver activation/acceptance/cancellation/payout aggregates.

#### GET /v1/admin/analytics/marketplace?cityId=
Admin (any). Response: GBV, platform revenue, take rate, completion/cancellation rates, breakdowns by booking mode and payment method.

#### GET /v1/admin/analytics/acquisition?cityId=&spendRs=
Admin (any). Response: `{ bySource, byCampaign, spendRsSupplied }` — signup/first-ride/repeat/retention rates grouped by self-reported `acquisitionSource`/`acquisitionCampaign`; `cpaRs` is only computed when the caller supplies `spendRs` (never fabricated).

#### GET /v1/admin/analytics/cohorts?role=passenger|driver&weeks=
Admin (any). Response: `{ role, cohorts: [{week,registered,firstRideRatePct,returned7dPct,returned30dPct}] }` — weekly registration cohorts, up to 26 weeks back.

#### GET /v1/admin/analytics/executive?from=&to=&cityId=&vehicleTypeId=&paymentMethod=
Admin (any). Response: one-screen platform health — GBV, revenue, completion/cancellation rate, avg fare, avg driver ETA, active passengers/drivers, repeat rate, driver retention, supply/demand ratio, support tickets, refunds. Defaults to the trailing 30 days.

#### GET /v1/admin/analytics/unit-economics?from=&to=&cityId=&vehicleTypeId=&paymentMethod=
Admin (any). Response: per-ride revenue/cost breakdown, each figure labeled `basis: "actual"` or `"estimate"` — only payment-processing cost is an estimate (`finance.estimatedPaymentProcessingFeePct` setting), everything else is a real aggregate.

### 14.2 Directory (`admin/directory.ts`) — read-only lookups, Admin (any)

All support `page`/`pageSize` (capped 100) pagination; response shape is `{ <resource>, total, page, pageSize }`.

- `GET /v1/admin/passengers?search=&status=` — users with `role: passenger`.
- `GET /v1/admin/drivers?search=&status=&verificationStatus=&cityId=`
- `GET /v1/admin/vehicles?search=&status=&vehicleTypeId=`
- `GET /v1/admin/ride-requests?status=&cityId=&from=&to=`
- `GET /v1/admin/ride-requests/:id/offers` — full offer/counter-offer history for one request.
- `GET /v1/admin/rides?status=&cityId=&from=&to=&search=`
- `GET /v1/admin/ratings` — all ratings, paginated.

### 14.3 Verification (`admin/verification.ts`)

#### GET /v1/admin/drivers/verification-queue
Admin (any). Response: `{ drivers }` — all `verificationStatus: "pending"` drivers with vehicles/documents.

#### POST /v1/admin/drivers/:id/verify
Admin: `super_admin|ops_manager|safety_officer`.
Body: `{ decision: "approve"|"reject", reason? }`
Response: `{ driverProfile }`. On approve: flips driver + their pending vehicles to `active`/`approved`, notifies the driver (in-app + SMS). Audit-logged as `driver.verify.approve|reject`.

#### GET /v1/admin/drivers/document-expiry-queue
Admin (any). Response: `{ driverDocuments, vehicleDocuments }` — docs expiring within `verification.documentExpiryWarningDays`.

#### POST /v1/admin/driver-documents/:id/review
Admin: `super_admin|ops_manager|safety_officer`.
Body: `{ decision: "approve"|"reject", reason? }` Response: `{ document }`.

### 14.4 Finance (`admin/finance.ts`)

- `GET /v1/admin/payments?status=` — Admin (any). Paginated.
- `GET /v1/admin/commissions` — Admin (any). Paginated, incl. `totalCommissionRs`.
- `GET /v1/admin/payouts?status=` — Admin (any). Paginated.
- `POST /v1/admin/payouts/:id/processing` — Admin: `super_admin|finance`.
- `POST /v1/admin/payouts/:id/complete` — Admin: `super_admin|finance`. Body: `{ reference }`. Only ever marks `completed` on explicit admin attestation or webhook confirmation, never automatically.
- `POST /v1/admin/payouts/:id/fail` — Admin: `super_admin|finance`. Body: `{ notes? }`.
- `GET /v1/admin/webhooks?status=&provider=` — Admin (any). Reconciliation view of every inbound `WebhookEvent`.
- `GET /v1/admin/payments/:providerReference/provider-status` — Admin (any). Asks the payment provider adapter directly for status (`checkStatus`+`transactionLookup`), separate from the local DB record.

Also **Trust/Disputes → refund actions** live under §14.5 below and touch
Payment/Transaction rows, but are gated by `admin/trust.ts`, listed there.

### 14.5 Trust — Disputes, Support Tickets, Safety Events (`admin/trust.ts`)

**Disputes**

- `GET /v1/admin/disputes?status=` — Admin (any). Paginated.
- `POST /v1/admin/disputes/:id/request-info` — Admin: `super_admin|ops_manager|finance`. Body `{ message }`.
- `POST /v1/admin/disputes/:id/refund` — Admin: `super_admin|ops_manager|finance`. Body `{ amountRs?, resolution }`.
- `POST /v1/admin/disputes/:id/adjust` — Admin: `super_admin|ops_manager|finance`. Body `{ amountRs, resolution }` (adjusts driver payout).
- `POST /v1/admin/disputes/:id/close` — Admin: `super_admin|ops_manager|finance`. Body `{ resolution, status: "closed"|"rejected" = "closed" }`.

Each of the four actions is audit-logged separately (`dispute.request_info`, `dispute.refund`, `dispute.adjust`, `dispute.closed`/`dispute.rejected`).

**Support tickets** (admin side; passenger/driver side is §9)

- `GET /v1/admin/support-tickets?status=&priority=` — Admin (any). Paginated.
- `GET /v1/admin/support-tickets/:id` — Admin (any). Full thread incl. messages.
- `PATCH /v1/admin/support-tickets/:id` — Admin: `super_admin|ops_manager|support_agent`. Body: `{ status?, priority?, assignToSelf?, assignedAdminId?, internalNotes?, dueAt? }`.
- `POST /v1/admin/support-tickets/:id/messages` — Admin: `super_admin|ops_manager|support_agent`. Body `{ body }`; auto-flips ticket from `open` to `in_progress`.

**Safety events**

- `GET /v1/admin/safety-events?severity=&resolved=&assignedAdminId=` — Admin (any). Paginated.
- `PATCH /v1/admin/safety-events/:id` — Admin: `super_admin|ops_manager|safety_officer`. Body: `{ assignToSelf?, assignedAdminId?, notes? }`.
- `POST /v1/admin/safety-events/:id/resolve` — Admin: `super_admin|ops_manager|safety_officer`. Body `{ notes? }`.

### 14.6 Config (`admin/config.ts`)

**Cities & zones**

- `GET /v1/admin/cities` — Admin (any).
- `POST /v1/admin/cities` — Admin: `super_admin|ops_manager`. Body: `{ countryId, name, status="planned", currencyCode, timezone, centerLat?, centerLng? }`.
- `PATCH /v1/admin/cities/:id` — Admin: `super_admin|ops_manager`. Body: `{ status?, name?, operatingHours?, paymentMethods?: PaymentMethod[]|null, driverRequirements?: {minAge?,minLicenseYears?,requiredDocs?}|null }`.
- `GET /v1/admin/vehicle-types` — Admin (any).
- `POST /v1/admin/vehicle-types` — Admin: `super_admin|ops_manager`. Body `{ code, name, capacity=4, sortOrder=0 }`. Errors: 409 `VEHICLE_TYPE_EXISTS`.
- `PATCH /v1/admin/vehicle-types/:id` — Admin: `super_admin|ops_manager`.
- `PUT /v1/admin/cities/:cityId/vehicle-types/:vehicleTypeId` — Admin: `super_admin|ops_manager`. Body `{ isActive }` — per-city enable/disable.
- `GET /v1/admin/service-zones?cityId=` — Admin (any).
- `POST /v1/admin/service-zones` — Admin: `super_admin|ops_manager`. Body `{ cityId, name, boundaryGeoJson }`.

**Pricing**

- `GET /v1/admin/pricing/fare-rules?cityId=` — Admin (any). Only active rules.
- `POST /v1/admin/pricing/fare-rules` — Admin: `super_admin|ops_manager|finance`. Body: `{ cityId, zoneId?, vehicleTypeId, baseFare, perKmRate, perMinRate, minimumFare, maximumFare?, commissionRate (0-1), surgeMinMultiplier=1, surgeMaxMultiplier=2.5 }`.
- `PUT /v1/admin/pricing/fare-rules/:id` — Admin: `super_admin|ops_manager|finance`. Partial body of the same shape.

**Platform settings**

- `GET /v1/admin/settings` — Admin (any). Response `{ settings, defaults }`.
- `PUT /v1/admin/settings/:key` — Admin: `super_admin` only. Body: `{ value: number|number[]|boolean|string|string[], description? }`. Errors: 400 `UNKNOWN_SETTING` if `key` isn't a recognized `PlatformSettingsShape` key. This is the single endpoint that tunes the admin-configurable rate limiters, matching-radius, staleness thresholds, etc.

**Promotions**

- `GET /v1/admin/promotions` — Admin (any).
- `POST /v1/admin/promotions` — Admin: `super_admin|ops_manager|finance`. Body: `{ code, description?, campaignType?, discountType: "percentage"|"flat", discountValue, maxDiscount?, minFare?, cityId?, vehicleTypeId?, newUsersOnly=false, usageLimit?, startsAt?, expiresAt? }`. Errors: 409 `PROMO_CODE_EXISTS`.
- `PUT /v1/admin/promotions/:id` — Admin: `super_admin|ops_manager|finance`. Partial body + `isActive?`.

**Driver incentive campaigns**

- `GET /v1/admin/incentive-campaigns` — Admin (any).
- `POST /v1/admin/incentive-campaigns` — Admin: `super_admin|ops_manager|finance`. Body: `{ name, description?, cityId?, vehicleTypeId?, targetRideCount, rewardAmount, startDate, endDate }`. Errors: 400 `INVALID_DATE_RANGE`.
- `PUT /v1/admin/incentive-campaigns/:id` — Admin: `super_admin|ops_manager|finance`. Partial body + `status?: "draft"|"active"|"ended"`.

### 14.7 System (`admin/system.ts`)

#### GET /v1/admin/observability
Admin (any). Response: `observabilitySnapshot()` — live request-latency percentiles + failure counters (Phase 4 §23).

#### GET /v1/admin/audit-logs?targetTable=&adminId=
Admin (any). Paginated `{ logs, total, page, pageSize }`.

#### GET /v1/admin/admin-users
Admin: `super_admin` only. Response: `{ admins }`.

#### POST /v1/admin/admin-users
Admin: `super_admin` only. Body: `{ fullName, phone, email, password, role: AdminRole, cityScope? }`
Response: 201 `{ user }`.
(Previously this route's own zod enum for `role` was a hand-copied literal list that had drifted out of sync with the shared `AdminRole` type and silently rejected `city_admin`/`marketing`. Fixed to validate against `z.enum(AdminRole)` directly so it can't drift again.)

### 14.8 Risk (`admin/risk.ts`)

Fraud/abuse manual-review queue — every signal here only ever surfaces a
user for human review; nothing is auto-actioned.

#### GET /v1/admin/risk/queue?minScore=&page=&pageSize=
Admin: `super_admin|ops_manager|safety_officer|finance|read_only`. Response: `{ queue, total, page, pageSize }`.

#### GET /v1/admin/risk/users/:userId
Admin: `super_admin|ops_manager|safety_officer|finance|read_only`. Response: `{ user, score, events }`.

#### POST /v1/admin/risk/events/:id/review
Admin: `super_admin|ops_manager|safety_officer`. Body `{ note? }`. Marks the `RiskEvent` reviewed and recomputes the user's score.

#### PATCH /v1/admin/users/:id/status
Admin: `super_admin|ops_manager|safety_officer`. Body: `{ status: "active"|"suspended"|"banned", reason }`. The one place a human can actually act on a risk-flagged user; always audit-logged with before/after status + reason.

### 14.9 Business (`admin/business.ts`) — platform-admin side of business accounts

- `GET /v1/admin/business-accounts` — Admin (any).
- `POST /v1/admin/business-accounts` — Admin: `super_admin|ops_manager|finance`. Body: `{ companyName, billingContactUserId, cityId, paymentMethod=wallet, monthlySpendLimit? }` — creates the account and its `owner` employee row in one call.
- `PATCH /v1/admin/business-accounts/:id` — Admin: `super_admin|ops_manager|finance`. Body: `{ isActive?, monthlySpendLimit?, ridePolicy?: {maxRideAmount?,allowedVehicleTypeIds?,allowedZoneIds?} }`.
- `POST /v1/admin/business-accounts/:id/employees` — Admin: `super_admin|ops_manager|finance`. Body: `{ userId, role: "owner"|"admin"|"member" = "member" }`.

### 14.10 Marketing / CMS (`admin/marketing.ts`)

**Content items** (public-read via `GET /v1/public/content`)

- `GET /v1/admin/content?type=` — Admin (any).
- `POST /v1/admin/content` — Admin: `super_admin|marketing|ops_manager`. Body: `{ type: one of homepage_banner|promotion_banner|faq|help_article|announcement|app_message|city_launch_campaign, title, body, cityId?, isActive=true, sortOrder=0 }`.
- `PUT /v1/admin/content/:id` — Admin: `super_admin|marketing|ops_manager`. Partial body.
- `DELETE /v1/admin/content/:id` — Admin: `super_admin|marketing|ops_manager`. 204.

**Waitlist roster** (public write via `POST /v1/public/waitlist`)

- `GET /v1/admin/waitlist?cityName=&userType=` — Admin (any).
- `GET /v1/admin/waitlist/export` — Admin: `super_admin|marketing|ops_manager`. Returns `text/csv` with `Content-Disposition: attachment; filename=waitlist.csv`.
- `DELETE /v1/admin/waitlist/:id` — Admin: `super_admin|marketing|ops_manager`. 204.

### 14.11 Privacy (`admin/privacy.ts`)

#### GET /v1/admin/privacy/deletion-requests
Admin (any). Response: `{ requests }` — users with a pending `deletionRequestedAt` and no `deletedAt`.

#### POST /v1/admin/privacy/deletion-requests/:userId/complete
Admin: `super_admin|ops_manager`. Anonymizes the `User` row's PII (name → "Deleted User", phone → placeholder, email/photo/passwordHash nulled, `status: suspended`, `deletedAt` set) and revokes all active refresh tokens. Ride/Payment/Transaction rows are never touched — they stay intact under the now-anonymous user id.
Errors: 400 `NO_DELETION_REQUEST`, 400 `ALREADY_DELETED`.

#### POST /v1/admin/privacy/deletion-requests/:userId/dismiss
Admin: `super_admin|ops_manager`. Clears the pending request without deleting anything. Errors: 400 `NO_DELETION_REQUEST`.

### 14.12 Pilot Mode (`admin/pilotMode.ts`)

A controlled-launch gate limiting driver/passenger supply for one city,
optionally invitation-only.

#### GET /v1/admin/pilot-mode
Admin (any). Response: `{ settings: {enabled,cityId,maxDriverCount,maxPassengerCount,requireInvitationCode}, current: {driverCount,passengerCount} }`.

#### PUT /v1/admin/pilot-mode
Admin: `super_admin|ops_manager`. Body: any subset of `{ enabled?, cityId?, maxDriverCount?, maxPassengerCount?, requireInvitationCode? }`. Enforced at registration time by `enforcePilotModeForRegistration` (see `POST /v1/auth/register/*`).

**Invitation codes** (also the "beta user list" mechanism — one single-use code per approved person)

- `GET /v1/admin/invitation-codes` — Admin (any). Up to 500, newest first.
- `POST /v1/admin/invitation-codes` — Admin: `super_admin|ops_manager`. Body: `{ code, maxUses?, cityId?, expiresAt? }`. Errors: 409 `CODE_EXISTS`.
- `PATCH /v1/admin/invitation-codes/:id` — Admin: `super_admin|ops_manager`. Body: `{ isActive?, maxUses? }`.

### 14.13 Notification Templates (`admin/notificationTemplates.ts`)

Lets an admin change notification wording (or add a locale) without a
redeploy; any key/locale pair not overridden here falls back to the in-code
default in `services/notifications/templates.ts`.

#### GET /v1/admin/notification-templates
Admin (any). Response: `{ templates, availableKeys }` (the in-code default key list).

#### PUT /v1/admin/notification-templates
Admin: `super_admin|ops_manager|marketing`. Body: `{ key, locale, title, body }` — upserts by `(key, locale)`. Response: 201 `{ template }`.

#### DELETE /v1/admin/notification-templates/:id
Admin: `super_admin|ops_manager|marketing`. 204. Errors: 404 if not found.

---

## Appendix: rate limiters in play

From `backend/src/middleware/rateLimit.ts` — fixed limiters apply the same
cap to everyone; admin-configurable ones read their cap live from
`PlatformSetting` (tunable via `PUT /v1/admin/settings/:key`, §14.6) while
the time window is fixed at process start.

| Limiter | Scope | Default | Configurable? |
|---|---|---|---|
| `generalRateLimit` | every request (app-level) | 300 / 60s | no |
| `authRateLimit` | all of `/v1/auth/*` | 20 / 15min | no |
| `rideRequestRateLimit` | `POST /v1/ride-requests` | 15 / 5min | no |
| `publicFormRateLimit` | `POST /v1/public/waitlist` | 10 / hour | no |
| `offerActionRateLimit` | offer/counter-offer accept/counter/decline/reject | via `rateLimit.offerAction.limit` | yes |
| `chatRateLimit` | ride messages, support ticket messages | via `rateLimit.chat.limit` | yes |
| `referralRateLimit` | `POST /v1/account/referral/apply` | via `rateLimit.referral.limit` | yes |
| `promoRedemptionRateLimit` | `POST /v1/passenger/promo/validate` | via `rateLimit.promoRedemption.limit` | yes |
| `paymentRateLimit` | `POST /v1/passenger/wallet/topup` | via `rateLimit.payment.limit` | yes |

Rate limiting is disabled entirely when `NODE_ENV=test`.
