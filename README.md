# Zarghoon Jewellers

> **Zarghoon AI core** — the database-backed business backend (products, CRM,
> conversations, follow-ups, human handoff, approvals, audit) lives in
> [`core/`](core/README.md) as a separate TypeScript package. See
> [`core/docs/crm.md`](core/docs/crm.md).

Public website for Zarghoon Jewellers with customer registration/login and an
admin panel for managing the product catalogue.

## Features

- **Public homepage** — hero, trust badges, collections and featured pieces.
- **Customer registration & login** — full name, username, password, date of
  birth, anniversary date (optional) and mobile number. New customers are
  signed in automatically after registering and land on a personal dashboard
  (with birthday/anniversary greetings and the latest arrivals).
- **Admin login** — an admin account created from `ADMIN_USERNAME` /
  `ADMIN_PASSWORD` (see "Admin account" below). There are no default credentials.
- **Zarghoon AI chat** — a floating AI sales assistant on every page, backed
  by the Zarghoon AI core (see "Zarghoon AI website chat" below).
- **Admin product management** — add products with net weight, wastage %,
  an auto-calculated gross weight (`net weight + wastage% of net weight`),
  quality (purity), category, and multiple images. Products can be listed
  and deleted from the admin panel.

## Tech stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma ORM + PostgreSQL
- Vercel Blob for product image storage
- Auth.js / NextAuth v5 (credentials login, JWT sessions)
- react-hook-form + zod for form validation

## Getting started

You need a PostgreSQL database (e.g. a free [Neon](https://neon.tech) or
Vercel Postgres instance) and a [Vercel Blob](https://vercel.com/docs/storage/vercel-blob)
read/write token, even for local development.

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, AUTH_SECRET, BLOB_READ_WRITE_TOKEN
npm run db:migrate     # applies the schema to your Postgres database
ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run db:seed   # optional: creates the admin account
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- `AUTH_SECRET` must be kept private and set to a unique random value in
  production (`openssl rand -base64 32`).
- `BLOB_READ_WRITE_TOKEN` is auto-injected by Vercel once a Blob store is
  connected to the project; set it manually for local development.

## Admin account

There are no default credentials. Create the admin account explicitly:

```bash
ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run db:seed
```

`ADMIN_PASSWORD` must be at least 12 characters, with letters and numbers.
The seed never prints passwords and never changes an existing account unless
`ADMIN_ROTATE_PASSWORD=true` is set. Sign-in with a previously published
password is refused by the app; rotate any such account before deploying.
When self-hosting outside Vercel, set `AUTH_TRUST_HOST=true` (or `AUTH_URL`)
for Auth.js.

## Zarghoon AI website chat

A floating **Zarghoon AI** chat (gold gem button, bottom-right) answers
customers with the Zarghoon AI Sales Agent from [`core/`](core/README.md).

It uses verified product data, deterministic lead scoring and human
handoff. In development it runs in **demo mode** on an in-memory database of
`DEMO-` products, and uses Claude when `ANTHROPIC_API_KEY` is set (otherwise
a labelled offline stand-in). It is off by default in production. See
[`core/docs/website-chat.md`](core/docs/website-chat.md).

```bash
npm run dev          # builds core, starts the site with the demo chat
npm run test:e2e     # Playwright end-to-end tests (desktop + mobile)
```

