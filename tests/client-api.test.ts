import { describe, it, expect } from "vitest";
import { ApiError, loadErrorMessage } from "@/lib/client/api";

describe("loadErrorMessage", () => {
  const notFound = "No such thing.";
  const generic = "Could not load — try again.";

  it("maps 404 to the caller's not-found copy", () => {
    expect(
      loadErrorMessage(new ApiError(404, "Group not found"), notFound, generic),
    ).toBe(notFound);
  });

  it("surfaces the server's 429 copy", () => {
    const msg = "Too many attempts — please wait a few minutes and try again.";
    expect(loadErrorMessage(new ApiError(429, msg), notFound, generic)).toBe(msg);
  });

  it("falls back to generic copy for other errors", () => {
    expect(loadErrorMessage(new ApiError(500, "boom"), notFound, generic)).toBe(generic);
    expect(loadErrorMessage(new TypeError("fetch failed"), notFound, generic)).toBe(generic);
  });
});
