# Saath — Free-availability flip, easier selection, & "My groups"

**Date:** 2026-07-09
**Project:** Saath (family event scheduler) — `C:\Users\irfan\Desktop\my_workspace\scheduler`, repo `hareemirfan2004-dev/Event_scheduler`, branch `main` (baseline commit `bba3efc`).
**Scope:** Three "fixes" from `family-scheduler/update_ideas.md`. The three "updates" (messaging, budget split, place recommendations) are **out of scope** — each gets its own later spec.

---

## Goals

1. **Flip availability from "busy" to "free."** Members pick the days they *can* make instead of crossing out the ones they can't. Store free days, not busy days.
2. **Easier multi-day selection.** A sticky range mode plus presets, so "I'm free this whole stretch" isn't 30 taps.
3. **Multiple groups with a home hub.** After creating/joining a group you're currently trapped in it. Add a home page that remembers every group you've created or joined and lets you hop between them — the *concept* of a chat-list home, styled in Saath's paper-calendar language (not WhatsApp's look).

All work lands in the existing `scheduler` app, on top of the deployed version.

---

## Non-goals (YAGNI)

- Messaging, budget split, place recommendations (separate future specs).
- Accounts / cross-device sync. The group list stays **per-device** (localStorage), consistent with the existing no-passwords identity model. New device → re-open via invite link/code, which re-adds it locally.
- Leaving a group server-side / member removal.
- Drag-to-paint selection (deliberately rejected — fights page scroll on phones; sticky range + presets chosen instead).
- Real-time updates.

---

## Confirmed design decisions (from brainstorm + visual companion)

- **Full flip to the positive "pick free" model** — for both framing and fewer taps.
- **Free-day marker: solid green fill, white number** (visual "Option C"). Bold and unmistakable.
- **The winning group date keeps the hand-drawn green pen circle** (`PenCircle`) — reserved exclusively for results, so it never collides with a personal "I'm free" mark.
- **Selection = sticky range mode + presets:**
  - Normal mode: one tap toggles one day.
  - **Range mode is a sticky toggle** ("Pick a range" → stays on). Each *pair* of taps (start → end) fills a stretch; repeat for as many separate ranges as you want; "Done" exits. An armed start shows a **dashed green ring** until its end is tapped.
  - Presets: **`Free anytime`** (whole window), **`Weekends`** (all Sat/Sun in window), **tap a week-row** to toggle that row, **`Clear`**.
- **Empty save = "can't make any of these," with a confirm.** Saving with nothing selected still records a Response (member counts as *responded*, free on zero days) after confirming *"You haven't marked any free days — save as 'can't make any of these'?"*
- **Member visibility unchanged.** The group-page roster, the results "X of Y filled in — waiting for …" line, and the per-date "without <name>" all stay. Results keeps showing *who can't make it* per date (the actionable view), not *who's free*.

---

## Fix A — The free/busy flip (data model, matching, API)

### A1. Data model (`prisma/schema.prisma`)

Rename `BusyEntry` → **`AvailabilityEntry`**, where **each row = one day/slot a member marked FREE** (the exact inversion of today's "only busy time is stored"). Columns are otherwise identical.

```prisma
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

- Rename relations: `Member.busyEntries` → `Member.availability`, `Event.busyEntries` → `Event.availability`.
- Update the `Response` model comment: "responded even if they marked nothing free (= can't make any of these)."
- `slot = "ALL"` now means **free the whole day** (was: busy the whole day). Matching honors it (see A2).

### A2. Matching engine (`lib/matching.ts`)

Invert the core semantics. The public result shapes (`WindowResult`, `SlotResult`, `HeatmapDay`, `MatchResults`) stay identical, so `results-view.tsx` needs no structural change.

- Rename input type `BusyEntryInput` → `FreeEntryInput`; `MatchInput.busyEntries` → `MatchInput.freeEntries`.
- Build `freeDates: Map<memberId, Set<date>>` from the free rows.
- **DAY mode:** a responded member is *available* for a window iff **every** day in the window is in their free set (was: none busy). `score = available.length`; ties → earliest start (unchanged sort).
- **SLOT mode:** member free for `(date, slot)` iff they have a free row `date|slot` **or** `date|ALL`. (Mirror of the old "ALL blocks all," inverted to "ALL frees all.")
- **Heatmap:** `freeCount(day)` = responded members with **at least one** free row on that day (any slot). Keeps today's "greener = more people free" simplification, just sourced from free rows.
- `unavailableMemberIds` now = responded members *not* free for the whole window → the results "without <name>" line still works and still means "can't make it."
- A member who saved with an **empty** free set is `responded` but appears in no window's `available` list and in every window's `unavailable` list. Expected.

### A3. API

- **`PUT /api/events/[id]/availability`** — accept `freeDates: string[]` and `freeSlots: {date, slot}[]` (was `busyDates` / `busySlots`). `parseEntries` renamed/retargeted; writes `availabilityEntry` rows (replace-style: `deleteMany` then `createMany`). Still `upsert`s the `Response` so an **empty** payload records the member as responded. Validation (ISO date regex, slot whitelist, de-dupe on `eventId+memberId+date+slot`) unchanged.
- **`GET /api/events/[id]`** — `include.busyEntries` → `include.availability`; response field `busyEntries` → `freeEntries`; pass `freeEntries` into `computeMatches`.
- **`lib/client/types.ts`** — `EventPayload.busyEntries` → `freeEntries`.
- **`lib/client/api.ts`** — unchanged (generic fetch wrapper).

### A4. Migration (existing prod data)

Prod is live (deployed 2026-07-06) with possibly-small real data. **Preserve intent by inverting** (approved in brainstorm): a member's old *unmarked* in-window days = free → become explicit free rows; old *busy* days → absent.

Plan:
1. **Migration 1 (schema):** create `AvailabilityEntry`; leave `BusyEntry` in place.
2. **Backfill (`scripts/backfill-free-from-busy.ts`, idempotent):** for each event × each *responded* member, insert a free row for every in-window day/slot **not** in their busy set, using the same day-enumeration logic as `matching.ts` (its `eachDay()` is currently private — export it or factor it into a shared helper). DAY events → `slot = ALL`; SLOT events → the three slots minus busy ones (a busy `date|ALL` removes all three). Skip members/events that already have `AvailabilityEntry` rows.
3. **Migration 2 (schema):** drop `BusyEntry`.

Because prod credentials live only in Vercel env vars (local `.env` targets the Neon **dev** branch), the backfill is a documented one-time operational step run with the prod `DATABASE_URL`. If prod turns out to hold no availability yet, invert and reset are equivalent.

> **Simpler fallback (flagged for the user):** given the tiny data volume, a **reset** — drop `BusyEntry`, clear `Response` rows, members re-mark under the new model — is a one-migration, near-zero-risk alternative. Decide at spec review.

**Prisma 7 / Next 16 gotchas to honor** (from the handoff): after any schema change run `npx prisma generate`, delete `.next`, restart dev (the generated client in `lib/generated/prisma` otherwise embeds the old shape); the datasource URL lives in `prisma.config.ts`, never in `schema.prisma`; build runs `prisma migrate deploy`. Read `node_modules/next/dist/docs/` before touching route/page code (async `params`, etc.).

---

## Fix B — Availability editor: free model + easier selection

All in `components/availability-editor.tsx` (with small support from `components/month-calendar.tsx`). Fixes #2 and #3 share this component, so they ship together.

### B1. Copy & state
- Header: **"Pick the days you're free" / "Tap the days you *can* make. Everything else counts as busy."**
- State `freeSet` (replaces `busySet`), seeded from `payload.freeEntries` for this member.
- Save payload: DAY → `{ freeDates: [...] }`; SLOT → `{ freeSlots: [{date, slot}] }`.

### B2. Day cell (DAY mode)
- Free = **solid green** (`bg-leaf` / `border-leaf-deep`, white number). Not-free = plain paper cell. **No red `StrikeX` in the editor.**
- Armed range start = **dashed green ring** on white.

### B3. Selection controls (a chip row above the calendar)
- **`Pick a range`** — sticky toggle. While on: a hint bar *"Tap the start & end of each free stretch · Done"*; first tap arms a start (dashed), second tap fills the inclusive span into `freeSet` and re-arms for the next range; "Done" turns it off. Start/end tapped out of order → normalize by date. Same day twice → single day. Range fill is **additive**.
- **`Free anytime`** — add every in-window day (DAY) / every day as `slot = ALL` (SLOT).
- **`Weekends`** — add every in-window Sat/Sun.
- **tap a week-row** — toggle that row's in-window days (all already free → clear them; else add them).
- **`Clear`** — empty `freeSet`.
- Removing a single day → tap it off in normal mode.

`month-calendar.tsx` gains only what's needed to support row-level toggling and range fill over its existing month/week/cell structure (it already exposes weeks via `monthsInRange`); keep changes minimal and prop-driven.

### B4. SLOT mode
- Pick free slots (solid green when free); per-slot tapping stays. `Free anytime` = all slots free (store `slot = ALL` per day). Range/weekend/week-row presets are **DAY-mode only**.

### B5. Save bar & empty-save
- Label: **"N days marked free"** (or "N times").
- Save with `freeSet` empty → confirm dialog *"You haven't marked any free days — save as 'can't make any of these'?"* → on confirm, PUT the empty payload (records Response). Non-empty save is unchanged.
- Existing save error handling (`ApiError` → message, sticky bar) preserved.

### B6. Ripple: landing + results copy
- `app/page.tsx`: hero copy "Everyone crosses out their busy days" → "Everyone picks the days they're free"; flip `WeekMotif` to show green free days + the one circled winner (keep it "the whole app in one image").
- `components/results-view.tsx`: no structural change; verify heatmap/legend read correctly against free-sourced counts; minor copy only.
- `components/pen.tsx`: `PenCircle` unchanged. `StrikeX` likely becomes unreferenced once the editor and `WeekMotif` flip to green — keep the component file (cheap, may be reused), no need to force a use for it.

---

## Fix C — Multiple groups + home hub

### C1. Client group index (`lib/client/groups.ts`, new)
- localStorage key `saath:groups` → `Array<{ code, groupName, memberName, lastOpenedAt }>`.
- Pure helpers: `addGroup`, `removeGroup`, `touchGroup(code)`, `getGroups`, deduped by `code` (update name/lastOpened on repeat). Exposed to React via `useMyGroups()` (same `useSyncExternalStore` pattern as `identity.ts`).
- Written on **create** (`landing-forms.tsx` `createGroup`) and **join** (`g/[code]/page.tsx` `JoinGate.join`); `touchGroup` on opening a group. Pure helpers are unit-testable.

### C2. Home hub (`app/page.tsx` + new `components/my-groups.tsx`)
- **Has ≥1 saved group:** show **"Your groups"** — a list of Saath cards (group name, mono invite code, last-opened). Tap → `/g/[code]`. Below: a compact **"＋ New group / Join by code"** section reusing `LandingForms` (collapsed by default).
- **No saved groups (first run):** current marketing hero + `LandingForms` (onboarding), unchanged.
- One route only: `/` is the hub when you have groups, the marketing page when you don't. No separate `/groups` route.
- Each card has a small **remove** affordance → one-tap confirm → `removeGroup(code)` locally. Copy makes clear it **removes from this device**, doesn't leave the group.

### C3. Navigation back to the hub
- `app/g/[code]/page.tsx`: make the "Saath" eyebrow a **link to `/`** (adds the missing way home). Event page already has "← <group name>" back to the group.

### C4. Cross-device note
Per-device list by design (no accounts). Opening a group whose code no longer exists server-side → existing 404 handling; offer to remove it from the list.

---

## Data flow (after changes)

- **Availability:** editor `freeSet` → `PUT {freeDates|freeSlots}` → `AvailabilityEntry` rows + `Response` upsert → `GET` returns `freeEntries` → `computeMatches` (free semantics) → `results-view`.
- **Groups:** create/join → write `saath:groups` index (+ existing `saath:<CODE>` identity) → `useMyGroups()` → home hub cards → `/g/[code]`.

---

## Testing

Keep the "all green" bar (currently 27 Vitest tests); adapt counts as needed. Tests run against the Neon **dev** branch (~50s).

- **`tests/matching.test.ts`** — rewrite for free semantics: window available iff all days free; SLOT free iff `slot` or `ALL` free; heatmap counts from free rows; ties → earliest; **empty free set** member = responded but in no window; `slot = ALL` frees the whole day.
- **`tests/api.test.ts`** — `PUT` with `freeDates`/`freeSlots` persists `AvailabilityEntry` + `Response`; **empty `freeDates`** still creates a `Response`; `GET` returns `freeEntries` and correct results; token/abuse guards still hold (401/400/404/405).
- **New — group index:** unit-test `addGroup`/`removeGroup`/`touchGroup`/dedupe (pure, no DOM).
- **New — backfill:** unit-test the busy→free inversion function on a seeded event (DAY and SLOT).
- **`tests/calendar.test.ts`, `tests/format.test.ts`, `tests/db.smoke.test.ts`** — unchanged.

---

## Suggested build order

1. **Fix A** (schema rename + matching invert + API + client types) with tests — the foundation. Migration/backfill decided at review.
2. **Fix B** (editor: free model, solid-green cells, sticky range, presets, empty-save confirm) + landing/results copy.
3. **Fix C** (group index, home hub, back-nav) — independent of A/B; can proceed in parallel.

---

## Open decisions for spec review

1. **Migration:** invert-and-preserve (recommended, approved in brainstorm) vs the simpler **reset**. Confirm.
2. **Model name:** `AvailabilityEntry` (recommended) vs `FreeEntry`. Minor.
