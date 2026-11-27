import { describe, expect, it } from "vitest";
import { calendarWeekRange, customRange, lastSevenDaysRange, rangeLabel } from "../../src/pilot/reports/reportDateRange";

describe("report date ranges", () => {
  it("uses Monday through Sunday for This week", () => {
    expect(calendarWeekRange("2026-11-27")).toEqual({ startDate: "2026-11-23", endDate: "2026-11-29", preset: "this-week" });
  });

  it("keeps Last 7 days distinct from the calendar week", () => {
    expect(lastSevenDaysRange("2026-11-27")).toEqual({ startDate: "2026-11-21", endDate: "2026-11-27", preset: "last-7-days" });
  });

  it("rejects an inverted custom range", () => {
    expect(() => customRange("2026-11-28", "2026-11-27")).toThrow("on or before");
  });

  it("makes the applied range explicit", () => {
    expect(rangeLabel(customRange("2026-11-23", "2026-11-29"))).toContain("Nov 23, 2026");
  });
});
