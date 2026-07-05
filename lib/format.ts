// Human date formatting for YYYY-MM-DD strings (UTC, no timezone drift).

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return fmtDate(startIso);
  return `${fmtDate(startIso)} – ${fmtDate(endIso)}`;
}
