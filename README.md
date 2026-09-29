# Saath — find the day everyone's free

A small web app for groups (built for one big family) that answers one
question: **when can we all actually meet?**

- Create a group once, share the invite link on WhatsApp.
- Members join by typing their name — no passwords. The browser
  remembers them; rejoining with the same name from a new device asks
  "is that you?" and restores the same identity.
- Inside a group you create events ("Summer trip", "Eid dinner"). Each
  event has a date window and, for trips, how many days in a row you
  need.
- Everyone taps the days (or morning/afternoon/evening slots) they
  **can** make; anything left unmarked counts as busy. Saath ranks the
  dates where everyone — or the most people — are free, and shows a
  green heatmap of the whole window.

The name is Urdu (ساتھ, "together"). To rename the app, search for
"Saath" — it appears only in `app/layout.tsx` metadata, the landing
page, the two page headers, and the localStorage key prefix in
`lib/client/identity.ts`.

## Stack

Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Prisma 7 with the
Postgres driver adapter (`@prisma/adapter-pg`) against Neon, deployed on
Vercel. Postgres is used everywhere, including local development and
tests. No auth service; membership is a per-group token.

## Local development

You need a Postgres database. The free Neon tier works: create a
project, then a separate **branch** (e.g. `dev`) so local data never
touches the production data.

```bash
cp .env.example .env       # then set DATABASE_URL to your dev branch's pooled string
npm install                # also runs prisma generate
npx prisma migrate deploy  # applies the committed migrations
npm run dev                # http://localhost:3000
```

Run the tests (matching engine, calendar math, API routes):

```bash
npm test
```

The API and DB tests read `DATABASE_URL` from `.env` and write real
rows, so point it at the dev branch, never at production.

## Deploying (free tier: GitHub + Vercel + Neon)

One-time setup, roughly 15 minutes:

1. **Create accounts** (all free): [github.com](https://github.com),
   [vercel.com](https://vercel.com) (sign in with GitHub),
   [neon.tech](https://neon.tech).

2. **Neon**: create a project (e.g. `saath`). Copy the **pooled**
   connection string (the hostname contains `-pooler`).

3. **Push to GitHub**:

   ```bash
   gh repo create saath --private --source . --push
   # or create the repo on github.com and: git remote add origin <url> && git push -u origin main
   ```

4. **Vercel**: *Add New Project* → import the repo → add environment
   variable `DATABASE_URL` = the Neon pooled string → Deploy. The build
   runs `prisma generate && prisma migrate deploy && next build`, so the
   committed migrations in `prisma/migrations/` are applied automatically.
   Never delete that folder: it is the schema history of the live
   database.

5. Open `https://<project>.vercel.app`, create your group, and share
   the invite link.

## How matching works

Only *free* entries are stored; unmarked time is busy. A member counts
once they've saved at least once, even with nothing marked (so "hasn't
answered" ≠ "can't make any date"). For an event needing N days, every
N-day window in the range is scored by how many responded members are
free on every day inside it; ties go to the earliest date. Slot events
score each date+slot combo the same way, where marking a whole day free
covers all three slots. See `lib/matching.ts` and
`tests/matching.test.ts`.

## License

Copyright (c) 2026 Hareem Irfan. All rights reserved.

This is proprietary software — see [LICENSE](LICENSE). No permission is
granted to use, copy, modify, or distribute this software without prior
written consent.
