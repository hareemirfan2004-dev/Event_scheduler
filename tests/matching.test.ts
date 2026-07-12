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
