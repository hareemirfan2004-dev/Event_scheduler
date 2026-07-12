import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const limited = await enforceRateLimit("read-group", req);
  if (limited) return limited;

  const { code } = await ctx.params;
  const group = await prisma.group.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      members: {
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: {
          id: true,
          title: true,
          mode: true,
          windowStart: true,
          windowEnd: true,
          durationDays: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!group) return jsonError(404, "Group not found");

  return Response.json({
    group: { id: group.id, name: group.name, code: group.code },
    members: group.members,
    events: group.events,
  });
}
