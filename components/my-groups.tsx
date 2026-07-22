"use client";

import { useState } from "react";
import Link from "next/link";
import { removeGroup, type SavedGroup } from "@/lib/client/groups";
import { fmtDate } from "@/lib/format";
import { Button, Card } from "@/components/atoms";
import { LandingForms } from "@/components/landing-forms";

// lastOpenedAt is a moment in time (Date.now()); we only ever show its
// calendar date, so we read the local y/m/d once and hand that fixed
// triple to fmtDate (which treats it as an opaque calendar date).
function lastOpenedLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "Opened today";
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return `Opened ${fmtDate(iso)}`;
}

function GroupCard({ group }: { group: SavedGroup }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <Link href={`/g/${group.code}`} className="block active:opacity-70">
        <p className="font-display text-lg font-semibold">{group.groupName}</p>
        <p className="mt-0.5 font-mono text-sm tracking-widest text-ink-soft">
          {group.code}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          {lastOpenedLabel(group.lastOpenedAt)}
        </p>
      </Link>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="mt-2 text-xs font-medium text-ink-soft underline-offset-2 hover:underline"
        >
          Remove
        </button>
      ) : (
        <div className="mt-3 rounded-xl border border-strike/30 bg-strike-wash p-3">
          <p className="text-sm text-ink">
            Remove from this device? You won&rsquo;t leave the group.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => removeGroup(group.code)}
              className="rounded-xl bg-strike px-4 py-2 text-sm font-semibold text-white"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-hairline bg-card px-4 py-2 text-sm font-semibold text-ink"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function MyGroups({ groups }: { groups: SavedGroup[] }) {
  const [showForms, setShowForms] = useState(false);

  return (
    <main className="pt-14">
      <p className="text-center font-mono text-sm tracking-[0.2em] text-leaf uppercase">
        Saath
      </p>
      <h1 className="mt-3 text-center font-display text-3xl font-bold leading-tight">
        Your groups
      </h1>

      <div className="mt-8 space-y-3">
        {groups.map((g) => (
          <GroupCard key={g.code} group={g} />
        ))}
      </div>

      <div className="mt-6">
        <Button
          variant="quiet"
          onClick={() => setShowForms((v) => !v)}
          className="w-full"
        >
          {showForms ? "Close" : "＋ New group / Join by code"}
        </Button>
        {showForms && (
          <div className="mt-4">
            <LandingForms />
          </div>
        )}
      </div>
    </main>
  );
}
