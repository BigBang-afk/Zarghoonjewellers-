# RIVO

**Your Ride. Your Price. Your Choice.**

RIVO is a ride-hailing marketplace connecting passengers with nearby drivers,
supporting both instant matching (**Quick Match**) and price negotiation
(**Competitive Offer**) on the same live pool of drivers — architected for a
single-city launch that scales to multiple cities and countries.

**Phase 1** delivered the product/technical architecture, database design, API
design, design system, and four static screens. **Phase 2** delivered a real,
working backend and wired the frontend to it — the core passenger → ride
request → driver → offer → selection → ride → payment → rating workflow works
end-to-end against a real database. See
[`docs/12-phase-2-completion-report.md`](./docs/12-phase-2-completion-report.md)
for exactly what's real, what's mocked, and full run instructions.

## Start here

- [`docs/README.md`](./docs/README.md) — full documentation index.
- [`docs/12-phase-2-completion-report.md`](./docs/12-phase-2-completion-report.md) — what was built, how to run it, test accounts, known limitations.
- [`backend`](./backend) — Node.js + TypeScript + Express + Prisma + Socket.IO API.
- [`frontend`](./frontend) — Vite + React + TypeScript + Tailwind app (renamed from `apps/web`).

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

Open the printed frontend URL. The "Phase 2 preview" switcher at the top lets
you jump between **Landing**, **Customer App**, **Driver App**, and **Admin
Dashboard** — each is now backed by real auth and real data. Test accounts
are listed in the completion report (§9); the seed script also prints them.
