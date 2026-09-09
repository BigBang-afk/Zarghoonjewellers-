# RIVO — Documentation Index

**RIVO** — *"Your Ride. Your Price. Your Choice."*

A ride-hailing marketplace connecting passengers with nearby drivers, supporting both
instant matching and price negotiation, architected for multi-city and multi-country
expansion from a single-city launch.

Phase 1 delivered the architecture and four static UI screens. **Phase 2 delivered a
real, working backend** (`/backend` — Node/TypeScript/Express/Prisma/Socket.IO) and
wired the frontend (`/frontend`, renamed from `apps/web`) to it end-to-end — see
[12 — Phase 2 Completion Report](./12-phase-2-completion-report.md) for exactly what's
real, what's mocked, and how to run it.

## Contents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Product Architecture](./01-product-architecture.md) | Marketplace model, booking modes, vehicle types, multi-city design |
| 02 | [Feature Map](./02-feature-map.md) | Full screen inventory for Customer, Driver, and Admin surfaces |
| 03 | [Customer Journey](./03-customer-journey.md) | End-to-end passenger flow, screen by screen |
| 04 | [Driver Journey](./04-driver-journey.md) | End-to-end driver flow, screen by screen |
| 05 | [Admin Journey](./05-admin-journey.md) | Operations team workflows across the dashboard |
| 06 | [Technical Architecture](./06-technical-architecture.md) | Services, real-time system, matching/negotiation/fare engines, security, payments, safety |
| 07 | [Database ERD](./07-database-erd.md) | Entity-relationship diagram (Mermaid) |
| 08 | [Database Schema](./08-database-schema.sql) | Full relational schema (PostgreSQL dialect) — canonical production schema |
| 09 | [API Architecture](./09-api-architecture.md) | Service boundaries, REST/event contracts, versioning |
| 10 | [Project Structure](./10-project-structure.md) | Repository/folder layout for the full, multi-app system |
| 11 | [Design System](./11-design-system.md) | Brand, logo concept, color system, typography, components, states |
| 12 | [Phase 2 Completion Report](./12-phase-2-completion-report.md) | What was built, how to run it, real vs. mocked, known limitations |

## Phase 1 scope (architecture + 4 static screens)

Product/technical architecture + **Landing page, Customer Home, Driver Home, Admin
Dashboard** built against static mock data, no backend.

## Phase 2 scope (functional MVP)

A real backend (auth, database, Fare/Matching/Negotiation engines, ride lifecycle,
payments/wallet, admin APIs, real-time via Socket.IO) implementing the Phase 1 schema,
with the frontend rewired to call it — the core **passenger → ride request → driver →
offer → passenger selection → ride → payment → rating** workflow works end-to-end
against real data. Full detail, limitations, and what still needs production
credentials: [12 — Phase 2 Completion Report](./12-phase-2-completion-report.md).

## Run it

```bash
# Backend
cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev
```

Test accounts and full run instructions: see the completion report, §5–9.
