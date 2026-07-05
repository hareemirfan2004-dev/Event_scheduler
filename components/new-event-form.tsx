"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorNote, TextInput } from "@/components/atoms";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewEventForm({
  code,
  token,
  onCreated,
}: {
  code: string;
  token: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"DAY" | "SLOT">("DAY");
  const [windowStart, setWindowStart] = useState(todayIso());
  const [windowEnd, setWindowEnd] = useState(addDaysIso(todayIso(), 30));
  const [durationDays, setDurationDays] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`/api/groups/${code}/events`, {
        method: "POST",
        token,
        body: { title, mode, windowStart, windowEnd, durationDays },
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create the event",
      );
      setBusy(false);
    }
  }

  const modeOption = (value: "DAY" | "SLOT", heading: string, sub: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`flex-1 rounded-xl border p-3 text-left ${
        mode === value
          ? "border-leaf bg-leaf-wash"
          : "border-hairline bg-card"
      }`}
    >
      <span className="block text-sm font-semibold">{heading}</span>
      <span className="mt-0.5 block text-xs text-ink-soft">{sub}</span>
    </button>
  );

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <TextInput
          label="What are you planning?"
          value={title}
          onChange={setTitle}
          placeholder="Summer trip"
          required
          autoFocus
        />

        <div>
          <span className="mb-1 block text-sm font-medium text-ink-soft">
            People will mark
          </span>
          <div className="flex gap-2">
            {modeOption("DAY", "Whole days", "trips, outings, day plans")}
            {modeOption("SLOT", "Times of day", "dinners, short visits")}
          </div>
        </div>

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="mb-1 block text-sm font-medium text-ink-soft">
              From
            </span>
            <input
              type="date"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              required
              className="w-full rounded-xl border border-hairline bg-card px-3 py-3 font-mono text-sm text-ink"
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-sm font-medium text-ink-soft">
              Until
            </span>
            <input
              type="date"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              required
              className="w-full rounded-xl border border-hairline bg-card px-3 py-3 font-mono text-sm text-ink"
            />
          </label>
        </div>

        {mode === "DAY" && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-soft">
              Days needed in a row
            </span>
            <input
              type="number"
              min={1}
              max={30}
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
              className="w-24 rounded-xl border border-hairline bg-card px-3 py-3 font-mono text-sm text-ink"
            />
            <span className="ml-2 text-xs text-ink-soft">
              1 for a single day, 3 for a weekend trip…
            </span>
          </label>
        )}

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create event"}
        </Button>
      </form>
    </Card>
  );
}
