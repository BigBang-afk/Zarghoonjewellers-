# 10 — Project Structure

## Target layout (full system, multi-phase)

RIVO is architected as a monorepo so shared types/design tokens stay in sync
across passenger, driver, and admin surfaces while backend services scale
independently.

```
rivo/
├── apps/
│   ├── customer-mobile/        # React Native — passenger app (36 screens)
│   ├── driver-mobile/          # React Native — driver app (30 screens)
│   ├── admin-web/              # React + Vite — ops dashboard (this repo's apps/web, Phase 1)
│   └── marketing-web/          # Landing page + SEO content (this repo's apps/web, Phase 1)
│
├── services/                   # Backend, one deployable per bounded context
│   ├── identity-service/       # auth, OTP, sessions, RBAC
│   ├── ride-service/           # ride requests, offers, rides, status
│   ├── matching-engine/        # Quick Match scoring & dispatch
│   ├── negotiation-engine/     # Competitive Offer state machine, timers
│   ├── fare-engine/            # fare computation, admin-configurable rules
│   ├── location-service/       # driver location ingest, geo-index
│   ├── payment-service/        # PaymentProvider adapters, capture/refund
│   ├── wallet-service/         # wallet balances, ledgered transactions
│   ├── notification-service/   # push/SMS/email fan-out
│   ├── safety-service/         # SOS, trip sharing, safety events
│   ├── risk-service/           # fraud/risk scoring pipeline
│   ├── admin-service/          # admin-only aggregate queries, audit logging
│   └── realtime-gateway/       # WebSocket fan-out, channel authorization
│
├── packages/                   # shared libraries, versioned independently
│   ├── design-tokens/          # colors, type scale, spacing — source of truth for Tailwind config + RN theme
│   ├── ui-web/                 # shared React components (Button, Card, MapCanvas, ...)
│   ├── ui-native/               # shared React Native components
│   ├── api-client/              # generated typed client from the OpenAPI/AsyncAPI specs
│   ├── domain-types/             # shared TS types: RideRequest, DriverOffer, FareRule, ...
│   └── config/                   # eslint/tsconfig/tailwind base configs
│
├── infra/
│   ├── terraform/               # cloud infra as code (per environment)
│   ├── migrations/               # SQL migrations (source of truth is docs/08-database-schema.sql initially)
│   └── ci/                       # pipeline definitions
│
├── docs/                        # ← this directory: product & technical architecture
│   ├── 01-product-architecture.md
│   ├── 02-feature-map.md
│   ├── 03-customer-journey.md
│   ├── 04-driver-journey.md
│   ├── 05-admin-journey.md
│   ├── 06-technical-architecture.md
│   ├── 07-database-erd.md
│   ├── 08-database-schema.sql
│   ├── 09-api-architecture.md
│   ├── 10-project-structure.md
│   └── 11-design-system.md
│
└── README.md
```

## Actual layout (Phase 1 + Phase 2, what exists in this repo today)

Phase 1 intentionally did not stand up the full monorepo above — that would
have been premature structure for four static screens. Phase 2 introduced a
real `/backend`, and renamed `apps/web` to `/frontend` per the requested
`/frontend /backend` top-level split — still one deployable per side rather
than the fully split `apps/*` + `services/*` + `packages/*` target above,
since a single Express app and a single Vite app are still the right size
for what's built so far.

```
Zarghoonjewellers-/
├── docs/                        # all architecture + Phase 2 completion report
├── backend/                     # Node.js + TypeScript + Express + Prisma + Socket.IO
│   ├── prisma/
│   │   ├── schema.prisma        # implements docs/08's entity model (+ auth support tables)
│   │   ├── migrations/
│   │   └── seed.ts              # demo data — see docs/12 §9 for test accounts
│   ├── src/
│   │   ├── api/                 # routers, one folder per domain
│   │   │   ├── auth/  passenger/  driver/  rides/  admin/  safety/  notifications/  public/
│   │   ├── services/             # business logic — see docs/12 §1 for the full list
│   │   │   ├── maps/  payments/  notifications/  otp/
│   │   │   ├── fareEngine.ts  matchingEngine.ts  negotiationEngine.ts
│   │   │   ├── bookingService.ts  rideLifecycleService.ts  ratingService.ts
│   │   │   └── rideRequestService.ts
│   │   ├── middleware/           # auth, validate, errorHandler, rateLimit
│   │   ├── realtime/socket.ts    # Socket.IO gateway
│   │   ├── config/               # env.ts, settings.ts (admin-configurable values)
│   │   ├── types/enums.ts
│   │   ├── shared/  utils/
│   │   ├── app.ts  server.ts
│   │   └── ...
│   └── tests/                    # Vitest + Supertest, real ephemeral DB
├── frontend/                     # Vite + React + TypeScript + Tailwind
│   └── src/
│       ├── api/                  # typed client per domain (auth, rides, driver, admin, ...)
│       ├── auth/                 # AuthContext, ProtectedRoute, tokenStore
│       ├── services/socket.ts    # Socket.IO client
│       ├── components/ui/        # Button, Card, Badge, MapCanvas, Input, States
│       ├── pages/
│       │   ├── auth/  passenger/  driver/  admin/
│       │   └── Landing.tsx
│       ├── shared/  types/  config/
│       └── App.tsx               # router + auth/toast providers
└── README.md
```

`frontend` plays the role of `marketing-web` + a single-screen-per-role
preview of `customer-mobile`, `driver-mobile`, and `admin-web` — one
deployable, routes for `/`, `/login`, `/register/*`, `/app`, `/driver`,
`/admin`. `backend` plays the role of every `services/*` box in the target
layout, collapsed into one deployable (a modular monolith, exactly as
[06 — Technical Architecture](./06-technical-architecture.md) §1 anticipated:
"services are logically separated... but Phase 1/2 can ship as a modular
monolith... splitting into physically separate services is a scaling
decision, not a day-one requirement").

## Why not fully split into the target layout yet

Splitting `backend/src/services/*` into physically separate deployables, or
`frontend` into three React Native/web apps, would be premature: there's
one traffic pattern and one team-of-one so far, and the service boundaries
inside `backend/src/services/` are already drawn along the lines the target
layout names (`fareEngine`, `matchingEngine`, `negotiationEngine`, `maps/`,
`payments/`, `notifications/`) — so the split, when warranted, is a lift-and
-shift of existing modules rather than a redesign.
