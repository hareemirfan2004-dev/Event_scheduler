import { prisma } from "@/lib/db";
import { generateGroupCode, generateMemberToken } from "@/lib/codes";
import { cleanName, jsonError, readJson } from "@/lib/api-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limited = await enforceRateLimit("create-group", req);
  if (limited) return limited;

  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid JSON body");

  const groupName = cleanName(body.groupName, 60);
  const memberName = cleanName(body.memberName);
  if (!groupName) return jsonError(400, "Group name is required");
  if (!memberName) return jsonError(400, "Your name is required");

  // Retry on the (unlikely) chance of a code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGroupCode();
    try {
      const group = await prisma.group.create({
        data: {
          name: groupName,
          code,
          members: {
            create: { name: memberName, token: generateMemberToken() },
          },
        },
        include: { members: true },
      });
      return Response.json(
        {
          group: { id: group.id, name: group.name, code: group.code },
          memberId: group.members[0].id,
          memberToken: group.members[0].token,
        },
        { status: 201 },
      );
    } catch (e) {
      const isUniqueViolation =
        e instanceof Error && "code" in e && e.code === "P2002";
      if (!isUniqueViolation || attempt === 4) throw e;
    }
  }
  return jsonError(500, "Could not create group");
}
