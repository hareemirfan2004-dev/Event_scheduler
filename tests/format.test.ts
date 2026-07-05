import { describe, expect, it } from "vitest";
import { fmtDate, fmtRange } from "@/lib/format";

describe("date formatting", () => {
  it("formats a single date with weekday", () => {
    expect(fmtDate("2026-08-08")).toBe("Sat 8 Aug");
  });

  it("collapses a one-day range and spells out longer ones", () => {
    expect(fmtRange("2026-08-08", "2026-08-08")).toBe("Sat 8 Aug");
    expect(fmtRange("2026-08-08", "2026-08-10")).toBe("Sat 8 Aug – Mon 10 Aug");
  });
});
