import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("database smoke test", () => {
  it("connects, writes and reads back a group", async () => {
    const code = `smoke-${Date.now()}`;
    const created = await prisma.group.create({
      data: { name: "Smoke Test Group", code },
    });
    try {
      const found = await prisma.group.findUnique({ where: { code } });
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Smoke Test Group");
    } finally {
      await prisma.group.delete({ where: { id: created.id } });
    }
  });
});
