# RIVO — Phase 1 Documentation Index

**RIVO** — *"Your Ride. Your Price. Your Choice."*

A ride-hailing marketplace connecting passengers with nearby drivers, supporting both
instant matching and price negotiation, architected for multi-city and multi-country
expansion from a single-city launch.

This directory contains the Phase 1 product and technical architecture deliverables.
No backend exists yet — the `apps/web` package implements the four required UI
surfaces (Landing, Customer Home, Driver Home, Admin Dashboard) against realistic
static mock data (`apps/web/src/data/mock.ts`), so nothing here pretends to be a live
integration.

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
| 08 | [Database Schema](./08-database-schema.sql) | Full relational schema (PostgreSQL dialect) |
| 09 | [API Architecture](./09-api-architecture.md) | Service boundaries, REST/event contracts, versioning |
| 10 | [Project Structure](./10-project-structure.md) | Repository/folder layout for the full, multi-app system |
| 11 | [Design System](./11-design-system.md) | Brand, logo concept, color system, typography, components, states |

## Phase 1 scope

Per the product brief, Phase 1 delivers architecture + the following functional
screens only: **Landing page, Customer Home, Driver Home, Admin Dashboard**. The
remaining 90+ screens listed in the feature map are specified (flows, data, states)
but not yet built — they are Phase 2+ work.

Run the app:

```bash
cd apps/web
npm install
npm run dev
```
