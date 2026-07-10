"use client";

import { LandingForms } from "@/components/landing-forms";
import { MyGroups } from "@/components/my-groups";
import { PenCircle } from "@/components/pen";
import { useMyGroups } from "@/lib/client/groups";

// Decorative week strip: multiple days marked free (green) plus one circled
// winner — the whole app in one image. `free` and `circled` are separate
// flags so the winner mark never blurs into the "I'm free" green mark.
function WeekMotif() {
  const days = [
    { n: 12, free: true },
    { n: 13, free: true },
    { n: 14, free: true, circled: true },
    { n: 15 },
    { n: 16 },
  ];
  return (
    <div className="flex justify-center gap-2" aria-hidden="true">
      {days.map((d) => (
        <div
          key={d.n}
          className={`day-cell relative flex h-11 w-11 items-center justify-center rounded-lg border font-mono text-sm ${
            d.free
              ? "border-leaf-deep bg-leaf text-white"
              : "border-hairline bg-card text-ink"
          }`}
        >
          {d.n}
          {d.circled && <PenCircle />}
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const groups = useMyGroups();

  if (groups.length > 0) {
    return <MyGroups />;
  }

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
        Everyone picks the days they&rsquo;re free. Saath circles the date
        that works for the whole family.
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
