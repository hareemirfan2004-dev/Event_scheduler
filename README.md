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
- Everyone crosses out the days (or morning/afternoon/evening slots)
  they **can't** make. Saath ranks the dates where everyone — or the
  most people — are free, and shows a green heatmap of the whole window.

The name is Urdu (ساتھ, "together"). To rename the app, search for
"Saath" — it appears only in `app/layout.tsx` metadata, the landing
page, the two page headers, and the localStorage key prefix in
`lib/client/identity.ts`.

## Stack

Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Prisma 7 with
driver adapters — SQLite locally, Postgres (Neon) in production —
deployed on Vercel. No auth service; membership is a per-group token.

## Local development

```bash
cp .env.example .env       # keeps the default SQLite URL
npm install                # also runs prisma generate
npx prisma migrate dev     # creates prisma/dev.db
npm run dev                # http://localhost:3000
```

Run the tests (matching engine, calendar math, API routes):

```bash
npm test
```

## Deploying (free tier: GitHub + Vercel + Neon)

One-time setup, roughly 15 minutes:

1. **Create accounts** (all free): [github.com](https://github.com),
   [vercel.com](https://vercel.com) (sign in with GitHub),
   [neon.tech](https://neon.tech).

2. **Neon**: create a project (e.g. `saath`). Copy the **pooled**
   connection string (the hostname contains `-pooler`).

3. **Switch the schema to Postgres** (local SQLite migrations don't
   apply to Postgres, so regenerate them once against Neon):

   ```bash
   # in prisma/schema.prisma change:  provider = "sqlite"  →  "postgresql"
   rm -r prisma/migrations
   # put the Neon connection string in .env as DATABASE_URL, then:
   npx prisma migrate dev --name init
   npm run dev   # sanity-check the app now runs against Neon
   git add -A && git commit -m "switch to postgres for production"
   ```

   (`lib/db.ts` picks the right driver adapter from the URL scheme
   automatically.)

4. **Push to GitHub**:

   ```bash
   gh repo create saath --private --source . --push
   # or create the repo on github.com and: git remote add origin <url> && git push -u origin main
   ```

5. **Vercel**: *Add New Project* → import the repo → add environment
   variable `DATABASE_URL` = the Neon pooled string → Deploy. The build
   runs `prisma generate && prisma migrate deploy && next build`, so the
   database schema is applied automatically.

6. Open `https://<project>.vercel.app`, create your group, and share
   the invite link.

After the switch, local `npm run dev` also talks to Postgres; create a
second (free) Neon database or branch if you want dev data separate
from the family's real data.

## How matching works

Only *busy* entries are stored; unmarked time is free. A member counts
once they've saved at least once (so "hasn't answered" ≠ "free all
month"). For an event needing N days, every N-day window in the range
is scored by how many responded members have no busy day inside it;
ties go to the earliest date. Slot events score each date+slot combo
the same way. See `lib/matching.ts` and `tests/matching.test.ts`.

## License

Copyright (c) 2026 Hareem Irfan. All rights reserved.

This is proprietary software — see [LICENSE](LICENSE). No permission is
granted to use, copy, modify, or distribute this software without prior
written consent.
