import { describe, it, expect } from "vitest";
import { fillRange, weekendDays, isWeekend, toggleDays } from "@/lib/selection";

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
});
