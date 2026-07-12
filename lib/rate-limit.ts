import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";

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
