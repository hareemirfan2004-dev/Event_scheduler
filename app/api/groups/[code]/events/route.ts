import { prisma } from "@/lib/db";
import {
  ISO_DATE,
  cleanName,
  jsonError,
  memberFromToken,
  readJson,
} from "@/lib/api-helpers";

const MAX_WINDOW_DAYS = 366;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid JSON body");

  const group = await prisma.group.findUnique({
    where: { code: code.toUpperCase() },
  });
  if (!group) return jsonError(404, "Group not found");

  const member = await memberFromToken(req, group.id);
  if (!member) return jsonError(401, "Join the group before creating events");

  const title = cleanName(body.title, 80);
  if (!title) return jsonError(400, "Event title is required");

  const mode = body.mode === "SLOT" ? "SLOT" : body.mode === "DAY" ? "DAY" : null;
  if (!mode) return jsonError(400, "Mode must be DAY or SLOT");

  const windowStart = body.windowStart;
  const windowEnd = body.windowEnd;
  if (
    typeof windowStart !== "string" ||
    typeof windowEnd !== "string" ||
    !ISO_DATE.test(windowStart) ||
    !ISO_DATE.test(windowEnd)
  ) {
    return jsonError(400, "Dates must be YYYY-MM-DD");
  }
  if (windowEnd < windowStart) {
    return jsonError(400, "The window must end after it starts");
  }
  const windowDays =
    (Date.parse(`${windowEnd}T00:00:00Z`) -
      Date.parse(`${windowStart}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (windowDays > MAX_WINDOW_DAYS) {
    return jsonError(400, "Window can be at most a year");
  }

  const durationDays = mode === "DAY" ? Number(body.durationDays ?? 1) : 1;
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > windowDays) {
    return jsonError(400, "Duration must fit inside the window");
  }

  const event = await prisma.event.create({
    data: { groupId: group.id, title, mode, windowStart, windowEnd, durationDays },
  });
  return Response.json({ event }, { status: 201 });
}
