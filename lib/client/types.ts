// Shapes returned by the API, as consumed by the client.
import type { MatchResults } from "@/lib/matching";

export interface MemberInfo {
  id: string;
  name: string;
}

export interface EventSummary {
  id: string;
  title: string;
  mode: "DAY" | "SLOT";
  windowStart: string;
  windowEnd: string;
  durationDays: number;
  createdAt: string;
}

export interface GroupPayload {
  group: { id: string; name: string; code: string };
  members: MemberInfo[];
  events: EventSummary[];
}

export interface EventPayload {
  event: Omit<EventSummary, "createdAt">;
  group: { id: string; name: string; code: string };
  members: MemberInfo[];
  busyEntries: { memberId: string; date: string; slot: string }[];
  results: MatchResults;
}
