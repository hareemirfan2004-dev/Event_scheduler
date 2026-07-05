// Month-grid generation for the availability calendar. Pure date math on
// YYYY-MM-DD strings (UTC) — no timezone drift on whole-day semantics.

export interface DayCell {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  inWindow: boolean;
}

export interface MonthGrid {
  year: number;
  month: number; // 1-12
  label: string; // "August 2026"
  weeks: (DayCell | null)[][]; // Monday-start rows of 7
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Monday-start weekday index (Mon=0 ... Sun=6). */
function mondayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function monthsInRange(
  windowStart: string,
  windowEnd: string,
): MonthGrid[] {
  const [startYear, startMonth] = windowStart.split("-").map(Number);
  const [endYear, endMonth] = windowEnd.split("-").map(Number);

  const months: MonthGrid[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weeks: (DayCell | null)[][] = [];
    let week: (DayCell | null)[] = new Array(mondayIndex(year, month, 1)).fill(
      null,
    );

    for (let day = 1; day <= daysInMonth; day++) {
      const date = iso(year, month, day);
      week.push({
        date,
        dayOfMonth: day,
        inWindow: date >= windowStart && date <= windowEnd,
      });
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }

    months.push({
      year,
      month,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      weeks,
    });

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}
