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
- Prisma ORM + SQLite (`prisma/dev.db`)
- Auth.js / NextAuth v5 (credentials login, JWT sessions)
- react-hook-form + zod for form validation

## Getting started

```bash
npm install
cp .env.example .env   # then set a random AUTH_SECRET
npm run db:migrate     # creates the SQLite DB and applies the schema
npm run db:seed        # seeds the admin account (admin / admin123@)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Uploaded product images are stored under `public/uploads/products`. This
  works well for a traditional Node.js deployment (VM, container) but will
  **not** persist on serverless/ephemeral filesystems (e.g. Vercel) — swap
  in a cloud storage provider (S3, Cloudinary, etc.) for that kind of
  deployment.
- `AUTH_SECRET` in `.env` must be kept private and set to a unique random
  value in production (`openssl rand -base64 32`).
