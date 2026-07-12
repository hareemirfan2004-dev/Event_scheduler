"use client";

import { useMemo, useState } from "react";
import { monthsInRange } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { fillRange, weekendDays, toggleDays } from "@/lib/selection";
import { api, ApiError } from "@/lib/client/api";
import type { EventPayload } from "@/lib/client/types";
import { ErrorNote } from "@/components/atoms";
import { MonthCalendar } from "@/components/month-calendar";

const SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
const SLOT_LABEL: Record<(typeof SLOTS)[number], string> = {
  MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening",
};

export function AvailabilityEditor({
  payload, memberId, token, onSaved,
}: {
  payload: EventPayload;
  memberId: string;
  token: string;
  onSaved: () => void;
}) {
  const { event } = payload;

  const initialFree = useMemo(() => {
    const set = new Set<string>();
    for (const e of payload.freeEntries) {
      if (e.memberId !== memberId) continue;
      set.add(event.mode === "DAY" ? e.date : `${e.date}|${e.slot}`);
    }
    return set;
  }, [payload.freeEntries, memberId, event.mode]);

  const [freeSet, setFreeSet] = useState<Set<string>>(new Set(initialFree));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  // Range mode (DAY only): sticky; armed holds the pending start date.
  const [rangeMode, setRangeMode] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const months = useMemo(
    () => monthsInRange(event.windowStart, event.windowEnd),
    [event.windowStart, event.windowEnd],
  );
  const windowDays = useMemo(
    () => months.flatMap((m) => m.weeks.flat())
      .filter((c): c is NonNullable<typeof c> => c != null && c.inWindow)
      .map((c) => c.date),
    [months],
  );

  function mutate(fn: (prev: Set<string>) => Set<string>) {
    setFreeSet(fn);
    setDirty(true);
    setSavedFlash(false);
  }

  function tapDay(date: string) {
    if (rangeMode) {
      if (armed == null) { setArmed(date); return; }
      const span = fillRange(armed, date, windowDays);
      mutate((prev) => { const n = new Set(prev); span.forEach((d) => n.add(d)); return n; });
      setArmed(null); // re-arm for the next range
      return;
    }
    mutate((prev) => { const n = new Set(prev); if (n.has(date)) n.delete(date); else n.add(date); return n; });
  }

  function tapSlot(key: string) {
    // If the day is free via its "ALL" key (from "Free anytime"), expand it
    // into the three individual slot keys first so this tap toggles for real
    // instead of being masked by the still-present ALL entry.
    const date = key.split("|")[0];
    mutate((prev) => {
      const n = new Set(prev);
      if (n.delete(`${date}|ALL`)) for (const s of SLOTS) n.add(`${date}|${s}`);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  function freeAnytime() {
    if (event.mode === "DAY") {
      mutate(() => new Set(windowDays));
    } else {
      mutate(() => new Set(windowDays.map((d) => `${d}|ALL`))); // ALL frees the day
    }
  }
  function pickWeekends() { mutate((prev) => toggleDays(prev, weekendDays(windowDays))); }
  function clearAll() { mutate(() => new Set()); setArmed(null); }
  function toggleWeekRow(weekDates: string[]) { mutate((prev) => toggleDays(prev, weekDates)); }

  async function doSave() {
    setSaving(true); setError(""); setConfirmEmpty(false);
    try {
      const body = event.mode === "DAY"
        ? { freeDates: [...freeSet] }
        : { freeSlots: [...freeSet].map((k) => { const [date, slot] = k.split("|"); return { date, slot }; }) };
      await api(`/api/events/${event.id}/availability`, { method: "PUT", token, body });
      setDirty(false); setSavedFlash(true); onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save — try again");
    } finally { setSaving(false); }
  }

  function onSaveClick() {
    if (freeSet.size === 0) { setConfirmEmpty(true); return; }
    void doSave();
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-soft">
        Tap the {event.mode === "DAY" ? "days" : "times"} you{" "}
        <strong className="text-leaf-deep">can</strong> make. Everything else counts as busy.
      </p>

      {event.mode === "DAY" && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={() => { setRangeMode((v) => !v); setArmed(null); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              rangeMode ? "border-leaf bg-leaf-wash text-leaf-deep" : "border-hairline bg-card text-ink"
            }`}>
            {rangeMode ? "Range on ✓" : "Pick a range"}
          </button>
          <button onClick={freeAnytime} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm font-medium text-ink">Free anytime</button>
          <button onClick={pickWeekends} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm font-medium text-ink">Weekends</button>
          <button onClick={clearAll} className="rounded-full border border-strike/30 bg-card px-3 py-1.5 text-sm font-medium text-strike">Clear</button>
        </div>
      )}
      {event.mode === "SLOT" && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={freeAnytime} className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm font-medium text-ink">Free anytime</button>
          <button onClick={clearAll} className="rounded-full border border-strike/30 bg-card px-3 py-1.5 text-sm font-medium text-strike">Clear</button>
        </div>
      )}
      {rangeMode && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-leaf-wash px-3 py-2 text-xs text-leaf-deep">
          <span>Tap the start &amp; end of each free stretch</span>
          <button onClick={() => { setRangeMode(false); setArmed(null); }} className="font-bold">Done</button>
        </div>
      )}

      {event.mode === "DAY" ? (
        <MonthCalendar months={months} onWeekLabel={toggleWeekRow} renderDay={(cell) => {
          if (!cell.inWindow) return (
            <div className="flex aspect-square items-center justify-center font-mono text-sm text-ink-soft/30">{cell.dayOfMonth}</div>
          );
          const free = freeSet.has(cell.date);
          const isArmed = armed === cell.date;
          return (
            <button aria-pressed={free}
              aria-label={`${fmtDate(cell.date)}${free ? " — free" : ""}`}
              onClick={() => tapDay(cell.date)}
              className={`flex aspect-square w-full items-center justify-center rounded-lg border font-mono text-sm ${
                free ? "border-leaf-deep bg-leaf text-white"
                : isArmed ? "border-2 border-dashed border-leaf bg-card text-leaf-deep"
                : "border-hairline bg-card text-ink"
              }`}>
              {cell.dayOfMonth}
            </button>
          );
        }} />
      ) : (
        <SlotListEditor months={months} freeSet={freeSet} onToggle={tapSlot} />
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-paper/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <p className="flex-1 text-sm text-ink-soft">
            {freeSet.size === 0 ? "Nothing marked free yet"
              : `${freeSet.size} ${event.mode === "DAY" ? "day(s)" : "time(s)"} free`}
          </p>
          <button onClick={onSaveClick} disabled={saving || (!dirty && !savedFlash)}
            className={`rounded-xl px-5 py-3 font-semibold text-white transition-colors ${
              savedFlash && !dirty ? "bg-leaf-deep" : "bg-leaf"
            } disabled:opacity-40`}>
            {saving ? "Saving…" : savedFlash && !dirty ? "Saved ✓" : "Save"}
          </button>
        </div>
        {confirmEmpty && (
          <div className="mx-auto mt-2 max-w-md rounded-xl border border-hairline bg-card p-3">
            <p className="text-sm text-ink">You haven’t marked any free days — save as “can’t make any of these”?</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => void doSave()} className="rounded-lg bg-leaf px-4 py-2 text-sm font-semibold text-white">Yes, save</button>
              <button onClick={() => setConfirmEmpty(false)} className="rounded-lg border border-hairline bg-card px-4 py-2 text-sm font-semibold text-ink">Keep editing</button>
            </div>
          </div>
        )}
        {error && <div className="mx-auto mt-2 max-w-md"><ErrorNote>{error}</ErrorNote></div>}
      </div>
    </div>
  );
}

function SlotListEditor({
  months, freeSet, onToggle,
}: {
  months: ReturnType<typeof monthsInRange>;
  freeSet: Set<string>;
  onToggle: (key: string) => void;
}) {
  const days = months.flatMap((m) => m.weeks.flat())
    .filter((c): c is NonNullable<typeof c> => c != null && c.inWindow);
  return (
    <div className="space-y-1.5">
      {days.map((day) => (
        <div key={day.date} className="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2">
          <span className="w-24 shrink-0 font-mono text-sm">{fmtDate(day.date)}</span>
          <div className="flex flex-1 gap-1.5">
            {SLOTS.map((slot) => {
              const key = `${day.date}|${slot}`;
              const free = freeSet.has(key) || freeSet.has(`${day.date}|ALL`);
              return (
                <button key={slot} aria-pressed={free} onClick={() => onToggle(key)}
                  className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-medium ${
                    free ? "border-leaf-deep bg-leaf text-white" : "border-hairline bg-paper text-ink-soft"
                  }`}>
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
