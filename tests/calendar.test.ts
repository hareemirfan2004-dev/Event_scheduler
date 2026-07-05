import { describe, expect, it } from "vitest";
import { monthsInRange } from "@/lib/calendar";

describe("monthsInRange", () => {
  it("splits a cross-month window into aligned month grids", () => {
    const months = monthsInRange("2026-08-20", "2026-09-10");

    expect(months.map((m) => m.label)).toEqual([
      "August 2026",
      "September 2026",
    ]);

    const august = months[0];
    // Aug 1, 2026 is a Saturday -> five leading pads in a Monday-start week.
    expect(august.weeks[0].slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(august.weeks[0][5]).toMatchObject({
      date: "2026-08-01",
      dayOfMonth: 1,
      inWindow: false,
    });

    const allDays = august.weeks.flat().filter((d) => d !== null);
    expect(allDays).toHaveLength(31);
    // Only Aug 20-31 fall inside the window.
    expect(allDays.filter((d) => d.inWindow).map((d) => d.dayOfMonth)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 20),
    );

    const september = months[1];
    const sepDays = september.weeks.flat().filter((d) => d !== null);
    expect(sepDays.filter((d) => d.inWindow)).toHaveLength(10);
    // Every week row is exactly 7 cells.
    for (const m of months) {
      for (const week of m.weeks) expect(week).toHaveLength(7);
    }
  });

  it("handles a window inside a single month", () => {
    const months = monthsInRange("2026-08-05", "2026-08-07");
    expect(months).toHaveLength(1);
    const days = months[0].weeks.flat().filter((d) => d !== null);
    expect(days.filter((d) => d.inWindow).map((d) => d.date)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });
});
