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

## Phase 1 actual layout (what exists in this repo today)

Phase 1 intentionally does **not** stand up the full monorepo above — that
would be premature structure for four static screens. Instead:

```
Zarghoonjewellers-/
├── docs/                        # all 11 architecture documents (this set)
└── apps/
    └── web/                     # single Vite + React + TypeScript + Tailwind app
        ├── src/
        │   ├── components/
        │   │   ├── ui/           # Button, Card, Badge, MapCanvas (shared primitives)
        │   │   ├── Logo.tsx
        │   │   └── VehicleIcon.tsx
        │   ├── data/
        │   │   └── mock.ts       # realistic static demo data — no live backend
        │   ├── pages/
        │   │   ├── Landing.tsx
        │   │   ├── CustomerHome.tsx
        │   │   ├── DriverHome.tsx
        │   │   └── AdminDashboard.tsx
        │   ├── App.tsx            # router + Phase 1 preview switcher
        │   ├── main.tsx
        │   └── index.css          # design tokens (Tailwind v4 @theme)
        ├── index.html
        ├── package.json
        └── vite.config.ts
```

`apps/web` plays the role of `marketing-web` + a single-screen preview of
`customer-mobile`, `driver-mobile`, and `admin-web` — one deployable, four
routes (`/`, `/app`, `/driver`, `/admin`), sharing one component library and
one token set. When Phase 2 splits the customer/driver experiences into
dedicated React Native apps, `src/components/ui` and `src/data` graduate into
the `packages/ui-web` (or `ui-native`) and `packages/domain-types` shown
above with minimal rework, since they were already written as
framework-agnostic-in-spirit, prop-driven components against typed mock data
shaped like the real API responses in
[09 — API Architecture](./09-api-architecture.md).

## Why not scaffold the full monorepo now

Standing up 13 empty service directories and 5 empty packages with no code
in them would be structure without substance — it doesn't help build the
four required screens and would need to be re-shaped once real service
boundaries are proven. The target layout above is the destination, recorded
now so Phase 2+ work lands in the right place from the start.
