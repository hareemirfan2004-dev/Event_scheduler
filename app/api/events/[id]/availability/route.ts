import { prisma } from "@/lib/db";
import { ISO_DATE, jsonError, memberFromToken, readJson } from "@/lib/api-helpers";

const SLOTS = new Set(["ALL", "MORNING", "AFTERNOON", "EVENING"]);

type Entry = { date: string; slot: string };

/** Normalize busyDates + busySlots into rows; null when anything is malformed. */
function parseEntries(body: Record<string, unknown>): Entry[] | null {
  const entries: Entry[] = [];

  if (body.busyDates !== undefined) {
    if (!Array.isArray(body.busyDates)) return null;
    for (const date of body.busyDates) {
      if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
      entries.push({ date, slot: "ALL" });
    }
  }

  if (body.busySlots !== undefined) {
    if (!Array.isArray(body.busySlots)) return null;
    for (const raw of body.busySlots) {
      if (typeof raw !== "object" || raw === null) return null;
      const { date, slot } = raw as Record<string, unknown>;
      if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
      if (typeof slot !== "string" || !SLOTS.has(slot)) return null;
      entries.push({ date, slot });
    }
  }

  // De-duplicate (unique constraint on eventId+memberId+date+slot).
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.date}|${e.slot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid JSON body");

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return jsonError(404, "Event not found");

  const member = await memberFromToken(req, event.groupId);
  if (!member) return jsonError(401, "Join the group before saving availability");

  const entries = parseEntries(body);
  if (entries === null) return jsonError(400, "Invalid busy dates or slots");

  await prisma.$transaction([
    prisma.busyEntry.deleteMany({
      where: { eventId: event.id, memberId: member.id },
    }),
    prisma.busyEntry.createMany({
      data: entries.map((e) => ({
        eventId: event.id,
        memberId: member.id,
        date: e.date,
        slot: e.slot,
      })),
    }),
    prisma.response.upsert({
      where: {
        eventId_memberId: { eventId: event.id, memberId: member.id },
      },
      create: { eventId: event.id, memberId: member.id },
      update: { respondedAt: new Date() },
    }),
  ]);

  return Response.json({ saved: entries.length });
}
