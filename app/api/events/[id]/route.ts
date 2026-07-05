import { prisma } from "@/lib/db";
import { jsonError, memberFromToken } from "@/lib/api-helpers";
import { computeMatches, type EventMode, type Slot } from "@/lib/matching";

// Any member of the event's group may delete it (family trust model —
// events don't record a creator). Availability rows go with it via
// onDelete: Cascade.
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return jsonError(404, "Event not found");

  const member = await memberFromToken(req, event.groupId);
  if (!member) return jsonError(401, "Only group members can delete events");

  await prisma.event.delete({ where: { id } });
  return Response.json({ deleted: true });
}

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
