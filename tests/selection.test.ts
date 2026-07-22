import { describe, it, expect } from "vitest";
import { fillRange, weekendDays, isWeekend, toggleDays, toggleSlot } from "@/lib/selection";

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
  it("fillRange with the same start and end returns just that day", () => {
    expect(fillRange("2026-08-03", "2026-08-03", window)).toEqual(["2026-08-03"]);
  });
  it("fillRange spans a year boundary", () => {
    const nye = ["2026-12-30","2026-12-31","2027-01-01","2027-01-02"];
    expect(fillRange("2026-12-31", "2027-01-01", nye))
      .toEqual(["2026-12-31","2027-01-01"]);
  });
  it("toggleDays with no days is a no-op", () => {
    expect([...toggleDays(new Set(["2026-08-01"]), [])]).toEqual(["2026-08-01"]);
  });
});

describe("toggleSlot", () => {
  const D = "2026-08-01";
  const cases: { name: string; before: string[]; key: string; after: string[] }[] = [
    { name: "adds a slot to an empty day",
      before: [], key: `${D}|MORNING`, after: [`${D}|MORNING`] },
    { name: "removes a slot that was free",
      before: [`${D}|MORNING`], key: `${D}|MORNING`, after: [] },
    { name: "expands ALL into the other two slots when un-freeing one",
      before: [`${D}|ALL`], key: `${D}|MORNING`,
      after: [`${D}|AFTERNOON`, `${D}|EVENING`] },
    { name: "leaves other days' ALL keys alone",
      before: [`${D}|ALL`, "2026-08-02|ALL"], key: `${D}|EVENING`,
      after: ["2026-08-02|ALL", `${D}|MORNING`, `${D}|AFTERNOON`] },
    { name: "plain toggle on a day with individual slots",
      before: [`${D}|MORNING`], key: `${D}|EVENING`,
      after: [`${D}|MORNING`, `${D}|EVENING`] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const next = toggleSlot(new Set(c.before), c.key);
      expect([...next].sort()).toEqual([...c.after].sort());
    });
  }
  it("does not mutate its input", () => {
    const before = new Set([`${D}|ALL`]);
    toggleSlot(before, `${D}|MORNING`);
    expect([...before]).toEqual([`${D}|ALL`]);
  });
});
