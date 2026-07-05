import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { computeMatches, type EventMode, type Slot } from "@/lib/matching";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      group: {
        include: {
          members: {
            select: { id: true, name: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      responses: { select: { memberId: true } },
      busyEntries: { select: { memberId: true, date: true, slot: true } },
    },
  });
  if (!event) return jsonError(404, "Event not found");

  const results = computeMatches({
    mode: event.mode as EventMode,
    windowStart: event.windowStart,
    windowEnd: event.windowEnd,
    durationDays: event.durationDays,
    members: event.group.members,
    respondedMemberIds: event.responses.map((r) => r.memberId),
    busyEntries: event.busyEntries.map((b) => ({
      memberId: b.memberId,
      date: b.date,
      slot: b.slot as Slot,
    })),
  });

  return Response.json({
    event: {
      id: event.id,
      title: event.title,
      mode: event.mode,
      windowStart: event.windowStart,
      windowEnd: event.windowEnd,
      durationDays: event.durationDays,
    },
    group: {
      id: event.group.id,
      name: event.group.name,
      code: event.group.code,
    },
    members: event.group.members,
    busyEntries: event.busyEntries,
    results,
  });
}
