"use client";

import { Fragment, type ReactNode } from "react";
import type { DayCell, MonthGrid } from "@/lib/calendar";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Generic month grid; the caller decides how each in-window day renders.
 * Pass `onWeekLabel` to render a small leading "▸" per week that calls back
 * with that week's in-window dates — a bulk row-toggle affordance.
 */
export function MonthCalendar({
  months,
  renderDay,
  onWeekLabel,
}: {
  months: MonthGrid[];
  renderDay: (cell: DayCell) => ReactNode;
  onWeekLabel?: (dates: string[]) => void;
}) {
  return (
    <div className="space-y-6">
      {months.map((m) => (
        <section key={m.label}>
          <h3 className="mb-2 font-mono text-sm font-medium tracking-wide text-ink-soft">
            {m.label}
          </h3>
          <div
            className={`grid gap-1 ${
              onWeekLabel ? "grid-cols-[16px_repeat(7,minmax(0,1fr))]" : "grid-cols-7"
            }`}
          >
            {onWeekLabel && <div />}
            {WEEKDAYS.map((d, i) => (
              <div
                key={`${d}${i}`}
                className="pb-1 text-center text-[11px] font-medium text-ink-soft/70"
              >
                {d}
              </div>
            ))}
            {m.weeks.map((week, wi) => (
              <Fragment key={`wk-${wi}`}>
                {onWeekLabel && (
                  <button
                    type="button"
                    aria-label="Toggle this week"
                    onClick={() =>
                      onWeekLabel(
                        week
                          .filter((c): c is DayCell => c != null && c.inWindow)
                          .map((c) => c.date),
                      )
                    }
                    className="flex items-center justify-center text-ink-soft/50 hover:text-leaf"
                  >
                    ▸
                  </button>
                )}
                {week.map((cell, i) =>
                  cell === null ? (
                    <div key={`pad-${wi}-${i}`} />
                  ) : (
                    <div key={cell.date}>{renderDay(cell)}</div>
                  ),
                )}
              </Fragment>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
