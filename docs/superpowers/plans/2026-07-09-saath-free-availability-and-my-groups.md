# Saath — Free-availability, Easier Selection & "My Groups" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip Saath's availability model from "cross out busy days" to "pick free days," make multi-day selection easy (sticky range mode + presets), and add a "My groups" home hub so members aren't trapped in one group.

**Architecture:** Store *free* time instead of *busy* time (`BusyEntry` → `AvailabilityEntry`), inverting the matching engine while keeping its result shapes so `results-view` is untouched. Extract all selection and group-list logic into **pure, unit-tested helpers**; keep React components thin (verified by running the app). A single hand-edited Prisma migration creates the new table, inverts existing rows, and drops the old one atomically.

**Tech Stack:** Next.js 16.2 (App Router, async params), React 19, TypeScript, Prisma 7.8 + `@prisma/adapter-pg` (Neon Postgres), Tailwind CSS 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-saath-free-availability-and-my-groups-design.md`

## Global Constraints

- **This is NOT stock Next.js.** Before editing any route/page/proxy code, read the relevant guide under `node_modules/next/dist/docs/` (per `AGENTS.md`). Route params are async: `await ctx.params` in handlers, `use(params)` in client pages.
- **Prisma 7, not 6.** The datasource `url` lives in `prisma.config.ts`, never in `schema.prisma`. Driver adapter is mandatory. **After any schema change:** `npx prisma generate`, delete `.next`, restart dev — otherwise the generated client in `lib/generated/prisma` embeds the old shape and throws.
- **DB is Postgres-only** (`lib/db.ts` throws if `DATABASE_URL` unset). Tests + local dev hit the Neon **dev** branch (`.env`, gitignored); prod is the Neon **main** branch (Vercel env vars). Never commit `.env`.
- **Tests:** Vitest against the remote Neon dev branch (~50s); baseline is 27 passing. Keep them green; adapt counts.
- **Dates** are `"YYYY-MM-DD"` strings throughout (no `Date` columns). Slots: `"ALL" | "MORNING" | "AFTERNOON" | "EVENING"`; in the free model `slot = "ALL"` means **free the whole day**.
- **Model name:** `AvailabilityEntry` (each row = a day/slot a member is FREE). **Free-day visual:** solid green fill, white number (`bg-leaf border-leaf-deep text-white`). The hand-drawn `PenCircle` stays reserved for the winning date in results only.
- **Design tokens** (Tailwind `@theme` in `app/globals.css`): `paper`, `ink`, `ink-soft`, `hairline`, `card`, `strike`, `strike-wash`, `leaf`, `leaf-deep`, `leaf-wash`.
- **Never run `npm audit fix --force`** (downgrades Next 16→9, Prisma 7→6).
- Work on branch `feat/free-availability-and-my-groups` (already created). Commit after every task.

---

## Phase A — Free-model foundation (data, matching, API)

### Task A1: Invert the matching engine to free semantics

**Files:**
- Modify: `lib/matching.ts`
- Test: `tests/matching.test.ts` (rewrite existing cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MatchInput.freeEntries: FreeEntryInput[]` (was `busyEntries: BusyEntryInput[]`); type `FreeEntryInput = { memberId: string; date: string; slot: Slot }`. `computeMatches(input)` returns the **same** `MatchResults` shape as today (`windows`, `slots`, `heatmap`, `respondedCount`, `totalMembers`, `pendingMemberIds`). Semantics: a responded member is *available* for a window iff **every** day in it is in their free set; SLOT free iff a `date|slot` **or** `date|ALL` free row exists; `heatmap.freeCount` = responded members with ≥1 free row that day.

- [ ] **Step 1: Rewrite the tests for free semantics**

Replace the busy-oriented cases in `tests/matching.test.ts`. Key cases (use this structure; keep existing helper style):

```ts
import { describe, it, expect } from "vitest";
import { computeMatches, type MatchInput } from "@/lib/matching";

const base: Omit<MatchInput, "freeEntries" | "respondedMemberIds"> = {
  mode: "DAY",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-05",
  durationDays: 1,
  members: [
    { id: "a", name: "Ali" },
    { id: "b", name: "Bina" },
  ],
};

describe("computeMatches — DAY, free model", () => {
  it("counts a member available only on days they marked free", () => {
    const r = computeMatches({
      ...base,
      respondedMemberIds: ["a", "b"],
      freeEntries: [
        { memberId: "a", date: "2026-08-01", slot: "ALL" },
        { memberId: "a", date: "2026-08-02", slot: "ALL" },
        { memberId: "b", date: "2026-08-02", slot: "ALL" },
      ],
    });
    const day2 = r.windows.find((w) => w.startDate === "2026-08-02")!;
    expect(day2.score).toBe(2);
    expect(day2.availableMemberIds.sort()).toEqual(["a", "b"]);
    const day1 = r.windows.find((w) => w.startDate === "2026-08-01")!;
    expect(day1.score).toBe(1);
    expect(day1.unavailableMemberIds).toEqual(["b"]);
    // Day with no free rows scores 0.
    expect(r.windows.find((w) => w.startDate === "2026-08-05")!.score).toBe(0);
  });

  it("requires ALL days of a multi-day window to be free", () => {
    const r = computeMatches({
      ...base,
      durationDays: 2,
      respondedMemberIds: ["a"],
      freeEntries: [
        { memberId: "a", date: "2026-08-01", slot: "ALL" },
        { memberId: "a", date: "2026-08-02", slot: "ALL" },
        // gap on 03
        { memberId: "a", date: "2026-08-04", slot: "ALL" },
      ],
    });
    expect(r.windows.find((w) => w.startDate === "2026-08-01")!.score).toBe(1); // 01–02 free
    expect(r.windows.find((w) => w.startDate === "2026-08-02")!.score).toBe(0); // 02–03, 03 not free
    expect(r.windows.find((w) => w.startDate === "2026-08-03")!.score).toBe(0); // 03–04, 03 not free
  });

  it("ranks by score then earliest start", () => {
    const r = computeMatches({
      ...base,
      respondedMemberIds: ["a", "b"],
      freeEntries: [
        { memberId: "a", date: "2026-08-03", slot: "ALL" },
        { memberId: "b", date: "2026-08-03", slot: "ALL" },
        { memberId: "a", date: "2026-08-01", slot: "ALL" },
        { memberId: "b", date: "2026-08-01", slot: "ALL" },
      ],
    });
    expect(r.windows[0].startDate).toBe("2026-08-01"); // tie 2/2 → earliest
  });

  it("empty free set = responded but free nowhere", () => {
    const r = computeMatches({
      ...base,
      respondedMemberIds: ["a"],
      freeEntries: [],
    });
    expect(r.respondedCount).toBe(1);
    expect(r.pendingMemberIds).toEqual(["b"]);
    expect(r.windows.every((w) => w.score === 0)).toBe(true);
  });

  it("heatmap counts responded members free each day", () => {
    const r = computeMatches({
      ...base,
      respondedMemberIds: ["a", "b"],
      freeEntries: [
        { memberId: "a", date: "2026-08-02", slot: "ALL" },
        { memberId: "b", date: "2026-08-02", slot: "ALL" },
        { memberId: "a", date: "2026-08-03", slot: "ALL" },
      ],
    });
    expect(r.heatmap.find((h) => h.date === "2026-08-02")!.freeCount).toBe(2);
    expect(r.heatmap.find((h) => h.date === "2026-08-03")!.freeCount).toBe(1);
    expect(r.heatmap.find((h) => h.date === "2026-08-01")!.freeCount).toBe(0);
  });
});

describe("computeMatches — SLOT, free model", () => {
  const slotBase = { ...base, mode: "SLOT" as const };
  it("member free for a slot via explicit slot or ALL", () => {
    const r = computeMatches({
      ...slotBase,
      respondedMemberIds: ["a", "b"],
      freeEntries: [
        { memberId: "a", date: "2026-08-01", slot: "MORNING" },
        { memberId: "b", date: "2026-08-01", slot: "ALL" }, // free all slots that day
      ],
    });
    const m = r.slots.find((s) => s.date === "2026-08-01" && s.slot === "MORNING")!;
    expect(m.score).toBe(2);
    const e = r.slots.find((s) => s.date === "2026-08-01" && s.slot === "EVENING")!;
    expect(e.score).toBe(1); // only b (via ALL)
    expect(e.availableMemberIds).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npm test -- matching`
Expected: FAIL (old impl still reads `busyEntries` / busy semantics).

- [ ] **Step 3: Rewrite `lib/matching.ts` to free semantics**

Change the input type and the three computations. Concretely:

Rename the interface and field:
```ts
export interface FreeEntryInput {
  memberId: string;
  date: string; // YYYY-MM-DD
  slot: Slot;
}

export interface MatchInput {
  mode: EventMode;
  windowStart: string;
  windowEnd: string;
  durationDays: number;
  members: MemberRef[];
  respondedMemberIds: string[];
  freeEntries: FreeEntryInput[];
}
```

In `computeMatches`, build free maps and invert the membership tests:
```ts
// memberId -> set of "YYYY-MM-DD" they marked free (any slot counts for DAY).
const freeDates = new Map<string, Set<string>>();
// memberId -> set of "date|slot" free keys (ALL frees the whole day).
const freeSlots = new Map<string, Set<string>>();
for (const e of input.freeEntries) {
  let d = freeDates.get(e.memberId);
  if (!d) { d = new Set(); freeDates.set(e.memberId, d); }
  d.add(e.date);
  let s = freeSlots.get(e.memberId);
  if (!s) { s = new Set(); freeSlots.set(e.memberId, s); }
  s.add(`${e.date}|${e.slot}`);
}
```

DAY window loop — available iff every window day is free:
```ts
for (const m of responded) {
  const free = freeDates.get(m.id);
  const allFree = free != null && windowDays.every((d) => free.has(d));
  if (allFree) available.push(m.id);
  else unavailable.push(m.id);
}
```

SLOT loop — free iff `date|slot` or `date|ALL`:
```ts
for (const m of responded) {
  const free = freeSlots.get(m.id);
  const isFree = free != null && (free.has(`${day}|${slot}`) || free.has(`${day}|ALL`));
  if (isFree) available.push(m.id);
  else unavailable.push(m.id);
}
```

Heatmap — members with a free row that day:
```ts
const heatmap: HeatmapDay[] = days.map((day) => ({
  date: day,
  freeCount: responded.filter((m) => freeDates.get(m.id)?.has(day)).length,
}));
```

Delete the old `BusyEntryInput`, the `busyDates`/`busySlots` builders, and the `!busy...` checks. Keep `eachDay`, sorting, `respondedCount`, `totalMembers`, `pendingMemberIds` as-is.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npm test -- matching`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/matching.ts tests/matching.test.ts
git commit -m "feat(matching): invert to free-availability semantics"
```

---

### Task A2: Schema rename + inverting migration + client regen

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_availability_free/migration.sql` (hand-edited)
- Regenerate: `lib/generated/prisma/**` (via `prisma generate`, gitignored)

**Interfaces:**
- Produces: Prisma model `AvailabilityEntry` with relations `Member.availability` and `Event.availability`; each row = a free `(date, slot)`. `BusyEntry` no longer exists.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Rename the model and both relations; update comments:
```prisma
model Member {
  // ...unchanged fields...
  responses    Response[]
  availability AvailabilityEntry[]

  @@unique([groupId, name])
}

model Event {
  // ...unchanged fields...
  responses    Response[]
  availability AvailabilityEntry[]
}

// A member has "responded" once they save, even if they marked nothing free
// (= they can't make any of these dates).
model Response { /* unchanged */ }

// Only FREE time is stored; a member is free on a day/slot iff a row exists.
model AvailabilityEntry {
  id       String @id @default(cuid())
  eventId  String
  event    Event  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  memberId String
  member   Member @relation(fields: [memberId], references: [id], onDelete: Cascade)
  date     String // YYYY-MM-DD
  slot     String @default("ALL") // "ALL" (free whole day) | "MORNING" | "AFTERNOON" | "EVENING"

  @@unique([eventId, memberId, date, slot])
  @@index([eventId])
}
```

- [ ] **Step 2: Generate the migration WITHOUT applying it**

Run: `npx prisma migrate dev --name availability_free --create-only`
Expected: a new `prisma/migrations/<ts>_availability_free/migration.sql` containing `DROP TABLE "BusyEntry"` and `CREATE TABLE "AvailabilityEntry"` (Prisma treats the rename as drop+create).

- [ ] **Step 3: Hand-edit the migration to CREATE → invert → DROP (atomic, no data loss)**

Reorder/replace the file so the new table is created, existing busy rows are inverted into free rows, and only then is the old table dropped. Full file:

```sql
-- Create the new free-availability table first.
CREATE TABLE "AvailabilityEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'ALL',
    CONSTRAINT "AvailabilityEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilityEntry_eventId_idx" ON "AvailabilityEntry"("eventId");
CREATE UNIQUE INDEX "AvailabilityEntry_eventId_memberId_date_slot_key"
    ON "AvailabilityEntry"("eventId", "memberId", "date", "slot");
ALTER TABLE "AvailabilityEntry" ADD CONSTRAINT "AvailabilityEntry_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityEntry" ADD CONSTRAINT "AvailabilityEntry_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invert existing data: a responded member is free on every in-window day/slot
-- they were NOT busy on. DAY events -> one 'ALL' row per free day.
INSERT INTO "AvailabilityEntry" ("id", "eventId", "memberId", "date", "slot")
SELECT gen_random_uuid()::text, e."id", r."memberId", to_char(d, 'YYYY-MM-DD'), 'ALL'
FROM "Event" e
JOIN "Response" r ON r."eventId" = e."id"
CROSS JOIN generate_series(e."windowStart"::date, e."windowEnd"::date, interval '1 day') AS d
WHERE e."mode" = 'DAY'
  AND NOT EXISTS (
    SELECT 1 FROM "BusyEntry" b
    WHERE b."eventId" = e."id" AND b."memberId" = r."memberId"
      AND b."date" = to_char(d, 'YYYY-MM-DD')
  );

-- SLOT events -> one row per free (day, slot); a busy 'ALL' or matching slot blocks it.
INSERT INTO "AvailabilityEntry" ("id", "eventId", "memberId", "date", "slot")
SELECT gen_random_uuid()::text, e."id", r."memberId", to_char(d, 'YYYY-MM-DD'), s.slot
FROM "Event" e
JOIN "Response" r ON r."eventId" = e."id"
CROSS JOIN generate_series(e."windowStart"::date, e."windowEnd"::date, interval '1 day') AS d
CROSS JOIN (VALUES ('MORNING'), ('AFTERNOON'), ('EVENING')) AS s(slot)
WHERE e."mode" = 'SLOT'
  AND NOT EXISTS (
    SELECT 1 FROM "BusyEntry" b
    WHERE b."eventId" = e."id" AND b."memberId" = r."memberId"
      AND b."date" = to_char(d, 'YYYY-MM-DD')
      AND (b."slot" = s.slot OR b."slot" = 'ALL')
  );

-- Drop the old table last.
DROP TABLE "BusyEntry";
```

> If `gen_random_uuid()` is unavailable, run `CREATE EXTENSION IF NOT EXISTS pgcrypto;` first (Neon supports it).

- [ ] **Step 4: Verify the inversion on the dev branch before applying**

Seed a known busy state, then apply and inspect. Run each with `npx prisma db execute --stdin` (reads the dev-branch `DATABASE_URL`):

```bash
# Seed: group + member + responded DAY event, member busy on 2026-08-02 only.
cat <<'SQL' | npx prisma db execute --stdin
INSERT INTO "Group"(id,name,code) VALUES ('g_mig','Mig','MIG999');
INSERT INTO "Member"(id,"groupId",name,token) VALUES ('m_mig','g_mig','Mig','tok_mig');
INSERT INTO "Event"(id,"groupId",title,mode,"windowStart","windowEnd","durationDays")
  VALUES ('e_mig','g_mig','E','DAY','2026-08-01','2026-08-03',1);
INSERT INTO "Response"(id,"eventId","memberId") VALUES ('r_mig','e_mig','m_mig');
INSERT INTO "BusyEntry"(id,"eventId","memberId",date,slot) VALUES ('b_mig','e_mig','m_mig','2026-08-02','ALL');
SQL
```

Apply the migration:
Run: `npx prisma migrate dev`
Expected: migration `availability_free` applied.

Verify the inversion (member should be free on 01 and 03, not 02):
```bash
echo 'SELECT date FROM "AvailabilityEntry" WHERE "memberId"='"'"'m_mig'"'"' ORDER BY date;' | npx prisma db execute --stdin
```
Expected rows: `2026-08-01`, `2026-08-03`.

Clean up the seed:
```bash
echo 'DELETE FROM "Group" WHERE code='"'"'MIG999'"'"';' | npx prisma db execute --stdin
```

- [ ] **Step 5: Regenerate the client and clear the Next cache**

Run: `npx prisma generate && rm -rf .next`
Expected: `lib/generated/prisma` rebuilt (do not commit it — gitignored).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): AvailabilityEntry (free rows); invert BusyEntry in migration"
```

> **Prod deploy note:** this single migration is atomic and preserves data — the Vercel build's `prisma migrate deploy` runs it in one shot. Do the deploy when nobody's mid-edit. Fallback if you'd rather not preserve data: replace the two INSERTs with `DELETE FROM "Response";` (everyone re-marks).

---

### Task A3: Point the API and client types at free rows

**Files:**
- Modify: `app/api/events/[id]/availability/route.ts`
- Modify: `app/api/events/[id]/route.ts:23-77` (GET)
- Modify: `lib/client/types.ts:25-31`
- Test: `tests/api.test.ts` (update availability cases)

**Interfaces:**
- Consumes: `computeMatches` with `freeEntries` (Task A1); Prisma `availabilityEntry` model (Task A2).
- Produces: `PUT /api/events/[id]/availability` accepts `{ freeDates: string[] }` (DAY) or `{ freeSlots: { date, slot }[] }` (SLOT); `GET /api/events/[id]` returns `freeEntries: { memberId, date, slot }[]`; `EventPayload.freeEntries`.

- [ ] **Step 1: Update the API tests**

In `tests/api.test.ts`, change availability saves to send `freeDates`/`freeSlots` and assert on free semantics. Core cases to convert (keep the file's existing setup/helpers):

```ts
// Save availability as FREE days.
const save = await PUT_availability(eventId, aliToken, { freeDates: ["2026-08-15", "2026-08-16"] });
expect(save.status).toBe(200);

// GET returns freeEntries and ranks the all-free window first.
const ev = await GET_event(eventId);
expect(ev.freeEntries.length).toBeGreaterThan(0);
expect(ev.results.windows[0].startDate).toBe("2026-08-15");

// Empty free set still records a response ("can't make any").
const empty = await PUT_availability(eventId, binaToken, { freeDates: [] });
expect(empty.status).toBe(200);
const ev2 = await GET_event(eventId);
expect(ev2.results.respondedCount).toBe(2);
```

Keep the abuse probes (401 no token, 400 bad body, 404 missing event, 405 wrong method) — only the field names change (`busyDates` → `freeDates`).

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- api`
Expected: FAIL (route still reads `busyDates`, writes `busyEntry`).

- [ ] **Step 3: Update the availability PUT route**

In `app/api/events/[id]/availability/route.ts`: rename `parseEntries` inputs `body.busyDates` → `body.freeDates`, `body.busySlots` → `body.freeSlots`, error text "Invalid free dates or slots", and swap the transaction to `prisma.availabilityEntry`:
```ts
await prisma.$transaction([
  prisma.availabilityEntry.deleteMany({
    where: { eventId: event.id, memberId: member.id },
  }),
  prisma.availabilityEntry.createMany({
    data: entries.map((e) => ({
      eventId: event.id, memberId: member.id, date: e.date, slot: e.slot,
    })),
  }),
  prisma.response.upsert({
    where: { eventId_memberId: { eventId: event.id, memberId: member.id } },
    create: { eventId: event.id, memberId: member.id },
    update: { respondedAt: new Date() },
  }),
]);
return Response.json({ saved: entries.length });
```
(An empty `entries` array is valid — it clears free rows and still upserts the Response.)

- [ ] **Step 4: Update the event GET route**

In `app/api/events/[id]/route.ts` GET: change the include and payload:
```ts
include: {
  group: { include: { members: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } } },
  responses: { select: { memberId: true } },
  availability: { select: { memberId: true, date: true, slot: true } },
},
// ...
const results = computeMatches({
  mode: event.mode as EventMode,
  windowStart: event.windowStart,
  windowEnd: event.windowEnd,
  durationDays: event.durationDays,
  members: event.group.members,
  respondedMemberIds: event.responses.map((r) => r.memberId),
  freeEntries: event.availability.map((a) => ({
    memberId: a.memberId, date: a.date, slot: a.slot as Slot,
  })),
});
return Response.json({
  event: { /* unchanged */ },
  group: { /* unchanged */ },
  members: event.group.members,
  freeEntries: event.availability,
  results,
});
```

- [ ] **Step 5: Update client types**

In `lib/client/types.ts`, rename the field:
```ts
export interface EventPayload {
  event: Omit<EventSummary, "createdAt">;
  group: { id: string; name: string; code: string };
  members: MemberInfo[];
  freeEntries: { memberId: string; date: string; slot: string }[];
  results: MatchResults;
}
```

- [ ] **Step 6: Fix the event page's remount key**

`app/g/[code]/e/[id]/page.tsx` remounts the editor with `key={payload.busyEntries.length}` — that field no longer exists. Change it to `key={payload.freeEntries.length}`. (This is the only other `busyEntries` consumer; `results-view.tsx` destructures only `{ event, members, results }` and needs no change.)

- [ ] **Step 7: Run tests + typecheck, verify they pass**

Run: `npm test && npm run build`
Expected: PASS (all suites green; build compiles — no lingering `busyEntries` references).

- [ ] **Step 8: Commit**

```bash
git add app/api/events lib/client/types.ts tests/api.test.ts "app/g/[code]/e/[id]/page.tsx"
git commit -m "feat(api): read/write free availability rows"
```

---

## Phase B — Availability editor (free model + easy selection)

### Task B1: Pure selection helpers (range, presets, weekends)

**Files:**
- Create: `lib/selection.ts`
- Test: `tests/selection.test.ts`

**Interfaces:**
- Produces:
  - `fillRange(a: string, b: string, windowDays: string[]): string[]` — all window days between `a` and `b` inclusive, order-independent.
  - `weekendDays(windowDays: string[]): string[]` — window days that fall on Sat/Sun.
  - `isWeekend(date: string): boolean`.
  - `toggleDays(current: Set<string>, days: string[]): Set<string>` — if every `day` is already present, remove them all; else add them all (used by week-row + weekend toggles).

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from "vitest";
import { fillRange, weekendDays, isWeekend, toggleDays } from "@/lib/selection";

const window = ["2026-08-01","2026-08-02","2026-08-03","2026-08-04","2026-08-05"]; // Sat..Wed

describe("selection helpers", () => {
  it("fillRange is inclusive and order-independent", () => {
    expect(fillRange("2026-08-04", "2026-08-02", window))
      .toEqual(["2026-08-02","2026-08-03","2026-08-04"]);
  });
  it("fillRange clips to the window", () => {
    expect(fillRange("2026-07-20", "2026-08-02", window))
      .toEqual(["2026-08-01","2026-08-02"]);
  });
  it("isWeekend detects Sat/Sun", () => {
    expect(isWeekend("2026-08-01")).toBe(true);  // Sat
    expect(isWeekend("2026-08-02")).toBe(true);  // Sun
    expect(isWeekend("2026-08-03")).toBe(false); // Mon
  });
  it("weekendDays filters the window", () => {
    expect(weekendDays(window)).toEqual(["2026-08-01","2026-08-02"]);
  });
  it("toggleDays adds when any missing, clears when all present", () => {
    expect([...toggleDays(new Set(["2026-08-01"]), ["2026-08-01","2026-08-02"])].sort())
      .toEqual(["2026-08-01","2026-08-02"]); // one missing -> add all
    expect([...toggleDays(new Set(["2026-08-01","2026-08-02"]), ["2026-08-01","2026-08-02"])])
      .toEqual([]); // all present -> clear
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- selection`
Expected: FAIL ("Cannot find module '@/lib/selection'").

- [ ] **Step 3: Implement `lib/selection.ts`**

```ts
// Pure day-selection helpers. Dates are "YYYY-MM-DD"; compared as strings
// (ISO sorts lexically) and parsed as UTC to avoid timezone drift.

export function isWeekend(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 || dow === 6;
}

export function fillRange(a: string, b: string, windowDays: string[]): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return windowDays.filter((d) => d >= lo && d <= hi);
}

export function weekendDays(windowDays: string[]): string[] {
  return windowDays.filter(isWeekend);
}

export function toggleDays(current: Set<string>, days: string[]): Set<string> {
  const next = new Set(current);
  const allPresent = days.every((d) => next.has(d));
  for (const d of days) {
    if (allPresent) next.delete(d);
    else next.add(d);
  }
  return next;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- selection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/selection.ts tests/selection.test.ts
git commit -m "feat(selection): pure range/weekend/toggle helpers"
```

---

### Task B2: Rewrite the availability editor (free model, sticky range, presets, empty-save confirm)

**Files:**
- Modify: `components/availability-editor.tsx` (full rewrite)

**Interfaces:**
- Consumes: `EventPayload.freeEntries` (A3); `lib/selection.ts` (B1); PUT accepts `{ freeDates }` / `{ freeSlots }` (A3).
- Produces: the "My days/times" tab UI. No exported API change (same props: `payload, memberId, token, onSaved`).

- [ ] **Step 1: Rewrite the component**

Replace the file. Key behaviors: `freeSet` seeded from `freeEntries`; solid-green cells; a chip row (`Pick a range` sticky, `Free anytime`, `Weekends`, `Clear`); armed range start shows a dashed ring; empty-save confirm. Full file:

```tsx
"use client";

import { useMemo, useState } from "react";
import { monthsInRange } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { fillRange, weekendDays, toggleDays } from "@/lib/selection";
import { api, ApiError } from "@/lib/client/api";
import type { EventPayload } from "@/lib/client/types";
import { ErrorNote } from "@/components/atoms";
import { MonthCalendar } from "@/components/month-calendar";

const SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
const SLOT_LABEL: Record<(typeof SLOTS)[number], string> = {
  MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening",
};

export function AvailabilityEditor({
  payload, memberId, token, onSaved,
}: {
  payload: EventPayload;
  memberId: string;
  token: string;
  onSaved: () => void;
}) {
  const { event } = payload;

  const initialFree = useMemo(() => {
    const set = new Set<string>();
    for (const e of payload.freeEntries) {
      if (e.memberId !== memberId) continue;
      set.add(event.mode === "DAY" ? e.date : `${e.date}|${e.slot}`);
    }
    return set;
  }, [payload.freeEntries, memberId, event.mode]);

  const [freeSet, setFreeSet] = useState<Set<string>>(new Set(initialFree));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  // Range mode (DAY only): sticky; armed holds the pending start date.
  const [rangeMode, setRangeMode] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const months = useMemo(
    () => monthsInRange(event.windowStart, event.windowEnd),
    [event.windowStart, event.windowEnd],
  );
  const windowDays = useMemo(
    () => months.flatMap((m) => m.weeks.flat())
      .filter((c): c is NonNullable<typeof c> => c != null && c.inWindow)
      .map((c) => c.date),
    [months],
  );

  function mutate(fn: (prev: Set<string>) => Set<string>) {
    setFreeSet(fn);
    setDirty(true);
    setSavedFlash(false);
  }

  function tapDay(date: string) {
    if (rangeMode) {
      if (armed == null) { setArmed(date); return; }
      const span = fillRange(armed, date, windowDays);
      mutate((prev) => { const n = new Set(prev); span.forEach((d) => n.add(d)); return n; });
      setArmed(null); // re-arm for the next range
      return;
    }
    mutate((prev) => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n; });
  }

  function tapSlot(key: string) {
    mutate((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function freeAnytime() {
    if (event.mode === "DAY") {
      mutate(() => new Set(windowDays));
    } else {
      mutate(() => new Set(windowDays.map((d) => `${d}|ALL`))); // ALL frees the day
    }
  }
  function pickWeekends() { mutate((prev) => toggleDays(prev, weekendDays(windowDays))); }
  function clearAll() { mutate(() => new Set()); setArmed(null); }
  function toggleWeekRow(weekDates: string[]) { mutate((prev) => toggleDays(prev, weekDates)); }

  async function doSave() {
    setSaving(true); setError(""); setConfirmEmpty(false);
    try {
      const body = event.mode === "DAY"
        ? { freeDates: [...freeSet] }
        : { freeSlots: [...freeSet].map((k) => { const [date, slot] = k.split("|"); return { date, slot }; }) };
      await api(`/api/events/${event.id}/availability`, { method: "PUT", token, body });
      setDirty(false); setSavedFlash(true); onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save — try again");
    } finally { setSaving(false); }
  }

  function onSaveClick() {
    if (freeSet.size === 0) { setConfirmEmpty(true); return; }
    void doSave();
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-soft">
        Tap the {event.mode === "DAY" ? "days" : "times"} you{" "}
        <strong className="text-leaf-deep">can</strong> make. Everything else counts as busy.
      </p>

      {event.mode === "DAY" && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={() => { setRangeMode((v) => !v); setArmed(null); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              rangeMode ? "border-leaf bg-leaf-wash text-leaf-deep" : "border-hairline bg-card text-ink"
            }`}>
            {rangeMode ? "Range on ✓" : "Pick a range"}
          </button>
          <button onClick={freeAnytime} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm font-medium text-ink">Free anytime</button>
          <button onClick={pickWeekends} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm font-medium text-ink">Weekends</button>
          <button onClick={clearAll} className="rounded-full border border-strike/30 bg-card px-3 py-1.5 text-sm font-medium text-strike">Clear</button>
        </div>
      )}
      {event.mode === "SLOT" && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={freeAnytime} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm font-medium text-ink">Free anytime</button>
          <button onClick={clearAll} className="rounded-full border border-strike/30 bg-card px-3 py-1.5 text-sm font-medium text-strike">Clear</button>
        </div>
      )}
      {rangeMode && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-leaf-wash px-3 py-2 text-xs text-leaf-deep">
          <span>Tap the start &amp; end of each free stretch</span>
          <button onClick={() => { setRangeMode(false); setArmed(null); }} className="font-bold">Done</button>
        </div>
      )}

      {event.mode === "DAY" ? (
        <MonthCalendar months={months} renderDay={(cell) => {
          if (!cell.inWindow) return (
            <div className="flex aspect-square items-center justify-center font-mono text-sm text-ink-soft/30">{cell.dayOfMonth}</div>
          );
          const free = freeSet.has(cell.date);
          const isArmed = armed === cell.date;
          return (
            <button aria-pressed={free}
              aria-label={`${fmtDate(cell.date)}${free ? " — free" : ""}`}
              onClick={() => tapDay(cell.date)}
              className={`flex aspect-square w-full items-center justify-center rounded-lg border font-mono text-sm ${
                free ? "border-leaf-deep bg-leaf text-white"
                : isArmed ? "border-2 border-dashed border-leaf bg-card text-leaf-deep"
                : "border-hairline bg-card text-ink"
              }`}>
              {cell.dayOfMonth}
            </button>
          );
        }} />
      ) : (
        <SlotListEditor months={months} freeSet={freeSet} onToggle={tapSlot} />
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-paper/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <p className="flex-1 text-sm text-ink-soft">
            {freeSet.size === 0 ? "Nothing marked free yet"
              : `${freeSet.size} ${event.mode === "DAY" ? "day(s)" : "time(s)"} free`}
          </p>
          <button onClick={onSaveClick} disabled={saving || (!dirty && !savedFlash)}
            className={`rounded-xl px-5 py-3 font-semibold text-white transition-colors ${
              savedFlash && !dirty ? "bg-leaf-deep" : "bg-leaf"
            } disabled:opacity-40`}>
            {saving ? "Saving…" : savedFlash && !dirty ? "Saved ✓" : "Save"}
          </button>
        </div>
        {confirmEmpty && (
          <div className="mx-auto mt-2 max-w-md rounded-xl border border-hairline bg-card p-3">
            <p className="text-sm text-ink">You haven’t marked any free days — save as “can’t make any of these”?</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => void doSave()} className="rounded-lg bg-leaf px-4 py-2 text-sm font-semibold text-white">Yes, save</button>
              <button onClick={() => setConfirmEmpty(false)} className="rounded-lg border border-hairline bg-card px-4 py-2 text-sm font-semibold text-ink">Keep editing</button>
            </div>
          </div>
        )}
        {error && <div className="mx-auto mt-2 max-w-md"><ErrorNote>{error}</ErrorNote></div>}
      </div>
    </div>
  );
}

function SlotListEditor({
  months, freeSet, onToggle,
}: {
  months: ReturnType<typeof monthsInRange>;
  freeSet: Set<string>;
  onToggle: (key: string) => void;
}) {
  const days = months.flatMap((m) => m.weeks.flat())
    .filter((c): c is NonNullable<typeof c> => c != null && c.inWindow);
  return (
    <div className="space-y-1.5">
      {days.map((day) => (
        <div key={day.date} className="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2">
          <span className="w-24 shrink-0 font-mono text-sm">{fmtDate(day.date)}</span>
          <div className="flex flex-1 gap-1.5">
            {SLOTS.map((slot) => {
              const key = `${day.date}|${slot}`;
              const free = freeSet.has(key) || freeSet.has(`${day.date}|ALL`);
              return (
                <button key={slot} aria-pressed={free} onClick={() => onToggle(key)}
                  className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-medium ${
                    free ? "border-leaf-deep bg-leaf text-white" : "border-hairline bg-paper text-ink-soft"
                  }`}>
                  {SLOT_LABEL[slot]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the week-row toggle affordance**

`MonthCalendar` renders weeks; add an optional row-label the editor can tap to `toggleWeekRow(weekInWindowDates)`. Check `components/month-calendar.tsx` for its render signature first. If it exposes weeks, add an optional prop `onWeekLabel?: (dates: string[]) => void` that renders a small leading "▸" cell per week calling it with that week's in-window dates. If wiring a per-row control cleanly isn't feasible without reshaping the calendar, keep `Weekends` + `Free anytime` + range as the bulk tools and **defer week-row toggling** (note it in the task's commit message). Do not block B2 on it.

- [ ] **Step 3: Verify by running the app**

Use the `run` skill (or `npm run dev`). Confirm on the "My days" tab: tapping toggles green; "Pick a range" → tap two days fills the span in green and stays on for another range; "Free anytime"/"Weekends"/"Clear" work; Save with nothing selected shows the confirm; saving persists (reload keeps green).

Run: `npm run build`
Expected: build passes (types + lint clean; note the two existing `eslint-disable` comments in the `[code]` pages are intentional).

- [ ] **Step 4: Commit**

```bash
git add components/availability-editor.tsx components/month-calendar.tsx
git commit -m "feat(editor): pick-free model with sticky range + presets"
```

---

### Task B3: Flip landing + results copy to the free model

**Files:**
- Modify: `app/page.tsx` (hero copy + `WeekMotif`)
- Modify: `components/results-view.tsx` (copy only; structure unchanged)

**Interfaces:** none exported.

- [ ] **Step 1: Update landing copy and motif**

In `app/page.tsx`: change the subtitle "Everyone crosses out their busy days. Saath circles the dates that work…" → "Everyone picks the days they’re free. Saath circles the date that works for the whole family." In `WeekMotif`, flip the strip so free days render green (reuse the editor's `bg-leaf text-white` look) with one circled winner (keep `PenCircle`); drop the `StrikeX` import if now unused.

- [ ] **Step 2: Verify results copy still reads right**

`components/results-view.tsx` needs no structural change (result shapes unchanged). Read it and confirm wording still fits the free model (e.g. the "X of Y filled in — waiting for …" line, the "without <name>" line, "Greener days = more people free"). Adjust any wording that implied "busy." No logic edits.

- [ ] **Step 3: Verify by running the app**

Load `/` (as a first-time visitor) and an event's "Best dates" tab. Confirm copy reads "free," the heatmap and winner circle render, and the roster/waiting line are intact.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx components/results-view.tsx
git commit -m "feat(ui): landing + results copy for the free model"
```

---

## Phase C — Multiple groups + home hub

### Task C1: Pure group-list reducers + localStorage store

**Files:**
- Create: `lib/client/groups.ts`
- Test: `tests/groups.test.ts`

**Interfaces:**
- Produces pure reducers (unit-tested) + a `useSyncExternalStore` hook (not unit-tested):
  - `type SavedGroup = { code: string; groupName: string; memberName: string; lastOpenedAt: number }`
  - `upsertGroup(list: SavedGroup[], g: SavedGroup): SavedGroup[]` — dedupe by `code` (case-insensitive), newest fields win, sorted by `lastOpenedAt` desc.
  - `removeFromList(list: SavedGroup[], code: string): SavedGroup[]`
  - localStorage wrappers `getGroups()`, `saveGroup(g)`, `removeGroup(code)`, `touchGroup(code)` and hook `useMyGroups()`.

- [ ] **Step 1: Write the reducer tests**

```ts
import { describe, it, expect } from "vitest";
import { upsertGroup, removeFromList, type SavedGroup } from "@/lib/client/groups";

const g = (code: string, t: number): SavedGroup =>
  ({ code, groupName: code, memberName: "Me", lastOpenedAt: t });

describe("group list reducers", () => {
  it("upsert dedupes by code (case-insensitive) and keeps newest on top", () => {
    let list: SavedGroup[] = [];
    list = upsertGroup(list, g("ABC123", 1));
    list = upsertGroup(list, g("XYZ999", 2));
    list = upsertGroup(list, { ...g("abc123", 3), groupName: "Renamed" });
    expect(list.map((x) => x.code)).toEqual(["ABC123", "XYZ999"]); // no dup
    expect(list[0].code).toBe("ABC123");        // touched -> top
    expect(list[0].groupName).toBe("Renamed");  // fields updated
  });
  it("removeFromList drops by code", () => {
    const list = [g("ABC123", 1), g("XYZ999", 2)];
    expect(removeFromList(list, "ABC123").map((x) => x.code)).toEqual(["XYZ999"]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- groups`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/client/groups.ts`**

```ts
"use client";
import { useSyncExternalStore } from "react";

export interface SavedGroup {
  code: string;
  groupName: string;
  memberName: string;
  lastOpenedAt: number;
}

const KEY = "saath:groups";

export function upsertGroup(list: SavedGroup[], g: SavedGroup): SavedGroup[] {
  const code = g.code.toUpperCase();
  const rest = list.filter((x) => x.code.toUpperCase() !== code);
  return [{ ...g, code }, ...rest].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function removeFromList(list: SavedGroup[], code: string): SavedGroup[] {
  return list.filter((x) => x.code.toUpperCase() !== code.toUpperCase());
}

let cache: SavedGroup[] | null = null;
const listeners = new Set<() => void>();

function read(): SavedGroup[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedGroup[]) : [];
  } catch { return []; }
}
function write(list: SavedGroup[]) {
  window.localStorage.setItem(KEY, JSON.stringify(list));
  cache = list;
  for (const l of listeners) l();
}

export function getGroups(): SavedGroup[] {
  if (typeof window === "undefined") return [];
  if (cache == null) cache = read();
  return cache;
}
export function saveGroup(g: SavedGroup): void { write(upsertGroup(getGroups(), g)); }
export function removeGroup(code: string): void { write(removeFromList(getGroups(), code)); }
export function touchGroup(code: string): void {
  const existing = getGroups().find((x) => x.code.toUpperCase() === code.toUpperCase());
  if (existing) write(upsertGroup(getGroups(), { ...existing, lastOpenedAt: Date.now() }));
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

export function useMyGroups(): SavedGroup[] {
  return useSyncExternalStore(subscribe, getGroups, () => []);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- groups`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/client/groups.ts tests/groups.test.ts
git commit -m "feat(groups): per-device saved-group list store"
```

---

### Task C2: Record groups on create/join

**Files:**
- Modify: `components/landing-forms.tsx:23-42` (createGroup)
- Modify: `app/g/[code]/page.tsx` (JoinGate.join + open effect)

**Interfaces:**
- Consumes: `saveGroup`, `touchGroup` (C1).

- [ ] **Step 1: Save on group creation**

In `components/landing-forms.tsx` `createGroup`, after `saveIdentity(...)`:
```ts
saveGroup({
  code: data.group.code,
  groupName: data.group.name,
  memberName: memberName.trim(),
  lastOpenedAt: Date.now(),
});
```
Import `saveGroup` from `@/lib/client/groups`.

- [ ] **Step 2: Save on join, and touch on open**

In `app/g/[code]/page.tsx`: in `JoinGate.join`, after `saveIdentity(...)` add `saveGroup({ code, groupName, memberName: data.memberName, lastOpenedAt: Date.now() })` (pass `groupName` into `JoinGate` from the loaded `group.name`). In `GroupPage`, when the payload loads successfully, call `touchGroup(upperCode)` so opening bumps it to the top. Import both from `@/lib/client/groups`.

- [ ] **Step 3: Verify by running the app**

Create a group, then a second — both should be recorded (inspect `localStorage.saath:groups` in devtools). Join a third via its code; it appears too.

- [ ] **Step 4: Commit**

```bash
git add components/landing-forms.tsx "app/g/[code]/page.tsx"
git commit -m "feat(groups): record groups on create/join"
```

---

### Task C3: Home hub + back-navigation

**Files:**
- Create: `components/my-groups.tsx`
- Modify: `app/page.tsx` (show hub when groups exist)
- Modify: `app/g/[code]/page.tsx` (home link on the Saath eyebrow)

**Interfaces:**
- Consumes: `useMyGroups`, `removeGroup` (C1).

- [ ] **Step 1: Build the `MyGroups` hub component**

`components/my-groups.tsx` — a client component listing saved groups as Saath cards (group name, mono code, last-opened), each linking to `/g/<code>` with a small "Remove" that calls `removeGroup(code)` behind a one-tap confirm (copy: "Remove from this device? You won't leave the group."). Below the list, render `<LandingForms />` inside a collapsed "＋ New group / Join by code" section (a button toggles it open). Use existing atoms (`Card`, `Button`) and tokens.

- [ ] **Step 2: Wire the hub into `/`**

In `app/page.tsx` (make it a client component or split a client child): if `useMyGroups().length > 0`, render `<MyGroups />` (hub); otherwise render the current marketing hero + `<LandingForms />` (first-run onboarding, unchanged).

- [ ] **Step 3: Add the home link on the group page**

In `app/g/[code]/page.tsx`, wrap the "Saath" eyebrow in a `<Link href="/">` so there's a way back to the hub (this closes the "trapped in one group" gap). Keep it subtle (e.g. add a "← " or a small home glyph).

- [ ] **Step 4: Verify by running the app**

With ≥1 saved group, `/` shows "Your groups"; tapping a card opens it; the Saath eyebrow on a group page returns to `/`; "Remove" drops a card after confirm; a fresh browser (no groups) still sees the marketing landing.

Run: `npm run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add components/my-groups.tsx app/page.tsx "app/g/[code]/page.tsx"
git commit -m "feat(groups): My Groups home hub + back navigation"
```

---

## Final: full verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass (matching, api, selection, groups, calendar, format, db.smoke).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `prisma generate && prisma migrate deploy && next build` all succeed.

- [ ] **Step 3: End-to-end smoke (run the app)**

Create group → appears in hub → open event → mark free days with range + presets → Save → "Best dates" ranks the all-free window first with the green circle → create a second group → hop between both from the hub. Confirm empty-save confirm works and records a response.

- [ ] **Step 4: Update the handoff**

Update `C:\Users\irfan\Desktop\my_workspace\Handoffs\Scheduler_handoff.md`: note the free-model flip, `AvailabilityEntry`, the sticky-range/presets editor, and the My Groups hub as done; move these off "Pending Work."

---

## Self-review notes (coverage)

- Spec Fix A (data/matching/API/migration) → Tasks A1–A3. Fix B (editor + selection + copy) → B1–B3. Fix C (groups) → C1–C3. Migration inversion → A2 (SQL, verified on dev). Testing plan → matching/api/selection/groups tests + run-the-app verification for components (no component-test infra exists; logic is extracted to tested helpers). Member-visibility unchanged → results-view untouched (A1 preserves result shapes; B3 is copy-only).
