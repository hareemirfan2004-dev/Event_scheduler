"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { saveIdentity, useIdentity } from "@/lib/client/identity";
import { saveGroup, touchGroup } from "@/lib/client/groups";
import type { GroupPayload } from "@/lib/client/types";
import { Button, Card, ErrorNote, TextInput } from "@/components/atoms";
import { NewEventForm } from "@/components/new-event-form";

interface JoinResponse {
  memberId: string;
  memberName: string;
  memberToken: string;
}

function JoinGate({
  code,
  groupName,
  onJoined,
}: {
  code: string;
  groupName: string;
  onJoined: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [nameTaken, setNameTaken] = useState(false);
  const [busy, setBusy] = useState(false);

  async function join(claimExisting: boolean) {
    setBusy(true);
    setError("");
    try {
      const data = await api<JoinResponse>(`/api/groups/${code}/join`, {
        method: "POST",
        body: { name, claimExisting },
      });
      saveIdentity(code, {
        memberId: data.memberId,
        memberName: data.memberName,
        memberToken: data.memberToken,
      });
      saveGroup({
        code,
        groupName,
        memberName: data.memberName,
        lastOpenedAt: Date.now(),
      });
      onJoined();
    } catch (err) {
      if (err instanceof ApiError && err.message === "name_taken") {
        setNameTaken(true);
      } else {
        setError(
          err instanceof ApiError ? err.message : "Could not join the group",
        );
      }
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="font-display text-lg font-semibold">
        Join {groupName}
      </h2>
      {!nameTaken ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join(false);
          }}
          className="mt-3 space-y-3"
        >
          <TextInput
            label="Your name"
            value={name}
            onChange={setName}
            placeholder="Ali"
            required
            autoFocus
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" disabled={busy || !name.trim()} className="w-full">
            {busy ? "Joining…" : "Join group"}
          </Button>
        </form>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-soft">
            Someone named <strong className="text-ink">{name.trim()}</strong>{" "}
            is already in this group. Is that you?
          </p>
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-2">
            <Button onClick={() => void join(true)} disabled={busy} className="flex-1">
              Yes, that&rsquo;s me
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setNameTaken(false);
                setName("");
              }}
              className="flex-1"
            >
              No, use another name
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function GroupPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const upperCode = code.toUpperCase();

  const [payload, setPayload] = useState<GroupPayload | null>(null);
  const identity = useIdentity(upperCode);
  const [loadError, setLoadError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showNewEvent, setShowNewEvent] = useState(false);

  const load = useCallback(async () => {
    try {
      setPayload(await api<GroupPayload>(`/api/groups/${upperCode}`));
      touchGroup(upperCode);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? "No group has this code. Check the link and try again."
          : "Could not load the group. Pull to refresh or try again.",
      );
    }
  }, [upperCode]);

  useEffect(() => {
    // False positive: load() only sets state after an await, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loadError) {
    return (
      <main className="pt-14 text-center">
        <h1 className="font-display text-2xl font-bold">Hmm.</h1>
        <p className="mt-2 text-ink-soft">{loadError}</p>
        <Link href="/" className="mt-6 inline-block font-semibold text-leaf">
          Go to the start page
        </Link>
      </main>
    );
  }

  if (!payload) {
    return <main className="pt-14 text-center text-ink-soft">Loading…</main>;
  }

  const { group, members, events } = payload;

  return (
    <main className="pt-8">
      <header>
        <Link
          href="/"
          className="font-mono text-xs tracking-[0.2em] text-leaf uppercase"
        >
          ← Saath
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="font-display text-3xl font-bold leading-tight">
            {group.name}
          </h1>
          <button
            onClick={() => void copyLink()}
            className="shrink-0 rounded-lg border border-hairline bg-card px-3 py-2 text-sm font-medium text-ink"
          >
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>
        <p className="mt-1 font-mono text-sm text-ink-soft">
          Code: <span className="tracking-widest text-ink">{group.code}</span>
        </p>
      </header>

      <section className="mt-4 flex flex-wrap gap-1.5">
        {members.map((m) => (
          <span
            key={m.id}
            className={`rounded-full px-3 py-1 text-sm ${
              m.id === identity?.memberId
                ? "bg-leaf-wash font-semibold text-leaf-deep"
                : "bg-card text-ink-soft border border-hairline"
            }`}
          >
            {m.name}
            {m.id === identity?.memberId && " (you)"}
          </span>
        ))}
      </section>

      {!identity && (
        <JoinGate
          code={upperCode}
          groupName={group.name}
          onJoined={() => void load()}
        />
      )}

      {identity && (
        <>
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">Events</h2>
              <Button
                variant="quiet"
                onClick={() => setShowNewEvent((v) => !v)}
                className="!px-3 !py-2 text-sm"
              >
                {showNewEvent ? "Close" : "+ New event"}
              </Button>
            </div>

            {showNewEvent && (
              <div className="mt-3">
                <NewEventForm
                  code={upperCode}
                  token={identity.memberToken}
                  onCreated={() => {
                    setShowNewEvent(false);
                    void load();
                  }}
                />
              </div>
            )}

            {events.length === 0 && !showNewEvent && (
              <Card className="mt-3 text-center">
                <p className="text-ink-soft">
                  No events yet — plan the first one.
                </p>
                <Button onClick={() => setShowNewEvent(true)} className="mt-3">
                  Plan an event
                </Button>
              </Card>
            )}

            <div className="mt-3 space-y-2">
              {events.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/g/${upperCode}/e/${ev.id}`}
                  className="block rounded-2xl border border-hairline bg-card p-4 active:bg-paper"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{ev.title}</h3>
                    <span className="rounded-full bg-leaf-wash px-2 py-0.5 text-xs font-medium text-leaf-deep">
                      {ev.mode === "DAY"
                        ? ev.durationDays > 1
                          ? `${ev.durationDays} days`
                          : "1 day"
                        : "times of day"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-ink-soft">
                    {ev.windowStart} → {ev.windowEnd}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
