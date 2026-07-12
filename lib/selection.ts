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
