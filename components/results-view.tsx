"use client";

import { useMemo } from "react";
import { monthsInRange } from "@/lib/calendar";
import { fmtDate, fmtRange } from "@/lib/format";
import type { EventPayload } from "@/lib/client/types";
import { PenCircle } from "@/components/pen";
import { MonthCalendar } from "@/components/month-calendar";

const SLOT_LABEL: Record<string, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
};

export function ResultsView({ payload }: { payload: EventPayload }) {
  const { event, members, results } = payload;
  const nameOf = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

  const pendingNames = results.pendingMemberIds
    .map((id) => nameOf.get(id) ?? "?")
    .join(", ");

  if (results.respondedCount === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-card p-6 text-center">
        <p className="font-display text-lg font-semibold">No answers yet</p>
        <p className="mt-1 text-sm text-ink-soft">
          Fill in your own days first, then share the invite link so the
          others can too.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-soft">
        <strong className="text-ink">
          {results.respondedCount} of {results.totalMembers}
        </strong>{" "}
        filled in
        {pendingNames && (
          <>
            {" "}
            — waiting for <span className="text-ink">{pendingNames}</span>
          </>
        )}
      </p>

      {event.mode === "DAY" ? (
        <DayResults payload={payload} nameOf={nameOf} />
      ) : (
        <SlotResults payload={payload} nameOf={nameOf} />
      )}
    </div>
  );
}

function missingLine(
  ids: string[],
  nameOf: Map<string, string>,
): string | null {
  if (ids.length === 0) return null;
  const names = ids.map((id) => nameOf.get(id) ?? "?");
  if (names.length <= 3) return `without ${names.join(", ")}`;
  return `without ${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

function DayResults({
  payload,
  nameOf,
}: {
  payload: EventPayload;
  nameOf: Map<string, string>;
}) {
  const { event, results } = payload;
  const top = results.windows.filter((w) => w.score > 0).slice(0, 5);
  const months = monthsInRange(event.windowStart, event.windowEnd);
  const heat = new Map(results.heatmap.map((h) => [h.date, h.freeCount]));

  return (
    <>
      <section>
        <h3 className="font-display text-lg font-semibold">Best dates</h3>
        {top.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            No date works yet — more answers might change that.
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {top.map((w, i) => {
              const everyone = w.score === results.respondedCount;
              return (
                <li
                  key={w.startDate}
                  className="flex items-center gap-3 rounded-2xl border border-hairline bg-card p-3"
                >
                  <div className="relative shrink-0 px-2 py-1">
                    <span className="relative font-mono text-sm font-semibold">
                      {fmtRange(w.startDate, w.endDate)}
                    </span>
                    {i === 0 && <PenCircle />}
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    {everyone ? (
                      <span className="rounded-full bg-leaf-deep px-2.5 py-1 text-xs font-semibold text-white">
                        everyone&rsquo;s free
                      </span>
                    ) : (
                      <>
                        <span className="text-sm font-semibold">
                          {w.score} of {results.respondedCount} free
                        </span>
                        <p className="truncate text-xs text-ink-soft">
                          {missingLine(w.unavailableMemberIds, nameOf)}
                        </p>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section>
        <h3 className="font-display text-lg font-semibold">
          The whole window
        </h3>
        <p className="mb-3 mt-0.5 text-xs text-ink-soft">
          Greener days = more people free
        </p>
        <MonthCalendar
          months={months}
          renderDay={(cell) => {
            if (!cell.inWindow) {
              return (
                <div className="flex aspect-square items-center justify-center font-mono text-sm text-ink-soft/30">
                  {cell.dayOfMonth}
                </div>
              );
            }
            const free = heat.get(cell.date) ?? 0;
            const ratio =
              results.respondedCount > 0 ? free / results.respondedCount : 0;
            return (
              <div
                title={`${fmtDate(cell.date)}: ${free} free`}
                className="flex aspect-square items-center justify-center rounded-lg border border-hairline font-mono text-sm"
                style={{
                  backgroundColor: `rgba(23, 123, 75, ${(ratio * 0.85).toFixed(2)})`,
                  color: ratio > 0.55 ? "#fff" : undefined,
                }}
              >
                {cell.dayOfMonth}
              </div>
            );
          }}
        />
      </section>
    </>
  );
}

function SlotResults({
  payload,
  nameOf,
}: {
  payload: EventPayload;
  nameOf: Map<string, string>;
}) {
  const { results } = payload;
  const top = results.slots.filter((s) => s.score > 0).slice(0, 8);

  return (
    <section>
      <h3 className="font-display text-lg font-semibold">Best times</h3>
      {top.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">
          No time works yet — more answers might change that.
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {top.map((s, i) => {
            const everyone = s.score === results.respondedCount;
            return (
              <li
                key={`${s.date}|${s.slot}`}
                className="flex items-center gap-3 rounded-2xl border border-hairline bg-card p-3"
              >
                <div className="relative shrink-0 px-2 py-1">
                  <span className="relative font-mono text-sm font-semibold">
                    {fmtDate(s.date)} · {SLOT_LABEL[s.slot]}
                  </span>
                  {i === 0 && <PenCircle />}
                </div>
                <div className="min-w-0 flex-1 text-right">
                  {everyone ? (
                    <span className="rounded-full bg-leaf-deep px-2.5 py-1 text-xs font-semibold text-white">
                      everyone&rsquo;s free
                    </span>
                  ) : (
                    <>
                      <span className="text-sm font-semibold">
                        {s.score} of {results.respondedCount} free
                      </span>
                      <p className="truncate text-xs text-ink-soft">
                        {missingLine(s.unavailableMemberIds, nameOf)}
                      </p>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
