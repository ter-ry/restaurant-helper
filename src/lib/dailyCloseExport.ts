// CSV export of ONE COMPLETED Daily Close, built from its persisted frozen snapshot (summary_snapshot_json,
// serialized as session.summarySnapshot). It never reads live POS or report data, so it cannot drift after the close.
// It is deliberately separate from the live Owner Reports exports (src/lib/ownerReportExports.ts).
// Unavailable amounts stay EMPTY (never 0) and are described by the status/reason columns.
import { downloadCsvFile, type CsvCell } from "./reportExports";
import type { PilotDailyCloseSession, PilotDailyCloseSnapshot } from "../pilot/pilotApi";

export const DAILY_CLOSE_CSV_COLUMNS = [
  "businessDate", "location", "status", "completedAt",
  "grossSales", "discounts", "tax", "tips", "refunds", "netSales", "orders", "cancelledOrders",
  "expectedCash", "countedCash", "cashVariance", "cashVarianceStatus", "cashVarianceUnavailableReason",
  "squareClosedDrawerCash", "squareCountDifference", "observedExpectedCashUnverified", "notes",
] as const;

function amount(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "";
}

function count(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "";
}

/** The persisted frozen snapshot of a completed session; falls back to the session's returned snapshot only if the stored one is empty. */
export function frozenSnapshot(session: PilotDailyCloseSession): PilotDailyCloseSnapshot | null {
  const stored = session.summarySnapshot as Partial<PilotDailyCloseSnapshot> | undefined;
  if (stored && typeof stored === "object" && stored.sales) return stored as PilotDailyCloseSnapshot;
  return session.currentSnapshot ?? null;
}

/** One row for a completed close; no rows for a draft, so a draft can never be exported as if it were final. */
export function buildDailyCloseCsvRows(session: PilotDailyCloseSession, locationName: string): Array<Record<string, CsvCell>> {
  if (session.status !== "COMPLETED") return [];
  const snapshot = frozenSnapshot(session);
  const sales = (snapshot?.sales ?? {}) as Record<string, unknown>;
  const cash = (snapshot?.cashReconciliation ?? {}) as Record<string, unknown>;
  const variance = cash.overShort;
  const varianceAvailable = variance !== null && variance !== undefined && Number.isFinite(Number(variance)) && cash.varianceStatus !== "unavailable";
  const providerClosed = cash.providerClosedCash ?? cash.closedCash;
  const row: Record<string, CsvCell> = {
    businessDate: session.businessDate,
    location: locationName,
    status: session.status,
    completedAt: session.completedAt ?? "",
    grossSales: amount(sales.grossSales),
    discounts: amount(sales.discounts),
    tax: amount(sales.tax),
    tips: amount(sales.tips),
    refunds: amount(sales.refunds),
    netSales: amount(sales.netSales),
    orders: count(sales.orders),
    cancelledOrders: count(sales.cancelledOrders),
    expectedCash: amount(cash.expectedCash),
    countedCash: amount(cash.countedCash),
    cashVariance: varianceAvailable ? amount(variance) : "",
    cashVarianceStatus: varianceAvailable ? "available" : "unavailable",
    cashVarianceUnavailableReason: varianceAvailable ? "" : String(cash.varianceUnavailableReason ?? "Expected cash or counted cash is not available for this close."),
    squareClosedDrawerCash: amount(providerClosed),
    squareCountDifference: amount(cash.providerCountDifference),
    observedExpectedCashUnverified: amount(cash.partialExpectedCash),
    notes: session.notes ?? "",
  };
  return [row];
}

export function dailyCloseCsvFilename(session: PilotDailyCloseSession, locationName: string): string {
  const slug = locationName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "location";
  return `flowtally-daily-close-${slug}-${session.businessDate}.csv`;
}

/** Downloads the frozen close as CSV. Returns false (and downloads nothing) unless the session is completed. */
export function downloadDailyCloseCsv(session: PilotDailyCloseSession, locationName: string): boolean {
  const rows = buildDailyCloseCsvRows(session, locationName);
  if (rows.length === 0) return false;
  downloadCsvFile(dailyCloseCsvFilename(session, locationName), rows);
  return true;
}
