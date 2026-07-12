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
