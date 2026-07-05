"use client";

import { useMemo, useState } from "react";
import { monthsInRange } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { api, ApiError } from "@/lib/client/api";
import type { EventPayload } from "@/lib/client/types";
import { StrikeX } from "@/components/pen";
import { ErrorNote } from "@/components/atoms";
import { MonthCalendar } from "@/components/month-calendar";

const SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
const SLOT_LABEL: Record<(typeof SLOTS)[number], string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
};

/**
 * Tap the days (or times of day) you are BUSY. Keys are "date" in DAY
 * mode and "date|slot" in SLOT mode.
 */
export function AvailabilityEditor({
  payload,
  memberId,
  token,
  onSaved,
}: {
  payload: EventPayload;
  memberId: string;
  token: string;
  onSaved: () => void;
}) {
  const { event } = payload;

  const initialBusy = useMemo(() => {
    const set = new Set<string>();
    for (const entry of payload.busyEntries) {
      if (entry.memberId !== memberId) continue;
      set.add(event.mode === "DAY" ? entry.date : `${entry.date}|${entry.slot}`);
    }
    return set;
  }, [payload.busyEntries, memberId, event.mode]);

  const [busySet, setBusySet] = useState<Set<string>>(new Set(initialBusy));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");

  const months = useMemo(
    () => monthsInRange(event.windowStart, event.windowEnd),
    [event.windowStart, event.windowEnd],
  );

  function toggle(key: string) {
    setBusySet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
    setSavedFlash(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body =
        event.mode === "DAY"
          ? { busyDates: [...busySet] }
          : {
              busySlots: [...busySet].map((key) => {
                const [date, slot] = key.split("|");
                return { date, slot };
              }),
            };
      await api(`/api/events/${event.id}/availability`, {
        method: "PUT",
        token,
        body,
      });
      setDirty(false);
      setSavedFlash(true);
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save — try again",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-soft">
        Cross out the {event.mode === "DAY" ? "days" : "times"} you{" "}
        <strong className="text-strike">can&rsquo;t</strong> make. Everything
        else counts as free.
      </p>

      {event.mode === "DAY" ? (
        <MonthGridEditor months={months} busySet={busySet} onToggle={toggle} />
      ) : (
        <SlotListEditor
          months={months}
          busySet={busySet}
          onToggle={toggle}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-paper/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <p className="flex-1 text-sm text-ink-soft">
            {busySet.size === 0
              ? "Nothing crossed out — free the whole time"
              : `${busySet.size} ${event.mode === "DAY" ? "day(s)" : "time(s)"} crossed out`}
          </p>
          <button
            onClick={() => void save()}
            disabled={saving || (!dirty && !savedFlash)}
            className={`rounded-xl px-5 py-3 font-semibold text-white transition-colors ${
              savedFlash && !dirty ? "bg-leaf-deep" : "bg-leaf"
            } disabled:opacity-40`}
          >
            {saving ? "Saving…" : savedFlash && !dirty ? "Saved ✓" : "Save"}
          </button>
        </div>
        {error && (
          <div className="mx-auto mt-2 max-w-md">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </div>
    </div>
  );
}

function MonthGridEditor({
  months,
  busySet,
  onToggle,
}: {
  months: ReturnType<typeof monthsInRange>;
  busySet: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
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
        const busy = busySet.has(cell.date);
        return (
          <button
            data-busy={busy}
            aria-pressed={busy}
            aria-label={`${fmtDate(cell.date)}${busy ? " — busy" : " — free"}`}
            onClick={() => onToggle(cell.date)}
            className={`day-cell flex aspect-square w-full items-center justify-center rounded-lg border font-mono text-sm ${
              busy
                ? "border-strike/40 bg-strike-wash text-strike"
                : "border-hairline bg-card text-ink"
            }`}
          >
            {cell.dayOfMonth}
            {busy && <StrikeX />}
          </button>
        );
      }}
    />
  );
}

function SlotListEditor({
  months,
  busySet,
  onToggle,
}: {
  months: ReturnType<typeof monthsInRange>;
  busySet: Set<string>;
  onToggle: (key: string) => void;
}) {
  const days = months
    .flatMap((m) => m.weeks.flat())
    .filter((c): c is NonNullable<typeof c> => c !== null && c.inWindow);

  return (
    <div className="space-y-1.5">
      {days.map((day) => (
        <div
          key={day.date}
          className="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2"
        >
          <span className="w-24 shrink-0 font-mono text-sm">
            {fmtDate(day.date)}
          </span>
          <div className="flex flex-1 gap-1.5">
            {SLOTS.map((slot) => {
              const key = `${day.date}|${slot}`;
              const busy = busySet.has(key);
              return (
                <button
                  key={slot}
                  data-busy={busy}
                  aria-pressed={busy}
                  onClick={() => onToggle(key)}
                  className={`day-cell relative flex-1 rounded-lg border px-1 py-1.5 text-xs font-medium ${
                    busy
                      ? "border-strike/40 bg-strike-wash text-strike line-through"
                      : "border-hairline bg-paper text-ink-soft"
                  }`}
                >
                  {SLOT_LABEL[slot]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
