import { describe, expect, it } from "vitest";
import { computeMatches } from "@/lib/matching";

const members = [
  { id: "m1", name: "Ana" },
  { id: "m2", name: "Bilal" },
];

describe("computeMatches — DAY mode", () => {
  it("with no busy entries, every day is a full-attendance window", () => {
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-03",
      durationDays: 1,
      members,
      respondedMemberIds: ["m1", "m2"],
      busyEntries: [],
    });

    expect(result.windows).toHaveLength(3);
    expect(result.windows[0]).toMatchObject({
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      score: 2,
      availableMemberIds: ["m1", "m2"],
    });
  });

  it("ranks days by attendance (busy members excluded and listed)", () => {
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-03",
      durationDays: 1,
      members,
      respondedMemberIds: ["m1", "m2"],
      busyEntries: [
        { memberId: "m1", date: "2026-08-01", slot: "ALL" },
        { memberId: "m2", date: "2026-08-01", slot: "ALL" },
        { memberId: "m2", date: "2026-08-03", slot: "ALL" },
      ],
    });

    // Aug 2: both free. Aug 3: only m1. Aug 1: nobody.
    expect(result.windows.map((w) => w.startDate)).toEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-01",
    ]);
    expect(result.windows[1]).toMatchObject({
      score: 1,
      availableMemberIds: ["m1"],
      unavailableMemberIds: ["m2"],
    });
  });

  it("finds consecutive-day windows; one busy day breaks the whole window", () => {
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-05",
      durationDays: 3,
      members,
      respondedMemberIds: ["m1", "m2"],
      // m2 busy Aug 2 → windows containing Aug 2 lose m2.
      busyEntries: [{ memberId: "m2", date: "2026-08-02", slot: "ALL" }],
    });

    // Candidate starts: Aug 1, 2, 3 (a window may not overflow past windowEnd).
    expect(result.windows).toHaveLength(3);
    expect(result.windows[0]).toMatchObject({
      startDate: "2026-08-03",
      endDate: "2026-08-05",
      score: 2,
    });
    const aug1 = result.windows.find((w) => w.startDate === "2026-08-01");
    expect(aug1).toMatchObject({
      endDate: "2026-08-03",
      score: 1,
      unavailableMemberIds: ["m2"],
    });
  });

  it("excludes members who never responded and reports them as pending", () => {
    const threeMembers = [...members, { id: "m3", name: "Chandni" }];
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-01",
      durationDays: 1,
      members: threeMembers,
      respondedMemberIds: ["m1", "m2"], // m3 never saved availability
      busyEntries: [],
    });

    expect(result.respondedCount).toBe(2);
    expect(result.totalMembers).toBe(3);
    expect(result.pendingMemberIds).toEqual(["m3"]);
    // m3 counts nowhere in the windows.
    expect(result.windows[0].score).toBe(2);
    expect(result.windows[0].availableMemberIds).toEqual(["m1", "m2"]);
  });

  it("returns a per-day heatmap of free counts, unaffected by duration", () => {
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-03",
      durationDays: 2,
      members,
      respondedMemberIds: ["m1", "m2"],
      busyEntries: [{ memberId: "m2", date: "2026-08-02", slot: "ALL" }],
    });

    expect(result.heatmap).toEqual([
      { date: "2026-08-01", freeCount: 2 },
      { date: "2026-08-02", freeCount: 1 },
      { date: "2026-08-03", freeCount: 2 },
    ]);
  });
});

describe("computeMatches — SLOT mode", () => {
  it("ranks date+slot combos; an ALL-day busy entry blocks every slot", () => {
    const result = computeMatches({
      mode: "SLOT",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-02",
      durationDays: 1,
      members,
      respondedMemberIds: ["m1", "m2"],
      busyEntries: [
        { memberId: "m1", date: "2026-08-01", slot: "MORNING" },
        { memberId: "m2", date: "2026-08-02", slot: "ALL" },
      ],
    });

    // 2 days x 3 slots.
    expect(result.slots).toHaveLength(6);
    // Best: Aug 1 afternoon/evening (both free), afternoon first in slot order.
    expect(result.slots[0]).toMatchObject({
      date: "2026-08-01",
      slot: "AFTERNOON",
      score: 2,
    });
    // m2's ALL entry blocks all three slots on Aug 2.
    for (const slot of ["MORNING", "AFTERNOON", "EVENING"]) {
      const s = result.slots.find(
        (x) => x.date === "2026-08-02" && x.slot === slot,
      );
      expect(s).toMatchObject({ score: 1, unavailableMemberIds: ["m2"] });
    }
    // Day windows don't apply in slot mode.
    expect(result.windows).toEqual([]);
  });
});

describe("computeMatches — edge cases", () => {
  it("returns no windows when the required duration exceeds the window", () => {
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-02",
      durationDays: 5,
      members,
      respondedMemberIds: ["m1", "m2"],
      busyEntries: [],
    });
    expect(result.windows).toEqual([]);
    expect(result.heatmap).toHaveLength(2);
  });

  it("returns empty results for an inverted date window", () => {
    const result = computeMatches({
      mode: "DAY",
      windowStart: "2026-08-05",
      windowEnd: "2026-08-01",
      durationDays: 1,
      members,
      respondedMemberIds: ["m1"],
      busyEntries: [],
    });
    expect(result.windows).toEqual([]);
    expect(result.heatmap).toEqual([]);
  });
});
