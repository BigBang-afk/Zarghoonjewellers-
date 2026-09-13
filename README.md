# Zarghoon Jewellers

Public website for Zarghoon Jewellers with customer registration/login and an
admin panel for managing the product catalogue.

## Features

- **Public homepage** — hero, trust badges, collections and featured pieces.
- **Customer registration & login** — full name, username, password, date of
  birth, anniversary date (optional) and mobile number. New customers are
  signed in automatically after registering and land on a personal dashboard
  (with birthday/anniversary greetings and the latest arrivals).
- **Admin login** — pre-seeded account, username `admin`, password
  `admin123@`.
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
npm run db:seed        # seeds the admin account (admin / admin123@)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- `AUTH_SECRET` must be kept private and set to a unique random value in
  production (`openssl rand -base64 32`).
- `BLOB_READ_WRITE_TOKEN` is auto-injected by Vercel once a Blob store is
  connected to the project; set it manually for local development.
