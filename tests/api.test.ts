import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as createGroup } from "@/app/api/groups/route";
import { GET as getGroup } from "@/app/api/groups/[code]/route";
import { POST as joinGroup } from "@/app/api/groups/[code]/join/route";
import { POST as createEvent } from "@/app/api/groups/[code]/events/route";
import { GET as getEvent, DELETE as deleteEvent } from "@/app/api/events/[id]/route";
import { PUT as putAvailability } from "@/app/api/events/[id]/availability/route";
import { POLICIES } from "@/lib/rate-limit";

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

const createdGroupIds: string[] = [];

afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: { in: createdGroupIds } } });
  await prisma.rateLimit.deleteMany({ where: { key: { endsWith: ":local" } } });
});

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

async function makeGroup(groupName = "Test Fam", memberName = "Hareem") {
  const res = await createGroup(
    jsonRequest("http://test/api/groups", "POST", { groupName, memberName }),
  );
  const data = await res.json();
  if (data.group?.id) createdGroupIds.push(data.group.id);
  return { res, data };
}

describe("POST /api/groups + GET /api/groups/[code]", () => {
  it("creates a group and returns an invite code and member token", async () => {
    const { res, data } = await makeGroup();
    expect(res.status).toBe(201);
    expect(data.group.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(data.group.name).toBe("Test Fam");
    expect(data.memberToken).toBeTruthy();

    const getRes = await getGroup(
      new Request(`http://test/api/groups/${data.group.code}`),
      ctx({ code: data.group.code }),
    );
    expect(getRes.status).toBe(200);
    const g = await getRes.json();
    expect(g.group.name).toBe("Test Fam");
    expect(g.members.map((m: { name: string }) => m.name)).toEqual(["Hareem"]);
    expect(g.events).toEqual([]);
    // Tokens must never leak through the group endpoint.
    expect(JSON.stringify(g)).not.toContain(data.memberToken);
  });

  it("rejects blank names and unknown codes", async () => {
    const { res } = await makeGroup("  ", "Hareem");
    expect(res.status).toBe(400);

    const getRes = await getGroup(
      new Request("http://test/api/groups/NOPE99"),
      ctx({ code: "NOPE99" }),
    );
    expect(getRes.status).toBe(404);
  });
});

describe("POST /api/groups/[code]/join", () => {
  it("adds a new member and returns their token", async () => {
    const { data } = await makeGroup();
    const res = await joinGroup(
      jsonRequest(`http://test/api/groups/${data.group.code}/join`, "POST", {
        name: "Ali",
      }),
      ctx({ code: data.group.code }),
    );
    expect(res.status).toBe(201);
    const joined = await res.json();
    expect(joined.memberToken).toBeTruthy();
    expect(joined.memberToken).not.toBe(data.memberToken);
  });

  it("flags a taken name, and hands back the same member when claimed", async () => {
    const { data } = await makeGroup();
    const clash = await joinGroup(
      jsonRequest(`http://test/api/groups/${data.group.code}/join`, "POST", {
        name: "hareem", // case-insensitive clash with creator "Hareem"
      }),
      ctx({ code: data.group.code }),
    );
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toBe("name_taken");

    const claim = await joinGroup(
      jsonRequest(`http://test/api/groups/${data.group.code}/join`, "POST", {
        name: "hareem",
        claimExisting: true,
      }),
      ctx({ code: data.group.code }),
    );
    expect(claim.status).toBe(200);
    const claimed = await claim.json();
    // Same identity: the original creator token comes back.
    expect(claimed.memberToken).toBe(data.memberToken);
    expect(claimed.memberId).toBe(data.memberId);
  });

  it("404s for an unknown group code", async () => {
    const res = await joinGroup(
      jsonRequest("http://test/api/groups/NOPE99/join", "POST", { name: "X" }),
      ctx({ code: "NOPE99" }),
    );
    expect(res.status).toBe(404);
  });
});

const validEvent = {
  title: "Summer trip",
  mode: "DAY",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-31",
  durationDays: 3,
};

describe("POST /api/groups/[code]/events", () => {
  it("requires a valid member token", async () => {
    const { data } = await makeGroup();
    const res = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        validEvent,
      ),
      ctx({ code: data.group.code }),
    );
    expect(res.status).toBe(401);
  });

  it("creates an event and rejects invalid payloads", async () => {
    const { data } = await makeGroup();
    const auth = { "x-member-token": data.memberToken };

    const res = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        validEvent,
        auth,
      ),
      ctx({ code: data.group.code }),
    );
    expect(res.status).toBe(201);
    const { event } = await res.json();
    expect(event).toMatchObject({ title: "Summer trip", durationDays: 3 });

    const bad = [
      { ...validEvent, mode: "WEEK" },
      { ...validEvent, windowEnd: "2026-07-01" }, // ends before it starts
      { ...validEvent, title: "  " },
      { ...validEvent, windowStart: "01-08-2026" },
      { ...validEvent, durationDays: 0 },
    ];
    for (const payload of bad) {
      const badRes = await createEvent(
        jsonRequest(
          `http://test/api/groups/${data.group.code}/events`,
          "POST",
          payload,
          auth,
        ),
        ctx({ code: data.group.code }),
      );
      expect(badRes.status, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe("GET /api/events/[id]", () => {
  it("returns the event with members and computed results", async () => {
    const { data } = await makeGroup();
    const created = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        { ...validEvent, windowEnd: "2026-08-05", durationDays: 2 },
        { "x-member-token": data.memberToken },
      ),
      ctx({ code: data.group.code }),
    );
    const { event } = await created.json();

    const res = await getEvent(
      new Request(`http://test/api/events/${event.id}`),
      ctx({ id: event.id }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.event.title).toBe("Summer trip");
    expect(payload.group.code).toBe(data.group.code);
    expect(payload.members).toHaveLength(1);
    // Nobody has responded yet.
    expect(payload.results.respondedCount).toBe(0);
    expect(payload.results.pendingMemberIds).toEqual([data.memberId]);
    // 5-day window, 2-day duration -> 4 candidate windows.
    expect(payload.results.windows).toHaveLength(4);

    const missing = await getEvent(
      new Request("http://test/api/events/nope"),
      ctx({ id: "nope" }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("PUT /api/events/[id]/availability", () => {
  async function makeEventSetup() {
    const { data } = await makeGroup();
    const created = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        { ...validEvent, windowEnd: "2026-08-05", durationDays: 1 },
        { "x-member-token": data.memberToken },
      ),
      ctx({ code: data.group.code }),
    );
    const { event } = await created.json();
    return { data, event };
  }

  it("requires a member token", async () => {
    const { event } = await makeEventSetup();
    const res = await putAvailability(
      jsonRequest(`http://test/api/events/${event.id}/availability`, "PUT", {
        freeDates: ["2026-08-02"],
      }),
      ctx({ id: event.id }),
    );
    expect(res.status).toBe(401);
  });

  it("saves free days, marks the member responded, and replaces on re-save", async () => {
    const { data, event } = await makeEventSetup();
    const auth = { "x-member-token": data.memberToken };

    const res = await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeDates: ["2026-08-02", "2026-08-03"] },
        auth,
      ),
      ctx({ id: event.id }),
    );
    expect(res.status).toBe(200);

    let payload = await (
      await getEvent(
        new Request(`http://test/api/events/${event.id}`),
        ctx({ id: event.id }),
      )
    ).json();
    expect(payload.results.respondedCount).toBe(1);
    expect(payload.results.pendingMemberIds).toEqual([]);
    const aug2 = payload.results.heatmap.find(
      (h: { date: string }) => h.date === "2026-08-02",
    );
    expect(aug2.freeCount).toBe(1);

    // Re-saving replaces, not accumulates.
    await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeDates: ["2026-08-05"] },
        auth,
      ),
      ctx({ id: event.id }),
    );
    payload = await (
      await getEvent(
        new Request(`http://test/api/events/${event.id}`),
        ctx({ id: event.id }),
      )
    ).json();
    const dates = payload.freeEntries.map((e: { date: string }) => e.date);
    expect(dates).toEqual(["2026-08-05"]);
  });

  it("rejects malformed dates and slots", async () => {
    const { data, event } = await makeEventSetup();
    const auth = { "x-member-token": data.memberToken };

    const badDate = await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeDates: ["not-a-date"] },
        auth,
      ),
      ctx({ id: event.id }),
    );
    expect(badDate.status).toBe(400);

    const badSlot = await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeSlots: [{ date: "2026-08-02", slot: "NIGHT" }] },
        auth,
      ),
      ctx({ id: event.id }),
    );
    expect(badSlot.status).toBe(400);
  });

  it("404s when saving availability for an unknown event", async () => {
    const { data } = await makeGroup();
    const res = await putAvailability(
      jsonRequest(
        "http://test/api/events/nope/availability",
        "PUT",
        { freeDates: ["2026-08-02"] },
        { "x-member-token": data.memberToken },
      ),
      ctx({ id: "nope" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns freeEntries and ranks the all-free window first; empty saves still count as responses", async () => {
    const { data } = await makeGroup("Test Fam", "Ali");
    const aliToken = data.memberToken;
    const joined = await joinGroup(
      jsonRequest(`http://test/api/groups/${data.group.code}/join`, "POST", {
        name: "Bina",
      }),
      ctx({ code: data.group.code }),
    );
    const binaToken = (await joined.json()).memberToken;

    const created = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        { ...validEvent, durationDays: 2 },
        { "x-member-token": aliToken },
      ),
      ctx({ code: data.group.code }),
    );
    const { event } = await created.json();

    // Save availability as FREE days.
    const save = await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeDates: ["2026-08-15", "2026-08-16"] },
        { "x-member-token": aliToken },
      ),
      ctx({ id: event.id }),
    );
    expect(save.status).toBe(200);

    // GET returns freeEntries and ranks the all-free window first.
    const ev = await (
      await getEvent(
        new Request(`http://test/api/events/${event.id}`),
        ctx({ id: event.id }),
      )
    ).json();
    expect(ev.freeEntries.length).toBeGreaterThan(0);
    expect(ev.results.windows[0].startDate).toBe("2026-08-15");

    // Empty free set still records a response ("can't make any").
    const empty = await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeDates: [] },
        { "x-member-token": binaToken },
      ),
      ctx({ id: event.id }),
    );
    expect(empty.status).toBe(200);
    const ev2 = await (
      await getEvent(
        new Request(`http://test/api/events/${event.id}`),
        ctx({ id: event.id }),
      )
    ).json();
    expect(ev2.results.respondedCount).toBe(2);
  });
});

describe("SLOT-mode round trip", () => {
  it("saves free slots (incl. ALL) and ranks slots from them", async () => {
    const { data } = await makeGroup();
    const created = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        {
          title: "Dinner",
          mode: "SLOT",
          windowStart: "2026-08-01",
          windowEnd: "2026-08-03",
        },
        { "x-member-token": data.memberToken },
      ),
      ctx({ code: data.group.code }),
    );
    const { event } = await created.json();

    const save = await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        {
          freeSlots: [
            { date: "2026-08-01", slot: "ALL" },
            { date: "2026-08-02", slot: "MORNING" },
          ],
        },
        { "x-member-token": data.memberToken },
      ),
      ctx({ id: event.id }),
    );
    expect(save.status).toBe(200);

    const payload = await (
      await getEvent(
        new Request(`http://test/api/events/${event.id}`),
        ctx({ id: event.id }),
      )
    ).json();

    // Rows persist exactly as saved — ALL stays one row, no expansion.
    const rows = payload.freeEntries
      .map((e: { date: string; slot: string }) => `${e.date}|${e.slot}`)
      .sort();
    expect(rows).toEqual(["2026-08-01|ALL", "2026-08-02|MORNING"]);

    // ALL frees every slot of its day; an individual slot only itself.
    const score = (date: string, slot: string) =>
      payload.results.slots.find(
        (s: { date: string; slot: string }) => s.date === date && s.slot === slot,
      )!.score;
    expect(score("2026-08-01", "EVENING")).toBe(1);
    expect(score("2026-08-02", "MORNING")).toBe(1);
    expect(score("2026-08-02", "EVENING")).toBe(0);

    // Ranking: earliest max-score slot first; DAY windows stay empty.
    expect(payload.results.slots[0]).toMatchObject({
      date: "2026-08-01",
      slot: "MORNING",
      score: 1,
    });
    expect(payload.results.windows).toEqual([]);
    expect(payload.results.respondedCount).toBe(1);
  });
});

describe("DELETE /api/events/[id]", () => {
  async function makeEventWithAvailability() {
    const { data } = await makeGroup();
    const created = await createEvent(
      jsonRequest(
        `http://test/api/groups/${data.group.code}/events`,
        "POST",
        validEvent,
        { "x-member-token": data.memberToken },
      ),
      ctx({ code: data.group.code }),
    );
    const { event } = await created.json();
    await putAvailability(
      jsonRequest(
        `http://test/api/events/${event.id}/availability`,
        "PUT",
        { freeDates: ["2026-08-02"] },
        { "x-member-token": data.memberToken },
      ),
      ctx({ id: event.id }),
    );
    return { data, event };
  }

  it("requires a member token of the event's own group", async () => {
    const { event } = await makeEventWithAvailability();

    const noToken = await deleteEvent(
      new Request(`http://test/api/events/${event.id}`, { method: "DELETE" }),
      ctx({ id: event.id }),
    );
    expect(noToken.status).toBe(401);

    // A member of a different group is also rejected.
    const { data: outsider } = await makeGroup("Other Fam", "Zara");
    const wrongGroup = await deleteEvent(
      new Request(`http://test/api/events/${event.id}`, {
        method: "DELETE",
        headers: { "x-member-token": outsider.memberToken },
      }),
      ctx({ id: event.id }),
    );
    expect(wrongGroup.status).toBe(401);

    // Event still exists after both rejected attempts.
    const stillThere = await getEvent(
      new Request(`http://test/api/events/${event.id}`),
      ctx({ id: event.id }),
    );
    expect(stillThere.status).toBe(200);
  });

  it("deletes the event and its availability data for any group member", async () => {
    const { data, event } = await makeEventWithAvailability();

    // A second member (not the creator) may delete — family trust model.
    const ali = await joinGroup(
      jsonRequest(`http://test/api/groups/${data.group.code}/join`, "POST", {
        name: "Ali",
      }),
      ctx({ code: data.group.code }),
    );
    const aliToken = (await ali.json()).memberToken;

    const res = await deleteEvent(
      new Request(`http://test/api/events/${event.id}`, {
        method: "DELETE",
        headers: { "x-member-token": aliToken },
      }),
      ctx({ id: event.id }),
    );
    expect(res.status).toBe(200);

    const gone = await getEvent(
      new Request(`http://test/api/events/${event.id}`),
      ctx({ id: event.id }),
    );
    expect(gone.status).toBe(404);

    // Cascade cleaned up the availability rows.
    const leftoverFree = await prisma.availabilityEntry.count({
      where: { eventId: event.id },
    });
    const leftoverResponses = await prisma.response.count({
      where: { eventId: event.id },
    });
    expect(leftoverFree).toBe(0);
    expect(leftoverResponses).toBe(0);
  });

  it("404s for an already-deleted or unknown event", async () => {
    const { data, event } = await makeEventWithAvailability();
    const auth = { "x-member-token": data.memberToken };

    await deleteEvent(
      new Request(`http://test/api/events/${event.id}`, {
        method: "DELETE",
        headers: auth,
      }),
      ctx({ id: event.id }),
    );
    const again = await deleteEvent(
      new Request(`http://test/api/events/${event.id}`, {
        method: "DELETE",
        headers: auth,
      }),
      ctx({ id: event.id }),
    );
    expect(again.status).toBe(404);
  });
});
