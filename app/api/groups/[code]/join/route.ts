import { prisma } from "@/lib/db";
import { generateMemberToken } from "@/lib/codes";
import { cleanName, jsonError, readJson } from "@/lib/api-helpers";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid JSON body");

  const name = cleanName(body.name);
  if (!name) return jsonError(400, "Your name is required");

  const group = await prisma.group.findUnique({
    where: { code: code.toUpperCase() },
    include: { members: true },
  });
  if (!group) return jsonError(404, "Group not found");

  // Case-insensitive match in JS: portable across SQLite and Postgres,
  // and family groups are small.
  const existing = group.members.find(
    (m) => m.name.toLowerCase() === name.toLowerCase(),
  );

  if (existing) {
    if (body.claimExisting === true) {
      // Family trust model: claiming a name hands back that member's
      // identity so a second device (or cleared browser) keeps working.
      return Response.json({
        memberId: existing.id,
        memberName: existing.name,
        memberToken: existing.token,
      });
    }
    return jsonError(409, "name_taken");
  }

  const member = await prisma.member.create({
    data: { groupId: group.id, name, token: generateMemberToken() },
  });
  return Response.json(
    { memberId: member.id, memberName: member.name, memberToken: member.token },
    { status: 201 },
  );
}
