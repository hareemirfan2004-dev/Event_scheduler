import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit, POLICIES } from "@/lib/rate-limit";
import { POST as createGroup } from "@/app/api/groups/route";
import { GET as getGroup } from "@/app/api/groups/[code]/route";

// Unique prefix per run so repeat/parallel runs on the shared Neon dev
// branch never collide with stale counter rows.
const runId = crypto.randomUUID().slice(0, 8);
const scope = (name: string) => `test-${runId}-${name}`;
const createdGroupIds: string[] = [];

afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: { in: createdGroupIds } } });
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

  it("caps forged header values at 64 chars", () => {
    const long = "x".repeat(500);
    expect(
      clientIp(new Request("http://test/", { headers: { "x-forwarded-for": long } })).length,
    ).toBeLessThanOrEqual(64);
    expect(
      clientIp(new Request("http://test/", { headers: { "x-real-ip": long } })).length,
    ).toBeLessThanOrEqual(64);
  });
});

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
