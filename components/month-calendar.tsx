"use client";

import type { ReactNode } from "react";
import type { DayCell, MonthGrid } from "@/lib/calendar";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Generic month grid; the caller decides how each in-window day renders. */
export function MonthCalendar({
  months,
  renderDay,
}: {
  months: MonthGrid[];
  renderDay: (cell: DayCell) => ReactNode;
}) {
  return (
    <div className="space-y-6">
      {months.map((m) => (
        <section key={m.label}>
          <h3 className="mb-2 font-mono text-sm font-medium tracking-wide text-ink-soft">
            {m.label}
          </h3>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d, i) => (
              <div
                key={`${d}${i}`}
                className="pb-1 text-center text-[11px] font-medium text-ink-soft/70"
              >
                {d}
              </div>
            ))}
            {m.weeks.flat().map((cell, i) =>
              cell === null ? (
                <div key={`pad-${i}`} />
              ) : (
                <div key={cell.date}>{renderDay(cell)}</div>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
