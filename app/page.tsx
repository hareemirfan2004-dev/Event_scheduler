import { LandingForms } from "@/components/landing-forms";
import { StrikeX, PenCircle } from "@/components/pen";

// Decorative week strip: most days crossed out, one circled — the whole
// app in one image.
function WeekMotif() {
  const days = [
    { n: 12, busy: true },
    { n: 13, busy: true },
    { n: 14, busy: false, circled: true },
    { n: 15, busy: true },
    { n: 16, busy: true },
  ];
  return (
    <div className="flex justify-center gap-2" aria-hidden="true">
      {days.map((d) => (
        <div
          key={d.n}
          data-busy={d.busy}
          className="day-cell relative flex h-11 w-11 items-center justify-center rounded-lg border border-hairline bg-card font-mono text-sm text-ink"
        >
          {d.n}
          {d.busy && <StrikeX />}
          {d.circled && <PenCircle />}
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="pt-14">
      <p className="text-center font-mono text-sm tracking-[0.2em] text-leaf uppercase">
        Saath
      </p>
      <h1 className="mt-3 text-center font-display text-4xl font-bold leading-tight">
        Find the day
        <br />
        everyone&rsquo;s free.
      </h1>
      <p className="mx-auto mt-4 max-w-xs text-center text-ink-soft">
        Everyone crosses out their busy days. Saath circles the dates that
        work for the whole family.
      </p>

      <div className="mt-8">
        <WeekMotif />
      </div>

      <div className="mt-10">
        <LandingForms />
      </div>
    </main>
  );
}
