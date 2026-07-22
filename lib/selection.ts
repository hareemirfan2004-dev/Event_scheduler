// Pure day-selection helpers. Dates are "YYYY-MM-DD"; compared as strings
// (ISO sorts lexically) and parsed as UTC to avoid timezone drift.

export function isWeekend(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 || dow === 6;
}

export function fillRange(a: string, b: string, windowDays: string[]): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return windowDays.filter((d) => d >= lo && d <= hi);
}

export function weekendDays(windowDays: string[]): string[] {
  return windowDays.filter(isWeekend);
}

export function toggleDays(current: Set<string>, days: string[]): Set<string> {
  const next = new Set(current);
  const allPresent = days.every((d) => next.has(d));
  for (const d of days) {
    if (allPresent) next.delete(d);
    else next.add(d);
  }
  return next;
}

export const SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;

// Toggle one "date|slot" key. If the day is free via its "date|ALL" key
// (from "Free anytime"), expand ALL into the three individual slot keys
// first so the tap toggles for real instead of being masked by ALL.
export function toggleSlot(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  const date = key.split("|")[0];
  if (next.delete(`${date}|ALL`)) for (const s of SLOTS) next.add(`${date}|${s}`);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
