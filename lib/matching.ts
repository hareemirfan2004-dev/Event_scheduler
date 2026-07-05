// Pure availability-matching logic. No database access — callers load the
// event and pass plain data in, which keeps this unit-testable.

export type EventMode = "DAY" | "SLOT";
export type Slot = "ALL" | "MORNING" | "AFTERNOON" | "EVENING";

export interface MemberRef {
  id: string;
  name: string;
}

export interface BusyEntryInput {
  memberId: string;
  date: string; // YYYY-MM-DD
  slot: Slot;
}

export interface MatchInput {
  mode: EventMode;
  windowStart: string; // YYYY-MM-DD, inclusive
  windowEnd: string; // YYYY-MM-DD, inclusive
  durationDays: number; // consecutive days needed (DAY mode)
  members: MemberRef[];
  respondedMemberIds: string[];
  busyEntries: BusyEntryInput[];
}

export interface WindowResult {
  startDate: string;
  endDate: string;
  availableMemberIds: string[];
  unavailableMemberIds: string[];
  score: number;
}

export interface HeatmapDay {
  date: string;
  freeCount: number;
}

export interface SlotResult {
  date: string;
  slot: Exclude<Slot, "ALL">;
  availableMemberIds: string[];
  unavailableMemberIds: string[];
  score: number;
}

export interface MatchResults {
  windows: WindowResult[]; // DAY mode (empty in SLOT mode)
  slots: SlotResult[]; // SLOT mode (empty in DAY mode)
  heatmap: HeatmapDay[];
  respondedCount: number;
  totalMembers: number;
  pendingMemberIds: string[];
}

const DAY_SLOTS: Exclude<Slot, "ALL">[] = ["MORNING", "AFTERNOON", "EVENING"];

/** Format a Date (UTC) back to YYYY-MM-DD. */
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** All YYYY-MM-DD strings from start to end inclusive. */
function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    days.push(toIso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function computeMatches(input: MatchInput): MatchResults {
  const days = eachDay(input.windowStart, input.windowEnd);
  const responded = input.members.filter((m) =>
    input.respondedMemberIds.includes(m.id),
  );

  // memberId -> set of YYYY-MM-DD dates they are busy on (DAY semantics).
  const busyDates = new Map<string, Set<string>>();
  for (const entry of input.busyEntries) {
    let set = busyDates.get(entry.memberId);
    if (!set) {
      set = new Set();
      busyDates.set(entry.memberId, set);
    }
    set.add(entry.date);
  }

  const windows: WindowResult[] = [];
  if (input.mode === "DAY") {
    const duration = Math.max(1, input.durationDays);
    for (let i = 0; i + duration <= days.length; i++) {
      const windowDays = days.slice(i, i + duration);
      const available: string[] = [];
      const unavailable: string[] = [];
      for (const m of responded) {
        const busy = busyDates.get(m.id);
        if (busy && windowDays.some((d) => busy.has(d))) unavailable.push(m.id);
        else available.push(m.id);
      }
      windows.push({
        startDate: windowDays[0],
        endDate: windowDays[windowDays.length - 1],
        availableMemberIds: available,
        unavailableMemberIds: unavailable,
        score: available.length,
      });
    }
    windows.sort(
      (a, b) => b.score - a.score || a.startDate.localeCompare(b.startDate),
    );
  }

  const slots: SlotResult[] = [];
  if (input.mode === "SLOT") {
    // memberId -> set of "date|slot" keys ("date|ALL" blocks the whole day).
    const busySlots = new Map<string, Set<string>>();
    for (const entry of input.busyEntries) {
      let set = busySlots.get(entry.memberId);
      if (!set) {
        set = new Set();
        busySlots.set(entry.memberId, set);
      }
      set.add(`${entry.date}|${entry.slot}`);
    }
    for (const day of days) {
      for (const slot of DAY_SLOTS) {
        const available: string[] = [];
        const unavailable: string[] = [];
        for (const m of responded) {
          const busy = busySlots.get(m.id);
          if (busy && (busy.has(`${day}|${slot}`) || busy.has(`${day}|ALL`)))
            unavailable.push(m.id);
          else available.push(m.id);
        }
        slots.push({
          date: day,
          slot,
          availableMemberIds: available,
          unavailableMemberIds: unavailable,
          score: available.length,
        });
      }
    }
    slots.sort(
      (a, b) =>
        b.score - a.score ||
        a.date.localeCompare(b.date) ||
        DAY_SLOTS.indexOf(a.slot) - DAY_SLOTS.indexOf(b.slot),
    );
  }

  const heatmap: HeatmapDay[] = days.map((day) => ({
    date: day,
    freeCount: responded.filter((m) => !busyDates.get(m.id)?.has(day)).length,
  }));

  const respondedIds = new Set(responded.map((m) => m.id));
  return {
    windows,
    slots,
    heatmap,
    respondedCount: responded.length,
    totalMembers: input.members.length,
    pendingMemberIds: input.members
      .filter((m) => !respondedIds.has(m.id))
      .map((m) => m.id),
  };
}
