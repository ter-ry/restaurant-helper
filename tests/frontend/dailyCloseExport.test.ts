import { describe, expect, it, vi } from "vitest";
import { buildCsv } from "../../src/lib/reportExports";
import { buildDailyCloseCsvRows, dailyCloseCsvFilename, downloadDailyCloseCsv } from "../../src/lib/dailyCloseExport";
import type { PilotDailyCloseSession } from "../../src/pilot/pilotApi";

const HEADER = "businessDate,location,status,completedAt,grossSales,discounts,tax,tips,refunds,netSales,orders,cancelledOrders,expectedCash,countedCash,cashVariance,cashVarianceStatus,cashVarianceUnavailableReason,squareClosedDrawerCash,squareCountDifference,observedExpectedCashUnverified,notes";

function session(summarySnapshot: Record<string, unknown>, over: Partial<PilotDailyCloseSession> = {}): PilotDailyCloseSession {
  return {
    id: 7, organizationId: 1, locationId: 3, businessDate: "2026-08-30", status: "COMPLETED", summarySnapshot, usageSnapshot: {}, exceptionsSnapshot: [],
    notes: "", completedAt: "2026-08-31T02:00:00+00:00", completedByUserId: 1, createdByUserId: 1, createdAt: null, updatedAt: null, ...over,
  } as PilotDailyCloseSession;
}

const SALES = { grossSales: 1000, discounts: 50, tax: 123.5, tips: 80, refunds: 40, netSales: 910, orders: 42, cancelledOrders: 2 };
const csv = (s: PilotDailyCloseSession) => buildCsv(buildDailyCloseCsvRows(s, "Queen St Cafe"));

describe("completed Daily Close CSV (frozen snapshot, exact values)", () => {
  it("exports sales, expected cash, counted cash, variance, status and Square evidence", () => {
    const out = csv(session({
      sales: SALES,
      cashReconciliation: { expectedCash: 500, countedCash: 490, overShort: -10, varianceStatus: "available", providerClosedCash: 495, providerCountDifference: -5 },
    }));
    expect(out).toBe([
      HEADER,
      "2026-08-30,Queen St Cafe,COMPLETED,2026-08-31T02:00:00+00:00,1000.00,50.00,123.50,80.00,40.00,910.00,42,2,500.00,490.00,-10.00,available,,495.00,-5.00,,",
    ].join("\n"));
  });

  it("keeps an unverified expected cash empty and explains why, never writing 0", () => {
    const out = csv(session({
      sales: SALES,
      cashReconciliation: {
        expectedCash: null, partialExpectedCash: 500, countedCash: 480, overShort: null, varianceStatus: "unavailable",
        varianceUnavailableReason: "A Square cash drawer is still open for this business date. Expected cash can be verified once every drawer is closed.",
      },
    }));
    expect(out.split("\n")[1]).toBe(
      "2026-08-30,Queen St Cafe,COMPLETED,2026-08-31T02:00:00+00:00,1000.00,50.00,123.50,80.00,40.00,910.00,42,2,,480.00,,unavailable,A Square cash drawer is still open for this business date. Expected cash can be verified once every drawer is closed.,,,500.00,",
    );
  });

  it("keeps a missing staff count empty while still exporting the verified expected cash and Square's count", () => {
    const row = buildDailyCloseCsvRows(session({
      sales: SALES,
      cashReconciliation: { expectedCash: 500, overShort: null, varianceStatus: "unavailable", varianceUnavailableReason: "Enter the physically counted cash to calculate the variance.", providerClosedCash: 495 },
    }), "Queen St Cafe")[0];
    expect(row).toMatchObject({ expectedCash: "500.00", countedCash: "", cashVariance: "", cashVarianceStatus: "unavailable", squareClosedDrawerCash: "495.00", squareCountDifference: "" });
    expect(row.cashVarianceUnavailableReason).toBe("Enter the physically counted cash to calculate the variance.");
  });

  it("exports no cash figures at all when Square gave no cash evidence, but keeps a genuine zero-sales day as 0.00", () => {
    const row = buildDailyCloseCsvRows(session({
      sales: { grossSales: 0, discounts: 0, tax: 0, tips: 0, refunds: 0, netSales: 0, orders: 0, cancelledOrders: 0 },
      cashReconciliation: { status: "unavailable", expectedCash: null, overShort: null },
    }), "Queen St Cafe")[0];
    expect(row).toMatchObject({ grossSales: "0.00", netSales: "0.00", orders: "0", expectedCash: "", countedCash: "", cashVariance: "", cashVarianceStatus: "unavailable" });
    expect(row.cashVarianceUnavailableReason).toBe("Expected cash or counted cash is not available for this close.");
  });

  it("leaves sales cells empty (not zero) when the frozen snapshot has no figure for them", () => {
    const row = buildDailyCloseCsvRows(session({ sales: { netSales: 910 } }), "Queen St Cafe")[0];
    expect(row).toMatchObject({ grossSales: "", tax: "", tips: "", refunds: "", orders: "", netSales: "910.00" });
  });

  it("is a zero variance when staff counted exactly the verified expected cash (a real 0.00, status available)", () => {
    const row = buildDailyCloseCsvRows(session({ sales: SALES, cashReconciliation: { expectedCash: 500, countedCash: 500, overShort: 0, varianceStatus: "available" } }), "Queen St Cafe")[0];
    expect(row).toMatchObject({ cashVariance: "0.00", cashVarianceStatus: "available", cashVarianceUnavailableReason: "" });
  });

  it("uses the persisted frozen snapshot, not the live figures the session may also carry", () => {
    const frozen = session({ sales: SALES, cashReconciliation: { expectedCash: 500, countedCash: 490, overShort: -10, varianceStatus: "available" } });
    frozen.currentSnapshot = { sales: { ...SALES, netSales: 1234, orders: 99 }, cashReconciliation: { expectedCash: 999, countedCash: 1, overShort: -998 } } as never;
    const row = buildDailyCloseCsvRows(frozen, "Queen St Cafe")[0];
    expect(row).toMatchObject({ netSales: "910.00", orders: "42", expectedCash: "500.00", cashVariance: "-10.00" });
  });

  it("escapes notes containing commas, quotes and line breaks", () => {
    const out = csv(session({ sales: SALES }, { notes: 'Short, "tip jar"\nrechecked' }));
    expect(out.endsWith(',"Short, ""tip jar""\nrechecked"')).toBe(true);
  });

  it("exports nothing for a draft close, so a draft cannot pass as final", () => {
    const draft = session({ sales: SALES }, { status: "DRAFT", completedAt: null });
    expect(buildDailyCloseCsvRows(draft, "Queen St Cafe")).toEqual([]);
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    expect(downloadDailyCloseCsv(draft, "Queen St Cafe")).toBe(false);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it("names the file from the location and business date", () => {
    expect(dailyCloseCsvFilename(session({}), "Queen St Cafe & Bar!")).toBe("flowtally-daily-close-queen-st-cafe-bar-2026-08-30.csv");
    expect(dailyCloseCsvFilename(session({}), "  ")).toBe("flowtally-daily-close-location-2026-08-30.csv");
  });
});
