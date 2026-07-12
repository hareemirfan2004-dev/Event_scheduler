import { describe, it, expect } from "vitest";
import { upsertGroup, removeFromList, type SavedGroup } from "@/lib/client/groups";

const g = (code: string, t: number): SavedGroup =>
  ({ code, groupName: code, memberName: "Me", lastOpenedAt: t });

describe("group list reducers", () => {
  it("upsert dedupes by code (case-insensitive) and keeps newest on top", () => {
    let list: SavedGroup[] = [];
    list = upsertGroup(list, g("ABC123", 1));
    list = upsertGroup(list, g("XYZ999", 2));
    list = upsertGroup(list, { ...g("abc123", 3), groupName: "Renamed" });
    expect(list.map((x) => x.code)).toEqual(["ABC123", "XYZ999"]); // no dup
    expect(list[0].code).toBe("ABC123");        // touched -> top
    expect(list[0].groupName).toBe("Renamed");  // fields updated
  });
  it("removeFromList drops by code", () => {
    const list = [g("ABC123", 1), g("XYZ999", 2)];
    expect(removeFromList(list, "ABC123").map((x) => x.code)).toEqual(["XYZ999"]);
  });
});
