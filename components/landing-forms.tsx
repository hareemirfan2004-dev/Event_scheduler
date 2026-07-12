"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { saveIdentity } from "@/lib/client/identity";
import { saveGroup } from "@/lib/client/groups";
import { Button, Card, ErrorNote, TextInput } from "@/components/atoms";

interface CreateResponse {
  group: { id: string; name: string; code: string };
  memberId: string;
  memberToken: string;
}

export function LandingForms() {
  const router = useRouter();
  const [groupName, setGroupName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api<CreateResponse>("/api/groups", {
        method: "POST",
        body: { groupName, memberName },
      });
      saveIdentity(data.group.code, {
        memberId: data.memberId,
        memberName: memberName.trim(),
        memberToken: data.memberToken,
      });
      saveGroup({
        code: data.group.code,
        groupName: data.group.name,
        memberName: memberName.trim(),
        lastOpenedAt: Date.now(),
      });
      router.push(`/g/${data.group.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the group");
      setBusy(false);
    }
  }

  function openGroup(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code) router.push(`/g/${code}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-display text-lg font-semibold">Start a group</h2>
        <form onSubmit={createGroup} className="mt-3 space-y-3">
          <TextInput
            label="Group name"
            value={groupName}
            onChange={setGroupName}
            placeholder="Irfan family"
            required
          />
          <TextInput
            label="Your name"
            value={memberName}
            onChange={setMemberName}
            placeholder="Hareem"
            required
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create group"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="font-display text-lg font-semibold">
          Got an invite code?
        </h2>
        <form onSubmit={openGroup} className="mt-3 flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="e.g. K7MPX2"
            aria-label="Invite code"
            className="w-full flex-1 rounded-xl border border-hairline bg-card px-3 py-3 font-mono text-base uppercase tracking-widest text-ink placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-soft/60"
          />
          <Button type="submit" variant="quiet">
            Open
          </Button>
        </form>
      </Card>
    </div>
  );
}
