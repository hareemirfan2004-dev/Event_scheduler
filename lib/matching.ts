// Pure availability-matching logic. No database access — callers load the
// event and pass plain data in, which keeps this unit-testable.

export type EventMode = "DAY" | "SLOT";
export type Slot = "ALL" | "MORNING" | "AFTERNOON" | "EVENING";

export interface MemberRef {
  id: string;
  name: string;
}

export interface FreeEntryInput {
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
  freeEntries: FreeEntryInput[];
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

  // memberId -> set of "YYYY-MM-DD" they marked free (any slot counts for DAY).
  const freeDates = new Map<string, Set<string>>();
  // memberId -> set of "date|slot" free keys (ALL frees the whole day).
  const freeSlots = new Map<string, Set<string>>();
  for (const e of input.freeEntries) {
    let d = freeDates.get(e.memberId);
    if (!d) {
      d = new Set();
      freeDates.set(e.memberId, d);
    }
    d.add(e.date);
    let s = freeSlots.get(e.memberId);
    if (!s) {
      s = new Set();
      freeSlots.set(e.memberId, s);
    }
    s.add(`${e.date}|${e.slot}`);
  }

  const windows: WindowResult[] = [];
  if (input.mode === "DAY") {
    const duration = Math.max(1, input.durationDays);
    for (let i = 0; i + duration <= days.length; i++) {
      const windowDays = days.slice(i, i + duration);
      const available: string[] = [];
      const unavailable: string[] = [];
      for (const m of responded) {
        const free = freeDates.get(m.id);
        const allFree = free != null && windowDays.every((d) => free.has(d));
        if (allFree) available.push(m.id);
        else unavailable.push(m.id);
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
    for (const day of days) {
      for (const slot of DAY_SLOTS) {
        const available: string[] = [];
        const unavailable: string[] = [];
        for (const m of responded) {
          const free = freeSlots.get(m.id);
          const isFree =
            free != null && (free.has(`${day}|${slot}`) || free.has(`${day}|ALL`));
          if (isFree) available.push(m.id);
          else unavailable.push(m.id);
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
    freeCount: responded.filter((m) => freeDates.get(m.id)?.has(day)).length,
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
