import { describe, expect, it } from "vitest";
import { formatLocationDateTime, locationDatetimeLocalToUtcIso, locationNowDatetimeLocal } from "../../src/pilot/workspace/timezone";

describe("restaurant timezone utilities", () => {
  it("renders and converts Toronto summer and winter local times through UTC", () => {
    expect(locationDatetimeLocalToUtcIso("2026-07-15T09:30", "America/Toronto")).toBe("2026-07-15T13:30:00.000Z");
    expect(locationDatetimeLocalToUtcIso("2026-01-15T09:30", "America/Toronto")).toBe("2026-01-15T14:30:00.000Z");
    expect(formatLocationDateTime("2026-07-15T13:30:00.000Z", "America/Toronto")).toContain("9:30");
  });

  it("uses the active location timezone rather than browser UTC", () => {
    expect(locationDatetimeLocalToUtcIso("2026-07-15T09:30", "America/Vancouver")).toBe("2026-07-15T16:30:00.000Z");
    expect(locationNowDatetimeLocal("America/Vancouver", new Date("2026-07-15T16:30:00.000Z"))).toBe("2026-07-15T09:30");
  });
});
