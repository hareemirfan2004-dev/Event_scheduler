# Saath Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixed-window, Postgres-backed rate limiting on Saath's four unauthenticated API endpoints, per the approved spec `docs/superpowers/specs/2026-07-12-saath-rate-limiting-design.md`.

**Architecture:** One new Prisma model (`RateLimit`) holds per-`scope:ip` counters, updated by a single atomic `INSERT … ON CONFLICT` upsert in `lib/rate-limit.ts`. Each guarded route calls `enforceRateLimit(scope, req)` first thing and returns its 429 `Response` when blocked. Fail-open on any DB error.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (`$queryRaw` upsert), Postgres (Neon), Vitest.

## Global Constraints

- **PRECONDITION: PR #1 must be merged first.** This branch (`feat/rate-limiting`) was cut from `main` before that merge; Task 1 Step 1 verifies the merge and rebases. The Modify line references in this plan describe the post-PR-#1 file contents.
- **This is NOT stock Next.js.** Read the relevant guide under `node_modules/next/dist/docs/` before editing route code (per `AGENTS.md`). Route params are async: `await ctx.params`.
- **Prisma 7, not 6.** Datasource `url` lives in `prisma.config.ts`, never `schema.prisma`. After schema changes: migration via `npx prisma migrate dev`, and if the dev server acts stale, `npx prisma generate` + delete `.next`.
- **Tests:** Vitest against the remote Neon **dev** branch (`.env`, gitignored); baseline 34 passing. Remote round-trips are slow (~80s full suite) and occasionally flake with connection timeouts — retry once before suspecting code.
- **Fail open:** any error inside the rate-limit check logs `console.error` and allows the request. Never let the limiter take the app down.
- **429 copy, verbatim:** `Too many attempts — please wait a few minutes and try again.`
- **Default policies, verbatim:** create-group 10/hour/IP; join-group 20/hour/IP; read-group 300/hour/IP; read-event 300/hour/IP.
- **No new dependencies.** Everything uses what's already installed.
- **Never run `npm audit fix --force`** (downgrades Next 16→9, Prisma 7→6).
- All timestamps in the limiter are app-side (`Date.now()`); the DB never supplies `now()`, so DB clock skew is irrelevant.
- Work on branch `feat/rate-limiting`. Commit after every task.

## File Structure

- `prisma/schema.prisma` — add the `RateLimit` model (counters only, no relations).
- `lib/rate-limit.ts` — NEW; the whole engine: `POLICIES`, `clientIp`, `rateLimit`, `enforceRateLimit`. Single responsibility: decide allow/block.
- `lib/api-helpers.ts` — `jsonError` gains an optional `headers` param (backward compatible).
- `app/api/groups/route.ts`, `app/api/groups/[code]/join/route.ts`, `app/api/groups/[code]/route.ts`, `app/api/events/[id]/route.ts` — one guard call each.
- `tests/rate-limit.test.ts` — NEW; unit tests of the engine + handler-level 429 tests.
- `tests/api.test.ts` — a `beforeAll` that raises policies for that suite (it hammers the real handlers from the shared `"local"` bucket and must never flake on limits).

---

### Task 1: RateLimit model + rate-limit engine (TDD)

**Files:**
- Modify: `prisma/schema.prisma` (append model at end of file)
- Create: `lib/rate-limit.ts`
- Test: `tests/rate-limit.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`.
- Produces (used by Tasks 2–3):
  - `type PolicyScope = "create-group" | "join-group" | "read-group" | "read-event"`
  - `interface RateLimitPolicy { limit: number; windowMs: number }`
  - `interface RateLimitResult { allowed: boolean; retryAfterSeconds: number }`
  - `POLICIES: Record<PolicyScope, RateLimitPolicy>` (deliberately mutable — tests inject tiny policies)
  - `clientIp(req: Request): string`
  - `rateLimit(scope: string, ip: string, policy: RateLimitPolicy): Promise<RateLimitResult>`

- [ ] **Step 1: Verify preconditions and rebase**

Run: `gh pr view 1 --repo hareemirfan2004-dev/Event_scheduler --json state,mergedAt`
Expected: `"state": "MERGED"`. **If not merged: STOP and report BLOCKED — do not implement this plan against the pre-merge codebase.**

Then:
```bash
git checkout feat/rate-limiting
git fetch origin
git rebase origin/main
```
Expected: clean rebase (this branch only adds new docs files so far). Then `npm install` (no-op check) and `npm test` once to confirm the 34-test baseline is green before any changes.

- [ ] **Step 2: Add the model to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
// Fixed-window rate-limit counters, keyed "<scope>:<ip>". No relations;
// rows are reset in place per window and swept opportunistically after 24h.
model RateLimit {
  key         String   @id
  windowStart DateTime
  count       Int
}
```

- [ ] **Step 3: Create and apply the migration (Neon dev branch)**

Run: `npx prisma migrate dev --name rate_limit`
Expected: new folder `prisma/migrations/<timestamp>_rate_limit/` containing a `CREATE TABLE "RateLimit"` migration; applies cleanly; client regenerates. Verify:

```bash
echo "SELECT count(*) FROM \"RateLimit\";" | npx prisma db execute --stdin
```
Expected: succeeds (0 rows).

- [ ] **Step 4: Write the failing tests**

Create `tests/rate-limit.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Unique prefix per run so repeat/parallel runs on the shared Neon dev
// branch never collide with stale counter rows.
const runId = crypto.randomUUID().slice(0, 8);
const scope = (name: string) => `test-${runId}-${name}`;

afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: runId } } });
});

describe("rateLimit", () => {
  it("allows up to the limit, then blocks with a retry hint", async () => {
    const policy = { limit: 2, windowMs: 60_000 };
    const s = scope("basic");
    expect((await rateLimit(s, "1.1.1.1", policy)).allowed).toBe(true);
    expect((await rateLimit(s, "1.1.1.1", policy)).allowed).toBe(true);
    const third = await rateLimit(s, "1.1.1.1", policy);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("resets after the window elapses", async () => {
    const policy = { limit: 1, windowMs: 3_000 };
    const s = scope("window");
    expect((await rateLimit(s, "1.1.1.1", policy)).allowed).toBe(true);
    expect((await rateLimit(s, "1.1.1.1", policy)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 3_200));
    expect((await rateLimit(s, "1.1.1.1", policy)).allowed).toBe(true);
  });

  it("keeps scopes and IPs in separate buckets", async () => {
    const policy = { limit: 1, windowMs: 60_000 };
    const a = scope("bucket-a");
    const b = scope("bucket-b");
    expect((await rateLimit(a, "1.1.1.1", policy)).allowed).toBe(true);
    expect((await rateLimit(a, "1.1.1.1", policy)).allowed).toBe(false); // same bucket
    expect((await rateLimit(a, "2.2.2.2", policy)).allowed).toBe(true); // other IP
    expect((await rateLimit(b, "1.1.1.1", policy)).allowed).toBe(true); // other scope
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    const req = new Request("http://test/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to the local bucket", () => {
    expect(
      clientIp(new Request("http://test/", { headers: { "x-real-ip": "198.51.100.2" } })),
    ).toBe("198.51.100.2");
    expect(clientIp(new Request("http://test/"))).toBe("local");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test -- rate-limit`
Expected: FAIL — cannot resolve `@/lib/rate-limit`.

- [ ] **Step 6: Implement `lib/rate-limit.ts`**

```ts
import { prisma } from "@/lib/db";

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number; // 0 when allowed
}

export type PolicyScope = "create-group" | "join-group" | "read-group" | "read-event";

const HOUR = 60 * 60 * 1000;

// Tune limits here — one place. Mutable on purpose: tests inject tiny
// policies instead of monkeypatching.
export const POLICIES: Record<PolicyScope, RateLimitPolicy> = {
  "create-group": { limit: 10, windowMs: HOUR },
  "join-group": { limit: 20, windowMs: HOUR },
  "read-group": { limit: 300, windowMs: HOUR },
  "read-event": { limit: 300, windowMs: HOUR },
};

// Client IP for rate-limit keying. On Vercel the first x-forwarded-for hop
// is the client; dev servers and the handler-direct test harness have no
// proxy headers and share one "local" bucket (accepted in the spec).
export function clientIp(req: Request): string {
  try {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) {
      const first = fwd.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  } catch {
    // fall through to the shared local bucket
  }
  return "local";
}

// Fixed-window counter: one atomic upsert per check, so concurrent requests
// can never corrupt a row (worst case they briefly overcount, which only
// blocks harder). All timestamps are app-side; the DB clock is never used.
export async function rateLimit(
  scope: string,
  ip: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const key = `${scope}:${ip}`;
  const now = new Date();
  const windowFloor = new Date(now.getTime() - policy.windowMs);
  try {
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimit" ("key", "windowStart", "count")
      VALUES (${key}, ${now}, 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."windowStart" <= ${windowFloor} THEN 1
                       ELSE "RateLimit"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimit"."windowStart" <= ${windowFloor} THEN ${now}
                             ELSE "RateLimit"."windowStart" END
      RETURNING "count", "windowStart"
    `;
    const { count, windowStart } = rows[0];

    if (Math.random() < 0.01) {
      // Opportunistic sweep of keys idle for a day. Fire-and-forget: never
      // awaited, never allowed to throw.
      void prisma.rateLimit
        .deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * HOUR) } } })
        .catch(() => {});
    }

    if (count <= policy.limit) return { allowed: true, retryAfterSeconds: 0 };
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStart.getTime() + policy.windowMs - now.getTime()) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  } catch (err) {
    // Fail open: a broken limiter must never take the app down.
    console.error("rate-limit check failed (failing open):", err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
```

Note: the fail-open catch is verified by review, not by a test — forcing a
DB error cheaply would mean mocking Prisma, which this suite deliberately
avoids (spec, Testing §3).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- rate-limit`
Expected: PASS — 5 tests (3 rateLimit + 2 clientIp).

- [ ] **Step 8: Full suite, lint, build**

Run: `npm test` → 39 passing (34 baseline + 5 new). `npm run lint` → clean. `npm run build` → green.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/rate-limit.ts tests/rate-limit.test.ts
git commit -m "feat(security): RateLimit model + fixed-window rate-limit engine"
```

---

### Task 2: Guard the unauthenticated POST routes (create group, join)

**Files:**
- Modify: `lib/api-helpers.ts:3-5` (`jsonError`)
- Modify: `lib/rate-limit.ts` (append `enforceRateLimit`)
- Modify: `app/api/groups/route.ts:5-7` (guard at top of `POST`)
- Modify: `app/api/groups/[code]/join/route.ts:5-9` (guard at top of `POST`)
- Modify: `tests/api.test.ts` (policy-raising `beforeAll`)
- Test: `tests/rate-limit.test.ts` (append handler-level test)

**Interfaces:**
- Consumes from Task 1: `rateLimit`, `clientIp`, `POLICIES`, `PolicyScope`.
- Produces (used by Task 3): `enforceRateLimit(scope: PolicyScope, req: Request): Promise<Response | null>` — null means proceed; a `Response` means return it as-is (429 with `Retry-After`).

- [ ] **Step 1: Write the failing handler-level test**

Append to `tests/rate-limit.test.ts` (add the two imports to the top of the file; add the shared `createdGroupIds` array and extend the existing `afterAll` — full shape shown):

```ts
// Add to the imports at the top of the file:
import { POST as createGroup } from "@/app/api/groups/route";
import { POLICIES } from "@/lib/rate-limit";

// Add below `const scope = ...`:
const createdGroupIds: string[] = [];

// EXTEND the existing afterAll to also delete created groups:
afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: { in: createdGroupIds } } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: runId } } });
});

// New describe block at the bottom of the file:
describe("route guard: POST /api/groups", () => {
  it("returns 429 with Retry-After once the create-group policy is exhausted", async () => {
    const original = POLICIES["create-group"];
    POLICIES["create-group"] = { limit: 2, windowMs: 60_000 };
    const ip = `test-ip-${runId}-create`;
    const make = () =>
      createGroup(
        new Request("http://test/api/groups", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ groupName: "RL Fam", memberName: "Tester" }),
        }),
      );
    try {
      const r1 = await make();
      expect(r1.status).toBe(201);
      createdGroupIds.push((await r1.json()).group.id);
      const r2 = await make();
      expect(r2.status).toBe(201);
      createdGroupIds.push((await r2.json()).group.id);
      const r3 = await make();
      expect(r3.status).toBe(429);
      expect(Number(r3.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect((await r3.json()).error).toBe(
        "Too many attempts — please wait a few minutes and try again.",
      );
    } finally {
      POLICIES["create-group"] = original;
    }
  });
});
```

(The unique `x-forwarded-for` keeps this test in its own bucket — it never
touches the shared `"local"` bucket, and its `runId` key is swept in
`afterAll`. The `contains: runId` filter in the existing `afterAll` already
covers the new `create-group:test-ip-<runId>-create` key.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rate-limit`
Expected: the new test FAILS — third request returns 201, not 429 (no guard exists yet). The Task 1 tests still pass.

- [ ] **Step 3: Extend `jsonError` with optional headers**

In `lib/api-helpers.ts`, replace:

```ts
export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}
```

with:

```ts
export function jsonError(
  status: number,
  error: string,
  headers?: Record<string, string>,
) {
  return Response.json({ error }, { status, headers });
}
```

(Backward compatible — every existing call site passes two arguments.)

- [ ] **Step 4: Append `enforceRateLimit` to `lib/rate-limit.ts`**

Add the import at the top: `import { jsonError } from "@/lib/api-helpers";`
(no cycle: `api-helpers` does not import `rate-limit`). Append:

```ts
// Route guard: null means proceed; a Response means return it as-is.
export async function enforceRateLimit(
  scope: PolicyScope,
  req: Request,
): Promise<Response | null> {
  const result = await rateLimit(scope, clientIp(req), POLICIES[scope]);
  if (result.allowed) return null;
  return jsonError(429, "Too many attempts — please wait a few minutes and try again.", {
    "Retry-After": String(result.retryAfterSeconds),
  });
}
```

- [ ] **Step 5: Guard the two POST routes**

`app/api/groups/route.ts` — add to imports:
`import { enforceRateLimit } from "@/lib/rate-limit";`
and make the first lines of `POST`:

```ts
export async function POST(req: Request) {
  const limited = await enforceRateLimit("create-group", req);
  if (limited) return limited;

  const body = await readJson(req);
  // ... rest unchanged
```

`app/api/groups/[code]/join/route.ts` — same import; first lines of `POST`:

```ts
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const limited = await enforceRateLimit("join-group", req);
  if (limited) return limited;

  const { code } = await ctx.params;
  // ... rest unchanged
```

- [ ] **Step 6: Shield the functional api suite from the shared local bucket**

In `tests/api.test.ts`, add `beforeAll` to the vitest import, add
`import { POLICIES } from "@/lib/rate-limit";`, and add directly under the
imports:

```ts
beforeAll(() => {
  // This suite drives the real handlers hard, all from the shared "local"
  // bucket (no proxy headers in the harness). Raise the limits so rate
  // limiting — tested in rate-limit.test.ts — can never flake these
  // functional tests. Vitest isolates test files in separate workers, so
  // this never leaks into rate-limit.test.ts.
  for (const scope of Object.keys(POLICIES) as (keyof typeof POLICIES)[]) {
    POLICIES[scope] = { ...POLICIES[scope], limit: 10_000 };
  }
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- rate-limit` → all pass, including the new 429 test.
Then: `npm test -- api` → 16 passing, none rate-limited.

- [ ] **Step 8: Full suite, lint, build**

Run: `npm test` → 40 passing. `npm run lint` → clean. `npm run build` → green.

- [ ] **Step 9: Commit**

```bash
git add lib/api-helpers.ts lib/rate-limit.ts app/api/groups/route.ts "app/api/groups/[code]/join/route.ts" tests/api.test.ts tests/rate-limit.test.ts
git commit -m "feat(security): rate-limit group creation and joins"
```

---

### Task 3: Guard the unauthenticated GET routes (read group, read event)

**Files:**
- Modify: `app/api/groups/[code]/route.ts:4-8` (`GET` — note the param is currently named `_req`)
- Modify: `app/api/events/[id]/route.ts:23-27` (`GET` — same rename; do NOT touch `DELETE`)
- Test: `tests/rate-limit.test.ts` (append handler-level test)

**Interfaces:**
- Consumes from Task 2: `enforceRateLimit(scope, req)`. No new exports.

- [ ] **Step 1: Write the failing handler-level test**

Append to `tests/rate-limit.test.ts` (one new import at the top):

```ts
// Add to the imports at the top of the file:
import { GET as getGroup } from "@/app/api/groups/[code]/route";

// New describe block at the bottom of the file:
describe("route guard: GET /api/groups/[code]", () => {
  it("returns 429 on group reads past the read-group policy", async () => {
    const original = POLICIES["read-group"];
    POLICIES["read-group"] = { limit: 2, windowMs: 60_000 };
    // Setup group is created from its own unique bucket so it can't
    // interfere with either policy under test.
    const setupRes = await createGroup(
      new Request("http://test/api/groups", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `test-ip-${runId}-read-setup`,
        },
        body: JSON.stringify({ groupName: "RL Read Fam", memberName: "Tester" }),
      }),
    );
    const { group } = await setupRes.json();
    createdGroupIds.push(group.id);

    const ip = `test-ip-${runId}-read`;
    const read = () =>
      getGroup(
        new Request(`http://test/api/groups/${group.code}`, {
          headers: { "x-forwarded-for": ip },
        }),
        { params: Promise.resolve({ code: group.code }) },
      );
    try {
      expect((await read()).status).toBe(200);
      expect((await read()).status).toBe(200);
      const r3 = await read();
      expect(r3.status).toBe(429);
      expect(Number(r3.headers.get("Retry-After"))).toBeGreaterThan(0);
    } finally {
      POLICIES["read-group"] = original;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rate-limit`
Expected: new test FAILS — third read returns 200 (no guard yet). All earlier tests pass.

- [ ] **Step 3: Guard the two GET routes**

`app/api/groups/[code]/route.ts` — add
`import { enforceRateLimit } from "@/lib/rate-limit";`, rename the unused
`_req` param to `req`, and guard:

```ts
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const limited = await enforceRateLimit("read-group", req);
  if (limited) return limited;

  const { code } = await ctx.params;
  // ... rest unchanged
```

`app/api/events/[id]/route.ts` — same import; in `GET` only (leave `DELETE`
alone — it is token-gated and out of scope), rename `_req` to `req` and guard:

```ts
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = await enforceRateLimit("read-event", req);
  if (limited) return limited;

  const { id } = await ctx.params;
  // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- rate-limit` → all pass. `npm test -- api` → 16 passing (the `beforeAll` shield from Task 2 covers the read scopes too).

- [ ] **Step 5: Full suite, lint, build**

Run: `npm test` → 41 passing. `npm run lint` → clean. `npm run build` → green.

- [ ] **Step 6: Commit**

```bash
git add "app/api/groups/[code]/route.ts" "app/api/events/[id]/route.ts" tests/rate-limit.test.ts
git commit -m "feat(security): rate-limit unauthenticated group/event reads"
```

---

### Task 4: Live verification (no code changes, no commit)

**Files:** none modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Check port 3000 is free (`netstat -ano | findstr :3000`; kill stray `next` PIDs). Run `npm run dev` in the background against the Neon dev branch.

- [ ] **Step 2: Hammer create-group past the real policy**

```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/groups -H "content-type: application/json" -d '{"groupName":"RL Probe","memberName":"T"}'; done
```
Expected: ten `201`s followed by `429`s (all twelve share the `"local"` bucket). Then:

```bash
curl -si -X POST http://localhost:3000/api/groups -H "content-type: application/json" -d '{"groupName":"RL Probe","memberName":"T"}' | head -8
```
Expected: `429`, a `Retry-After: <seconds>` header, and body `{"error":"Too many attempts — please wait a few minutes and try again."}`.

- [ ] **Step 3: Confirm the UI surfaces the message**

Open http://localhost:3000 in the browser (Playwright MCP), open the create-group form (on the hub it's inside "＋ New group / Join by code"), submit a new group while the bucket is still exhausted, and confirm the form shows the friendly copy instead of crashing. Confirm normal reads still work (open an existing group page — read-group is at 300/h, untouched).

- [ ] **Step 4: Clean up**

```bash
echo "DELETE FROM \"Group\" WHERE name = 'RL Probe';" | npx prisma db execute --stdin
echo "DELETE FROM \"RateLimit\";" | npx prisma db execute --stdin
```
Kill the dev-server PID (stopping the background task does not kill `next dev` on this machine; confirm port 3000 is free), close the browser, delete `.playwright-mcp` artifacts. Record all evidence in the task report.

---

## Final verification

- [ ] `npm test` → 41 passing. `npm run build` → green. `npm run lint` → clean.
- [ ] Push and open a PR (`feat/rate-limiting` → `main`). The migration is additive, so merging deploys with no timing constraints.

## Self-review notes (coverage)

Spec → tasks: data model + engine + policies + IP extraction + sweep + fail-open → Task 1; 429/`Retry-After`/copy + `jsonError` headers + POST guards + policy-injection test mechanism (mutable `POLICIES` map) + local-bucket shielding for the functional suite → Task 2; GET guards → Task 3; manual rollout checks (curl loop + UI message) → Task 4. Fail-open is review-verified per spec Testing §3 (no Prisma mocking). Sequencing precondition (PR #1 merged, rebase) → Task 1 Step 1 + Global Constraints.
