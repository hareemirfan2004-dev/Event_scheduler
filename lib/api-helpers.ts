import { prisma } from "@/lib/db";

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** Parse a JSON body, returning null on malformed input. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Trimmed non-empty string field, else null. */
export function cleanName(value: unknown, maxLength = 40): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve the member behind an x-member-token header, scoped to a group. */
export async function memberFromToken(req: Request, groupId: string) {
  const token = req.headers.get("x-member-token");
  if (!token) return null;
  const member = await prisma.member.findUnique({ where: { token } });
  if (!member || member.groupId !== groupId) return null;
  return member;
}
