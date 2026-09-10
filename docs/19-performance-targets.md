# 19 — Performance Targets

These are **targets to design and instrument against**, not benchmarks
that have been measured under real load. No load test has been run
against this system. Anything presented as an achieved number below is
explicitly labeled as such (a handful of dev-machine timings, useful as
a sanity check, not as a capacity claim); everything else is a stated
goal with the instrumentation now in place to actually measure it once
real traffic exists.

## 1. Why targets, not benchmarks

A pilot launch into one city with a capped driver/passenger count
(`docs/` Pilot Mode, Phase 4 §37) will never produce the load profile a
benchmark needs to mean anything. Claiming "handles 10,000 req/s" from a
system that has never seen more than a seed script's worth of traffic
would be exactly the kind of fabricated confidence this project's
approach has consistently avoided. What follows instead: reasonable
targets for an MVP pilot, and the real instrumentation
(`docs/13`-era observability work) that will tell you the truth once
traffic exists.

## 2. API latency targets

| Endpoint class | Target (p95) | Why |
|---|---|---|
| Simple reads (GET profile, GET wallet, GET notifications) | < 200ms | No cross-service calls, single indexed query |
| Ride-request creation (`POST /v1/ride-requests`) | < 800ms | Involves fare computation, promo validation, business-policy checks, and a dispatch attempt in the same request — the heaviest write path in the app |
| Admin analytics/dashboard endpoints | < 1.5s | Multi-aggregate queries over ranges; acceptable to be slower than user-facing paths, but should never make an admin wait more than a couple of seconds |
| Webhook processing | < 500ms | Provider redelivers on timeout — staying fast avoids needless redelivery load |

**How to actually check these against reality**: `GET /v1/admin/observability`
(built in the Phase 4 observability work) reports live p50/p95/p99
request-latency percentiles and a per-category failure count
(`api_errors`, `db_errors`, `payment_errors`, `notification_failures`,
`location_failures`, `matching_failures`) — sourced from every real
request the running process has served, not a synthetic test. Once
there's real traffic, that endpoint is the source of truth for whether
these targets are being met, and needs no new code to check.

## 3. Reliability targets

| | Target |
|---|---|
| API uptime (`GET /health`) | 99.5% for a single-instance pilot deployment (no HA yet — see `docs/15-production-configuration.md` §6 on what multi-instance would take) |
| `GET /ready` false-positive rate | 0 — it does a real `SELECT 1` against the database, not a hardcoded 200 |
| Background job failure visibility | 100% — every job in `backend/src/jobs/` runs through the shared registry (`jobs/registry.ts`), which logs every failure with a stack trace; nothing fails silently |

## 4. Matching / dispatch targets

| | Target |
|---|---|
| Quick Match: request → first driver offer sent | < 5s from request creation, assuming at least one eligible driver exists within the configured search radius (`matching.initialRadiusKm`) |
| Competitive Offer: request → all eligible drivers notified | < 10s for up to `matching.competitiveOfferMaxDrivers` drivers |
| Dispatch hop-cap (Phase 4 §7) | ≤ `matching.maxDispatchHops` (default 5) driver attempts before giving up and telling the passenger honestly rather than hanging indefinitely |

These aren't independently measured yet either, but they're testable
today with real data: `matching_failures` in the observability snapshot
increments exactly on a `no_drivers` outcome or hop-cap hit
(`services/rideRequestService.ts`), so the failure rate against these
targets is already counted, not something that needs new instrumentation
to check later.

## 5. Basic instrumentation already in place (not "to build later")

- **Structured request logs** — one JSON line per HTTP request
  (`middleware/requestLogging.ts`), including method, path, status,
  duration, and the authenticated user id when present. Feeds any log
  aggregator without a translation step.
- **Correlation ids** — every request gets a `req.id`, echoed as
  `X-Request-Id` and reused in error responses, so a user's bug report
  and the corresponding server log line can be matched.
- **Failure-category counters** — the six categories named in §2, each
  incrementing from a real code path (dispatch giving up, a webhook
  signature failing, a poor-GPS-accuracy location update, an external
  notification-provider exception), not a placeholder metric that's
  never actually wired to anything.
- **Redaction by default** — the structured logger strips
  passwords/tokens/OTP codes/card fields from any logged object before
  serialization (`utils/logger.ts`), so instrumentation can be added
  liberally without a second pass to check for leaked secrets.

## 6. What real load testing would need to validate these

Not done here, listed honestly as the next step: a tool like k6 or
Artillery driving realistic traffic (a ride-request rate, a mix of
Quick Match / Competitive Offer, concurrent driver location updates)
against a staging environment provisioned like production (real
Postgres, not the SQLite dev database), reading the results off
`GET /v1/admin/observability` and the database's own query-performance
tooling. That's Phase 5 (or later pilot-hardening) scope, not something
a documentation pass can substitute for.
