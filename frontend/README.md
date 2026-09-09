# RIVO — apps/web

Phase 1 implementation: a single Vite + React + TypeScript + Tailwind app
covering the four required screens against static, realistic mock data
(`src/data/mock.ts`) — no live backend.

See [`../../docs/README.md`](../../docs/README.md) for the full architecture.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Structure

- `src/pages/Landing.tsx` — marketing landing page
- `src/pages/CustomerHome.tsx` — map-first passenger home (Quick Match + Set Your Price)
- `src/pages/DriverHome.tsx` — driver map home with incoming request / accept / counter / decline
- `src/pages/AdminDashboard.tsx` — operations dashboard with full section nav
- `src/components/ui/` — shared primitives (Button, Card, Badge, MapCanvas)
- `src/data/mock.ts` — demo data
