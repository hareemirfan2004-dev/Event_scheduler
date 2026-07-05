"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { useIdentity } from "@/lib/client/identity";
import type { EventPayload } from "@/lib/client/types";
import { fmtRange } from "@/lib/format";
import { AvailabilityEditor } from "@/components/availability-editor";
import { ResultsView } from "@/components/results-view";

function DeleteEvent({
  eventId,
  token,
  onDeleted,
}: {
  eventId: string;
  token: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function doDelete() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/events/${eventId}`, { method: "DELETE", token });
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not delete — try again",
      );
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-strike underline-offset-2 hover:underline"
      >
        Delete this event
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-strike/30 bg-strike-wash p-3">
      <p className="text-sm text-ink">
        Delete for everyone? All saved availability goes with it.
      </p>
      {error && <p className="mt-1 text-sm text-strike">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void doDelete()}
          disabled={busy}
          className="rounded-xl bg-strike px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-xl border border-hairline bg-card px-4 py-2 text-sm font-semibold text-ink"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

export default function EventPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const router = useRouter();
  const { code, id } = use(params);
  const upperCode = code.toUpperCase();

  const [payload, setPayload] = useState<EventPayload | null>(null);
  const identity = useIdentity(upperCode);
  const [tab, setTab] = useState<"mine" | "results">("mine");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      setPayload(await api<EventPayload>(`/api/events/${id}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? "This event doesn't exist (anymore)."
          : "Could not load the event — try again.",
      );
    }
  }, [id]);

  useEffect(() => {
    // False positive: load() only sets state after an await, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loadError) {
    return (
      <main className="pt-14 text-center">
        <h1 className="font-display text-2xl font-bold">Hmm.</h1>
        <p className="mt-2 text-ink-soft">{loadError}</p>
        <Link
          href={`/g/${upperCode}`}
          className="mt-6 inline-block font-semibold text-leaf"
        >
          Back to the group
        </Link>
      </main>
    );
  }

  if (!payload) {
    return <main className="pt-14 text-center text-ink-soft">Loading…</main>;
  }

  const { event, group } = payload;

  return (
    <main className="pt-6">
      <Link href={`/g/${upperCode}`} className="text-sm text-ink-soft">
        ← {group.name}
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold leading-tight">
        {event.title}
      </h1>
      <p className="mt-1 font-mono text-sm text-ink-soft">
        {fmtRange(event.windowStart, event.windowEnd)}
        {event.mode === "DAY" &&
          event.durationDays > 1 &&
          ` · needs ${event.durationDays} days in a row`}
      </p>

      <div className="mt-5 flex rounded-xl border border-hairline bg-card p-1">
        {(
          [
            ["mine", event.mode === "DAY" ? "My days" : "My times"],
            ["results", "Best dates"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === value ? "bg-ink text-white" : "text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "mine" ? (
          identity ? (
            <AvailabilityEditor
              key={payload.busyEntries.length /* remount after reload */}
              payload={payload}
              memberId={identity.memberId}
              token={identity.memberToken}
              onSaved={() => void load()}
            />
          ) : (
            <div className="rounded-2xl border border-hairline bg-card p-6 text-center">
              <p className="text-ink-soft">
                Join the group first, then mark your days.
              </p>
              <Link
                href={`/g/${upperCode}`}
                className="mt-3 inline-block rounded-xl bg-leaf px-4 py-3 font-semibold text-white"
              >
                Join {group.name}
              </Link>
            </div>
          )
        ) : (
          <ResultsView payload={payload} />
        )}
      </div>

      {identity && (
        <div className="mt-10">
          <DeleteEvent
            eventId={event.id}
            token={identity.memberToken}
            onDeleted={() => router.push(`/g/${upperCode}`)}
          />
        </div>
      )}
    </main>
  );
}
