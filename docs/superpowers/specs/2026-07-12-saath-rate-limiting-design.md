# Saath — Rate Limiting for Unauthenticated Endpoints (Design Spec)

**Date:** 2026-07-12
**Status:** Approved by user 2026-07-12 (backend, sequencing, scope, and mechanism chosen via brainstorm)
**Branch:** `feat/rate-limiting` (created off `main` at `ea0f073`; **rebase onto updated `main` after PR #1 merges, before implementation starts**)

## Context and goals

Saath's API has four endpoints anyone on the internet can call without a member token. The repo is public and the production URL is shared, so the API shape is discoverable. The realistic abuse scenarios are:

1. **Junk-group spam** — `POST /api/groups` is unauthenticated and writes rows (group + member + token). A script could fill the Neon free-tier database and burn compute.
2. **Invite-code enumeration** — `POST /api/groups/[code]/join` and `GET /api/groups/[code]` confirm whether a 6-char code exists. Brute-force is impractical (~31^6 ≈ 890M combos) but scanning should be pointless, not merely slow.
3. **Compute burn** — the unauthenticated GETs do real DB work (event GET also runs `computeMatches`). Hammering them wastes the free-tier budget.

**Goal:** make each of these uneconomical with the smallest possible change, using infrastructure the project already has.

**Non-goals:** volumetric DDoS protection (Vercel's platform layer already does this); limiting token-authenticated endpoints (an abuser with a valid token is already inside the family trust model); precise/smooth limiting (fixed-window boundary bursts up to 2× are acceptable); per-user quotas, dashboards, or observability beyond a log line.

## Decisions (settled — do not re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Counter storage | **Postgres (existing Neon DB)** | No new accounts/env vars; identical in dev/tests/prod; code lives in the repo. Upstash Redis rejected as an extra service Saath doesn't need at family scale; Vercel WAF rejected (plan-dependent, not code-reviewable, not testable). |
| Algorithm | **Fixed window, atomic upsert** | One indexed query per check. Sliding window (row per hit) rejected: more writes, needs pruning, precision nobody needs. |
| Integration point | **Per-route helper call** | Explicit and testable — `tests/api.test.ts` calls route handlers directly, so a `proxy.ts` limiter would be invisible to the whole suite (and the edge runtime can't use the TCP Prisma adapter anyway). |
| Scope | **Unauthenticated endpoints only** | User-confirmed. |
| Sequencing | **Spec + plan now; implementation only after PR #1 merges**, on this branch rebased onto updated `main` | Rate limiting touches the same route files PR #1 changed; building on the merged result avoids conflicts. |
| Failure mode | **Fail open** | If the rate-limit query itself throws, log (`console.error`) and allow the request. Availability beats strictness for a family app. |

## Data model

New Prisma model (additive migration; touches no existing tables or data):

```prisma
model RateLimit {
  key         String   @id            // "<scope>:<ip>", e.g. "create-group:203.0.113.7"
  windowStart DateTime
  count       Int
}
```

No relations. Applied to the Neon **dev** branch during development (`prisma migrate dev`); reaches prod via `prisma migrate deploy` in the Vercel build like every other migration. Because it is purely additive, it carries none of the timing concerns PR #1's inversion migration has.

## The helper — `lib/rate-limit.ts`

```ts
export interface RateLimitPolicy { limit: number; windowMs: number }

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;   // 0 when allowed
}

export async function rateLimit(
  scope: string,               // e.g. "create-group"
  ip: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult>
```

Behavior:

- Key = `${scope}:${ip}`. One **atomic** upsert: if the row is missing or `windowStart` is older than `windowMs`, reset (`windowStart = now, count = 1`); otherwise increment `count`. Atomicity matters because Vercel runs handlers concurrently — the implementation must not read-then-write in two statements (use a single `INSERT … ON CONFLICT … DO UPDATE` via `$queryRaw`, or an interactive transaction; the plan picks one and the reviewer verifies races can only miscount by the concurrency degree, never corrupt).
- Allowed while `count <= limit`. When blocked, `retryAfterSeconds` = time left in the window, rounded up.
- **Policies are parameters, not constants baked into the helper** — tests pass tiny policies (e.g. `{ limit: 2, windowMs: 1000 }`) without monkeypatching.
- Any thrown DB error is caught inside the helper → `console.error` + `{ allowed: true, retryAfterSeconds: 0 }` (fail open).
- Housekeeping: on ~1% of calls (`Math.random() < 0.01`), fire-and-forget a `deleteMany` of rows with `windowStart` older than 24h. Per-key rows are reset in place by the upsert, so the table stays tiny regardless; the sweep only clears keys never seen again.

IP extraction, `clientIp(req: Request): string` (same module):

- First entry of `x-forwarded-for` (Vercel sets it; first hop = client), trimmed; else `x-real-ip`; else `"local"` (dev servers and the handler-direct test harness have no proxy headers).
- Never throw; any parse weirdness falls back to `"local"`.
- Consequence, accepted: all local dev/e2e traffic shares the single `"local"` bucket, so an unusually heavy dev session could trip a limit (e.g. >10 group creations in an hour). Deliberate — it exercises the real code path. If it ever bites, clear the bucket (`DELETE FROM "RateLimit";` via `prisma db execute`) or tune the policy map; no dev-mode bypass, because a bypass would also blind the handler-level test.

## Guarded endpoints and default policies

Policies live in one exported map in `lib/rate-limit.ts` (single place to tune):

| Scope | Endpoint | Policy | Rationale |
|---|---|---|---|
| `create-group` | `POST /api/groups` | **10 / hour / IP** | Ends junk-group spam; a demo/family session creating a few groups never notices |
| `join-group` | `POST /api/groups/[code]/join` | **20 / hour / IP** | Kills enumeration; a whole family joining from one home Wi-Fi (shared NAT IP) still fits |
| `read-group` | `GET /api/groups/[code]` | **300 / hour / IP** | Anti-enumeration + compute guard; an evening of heavy family use stays well under |
| `read-event` | `GET /api/events/[id]` | **300 / hour / IP** | IDs are unguessable UUIDs — this is purely a compute guard |

Each handler calls the helper **first thing** (before parsing bodies or touching domain tables) and on `!allowed` returns via the existing `jsonError` helper:

- Status **429**, message: `"Too many attempts — please wait a few minutes and try again."`
- Header `Retry-After: <retryAfterSeconds>` (requires `jsonError` to accept optional headers, or the route constructs the Response with the same shape — plan decides; either way the JSON error shape stays identical to every other error).

No client changes: `lib/client/api.ts` already surfaces API error messages, and the forms display them.

## Testing

Same harness style as the existing suite (handler-direct, against the Neon dev branch):

1. **`tests/rate-limit.test.ts`** — unit tests of the helper with a tiny policy: allow → allow → blocked (`allowed: false`, `retryAfterSeconds` > 0) → new window after `windowMs` elapses → allowed again. Plus: `clientIp` header parsing (x-forwarded-for first-hop, fallbacks); distinct scopes/IPs don't share counters. Uses unique key prefixes per test run so parallel/repeat runs on the shared dev DB don't collide.
2. **One handler-level test** (in `tests/api.test.ts` or the new file): drive a guarded route past a tiny injected policy and assert the real 429 + `Retry-After` header + JSON error shape. This requires routes to read policies from the exported map so the test can point the route at a tiny policy — the plan specifies the exact mechanism (e.g. the map is mutable in tests, or policies resolve through a function the test overrides).
3. Fail-open is unit-tested by calling the helper with a deliberately broken Prisma call path if cheaply possible; otherwise verified by review (the try/catch is the whole mechanism).

Suite baseline after PR #1: 34 tests; this branch adds its own and keeps everything green (`npm test` vs Neon dev; remember its occasional connection flakiness — retry once before suspecting code).

## Rollout

- Implementation starts **only after PR #1 merges**: rebase this branch onto updated `main`, then implement (the route files this touches were rewritten by PR #1).
- Additive migration → no deploy-timing constraints; merging the follow-up PR deploys it like any normal change.
- Manual verification before PR: run the dev server, hammer `POST /api/groups` past 10 with `curl`/a loop, observe 429 + `Retry-After`, confirm the UI shows the friendly message on the create form, and confirm normal flows are untouched.

## Out of scope / future

- Upstash/Redis migration if Saath ever outgrows family scale (the helper's interface is the seam — swap the storage without touching routes).
- Limiting authenticated endpoints; CAPTCHA; per-member quotas.
- Vercel WAF rules as a second layer.
