import { describe, expect, it } from "vitest";
import { buildCsv } from "../../src/lib/reportExports";
import {
  buildAuditCsvRows,
  buildPurchaseCsvRows,
  buildSummaryCsvRows,
  buildSummaryRows,
  isCloseCaughtUp,
  safeFilenamePart,
  type OwnerReportsData,
} from "../../src/lib/ownerReportExports";

// These are the actual client-side CSV exports (Owner Reports: summary, purchases, audit). They are LIVE views of the
// current dashboard/purchases/audit data. They contain no frozen Daily Close sales or cash figures; the only
// Daily Close content is the workflow status row, which the backend reports as Complete / In progress / Open.
function fixture(close: string, overrides: Partial<{ readyForCsv: number; needsReview: number; needsMapping: number; movements: number }> = {}): OwnerReportsData {
  const { readyForCsv = 3, needsReview = 0, needsMapping = 0, movements = 9 } = overrides;
  return {
    session: { organizations: [{ organization: { id: 42, name: "Queen St Cafe" }, selected: true }] },
    dashboard: {
      summary: { inventoryItemCount: 12, inventoryMovementCount: movements, recentPriceChangeCount: 2 },
      supplierSpend: [{ supplier: "Dairy Co", spend: 240.5, invoiceCount: 3 }],
      workflow: { purchase: "Done", review: "Done", inventory: "Updated", reorder: "Done", close, export: "Not ready" },
    },
    purchases: {
      exportReadiness: { readyForCsv, needsReview, needsMapping },
      invoices: [
        { invoiceDate: "2026-08-30", invoiceNumber: "INV-1001", supplier: { name: 'Dairy Co, "Fresh" Ltd' }, status: "Completed", totalAmount: 113, lineItems: [{}, {}] },
        { invoiceDate: "2026-08-29", invoiceNumber: "INV-1000", supplier: null, status: "Draft", totalAmount: 20.5, lineItems: [] },
      ],
    },
    auditEvents: [
      { createdAt: "2026-08-30T21:00:00Z", eventType: "daily_close.finalized", entityType: "daily_close_session", entityId: 7, locationId: 3, metadata: { note: "short, by $10" } },
      { createdAt: "2026-08-30T20:00:00Z", eventType: "login", entityType: "user", entityId: null, locationId: null, metadata: null },
    ],
  } as unknown as OwnerReportsData;
}

const summaryCsv = (close: string, overrides = {}) => buildCsv(buildSummaryCsvRows(buildSummaryRows(fixture(close, overrides))));

describe("owner report CSV exports (exact values)", () => {
  it("exports the full summary CSV with a completed close as the backend reports it", () => {
    expect(summaryCsv("Complete")).toBe([
      "section,status,detail",
      "Purchase CSV,Ready,3 invoices are ready for bookkeeping export.",
      "Supplier spend,Ready,Dairy Co leads spending this period.",
      "Inventory summary,Ready,12 items and 9 movement records tracked.",
      "Daily close,Complete,Close workflow is caught up.",
      "Price changes,Captured,2 recent price changes flagged.",
      "Monthly owner report,Ready,Queen St Cafe is ready for the accountant handoff when the blockers clear.",
      "Audit trail,Ready,2 audit events captured for the current organization.",
    ].join("\n"));
  });

  it("does not call an unfinished close caught up: In progress and Open need attention and block the monthly report", () => {
    for (const close of ["In progress", "Open"]) {
      const csv = summaryCsv(close).split("\n");
      expect(csv).toContain(`Daily close,${close},Daily close still needs attention.`);
      expect(csv).toContain("Monthly owner report,Needs review,Queen St Cafe is ready for the accountant handoff when the blockers clear.");
    }
  });

  it("treats the backend's Complete and the legacy Done as caught up, nothing else", () => {
    expect(isCloseCaughtUp("Complete")).toBe(true);
    expect(isCloseCaughtUp("Done")).toBe(true);
    for (const other of ["In progress", "Open", "", undefined, "complete"]) expect(isCloseCaughtUp(other as string | undefined)).toBe(false);
  });

  it("keeps the monthly report blocked by unreviewed purchases even when the close is complete", () => {
    expect(summaryCsv("Complete", { needsReview: 1 }).split("\n")).toContain("Purchase CSV,Needs review,3 invoices are ready for bookkeeping export.");
    expect(summaryCsv("Complete", { needsReview: 1 })).toContain("Monthly owner report,Needs review,");
    expect(summaryCsv("Complete", { movements: 0 })).toContain("Monthly owner report,Needs review,");
  });

  it("exports purchases with exact values and CSV escaping, capped at 20 rows", () => {
    expect(buildCsv(buildPurchaseCsvRows(fixture("Complete")))).toBe([
      "invoiceDate,invoiceNumber,supplier,status,totalAmount,lineCount",
      '2026-08-30,INV-1001,"Dairy Co, ""Fresh"" Ltd",Completed,113,2',
      "2026-08-29,INV-1000,,Draft,20.5,0",
    ].join("\n"));
    const many = fixture("Complete");
    many.purchases.invoices = Array.from({ length: 25 }, (_, i) => ({ ...(fixture("Complete").purchases.invoices[0]), invoiceNumber: `N${i}` })) as never;
    expect(buildPurchaseCsvRows(many)).toHaveLength(20);
  });

  it("exports audit events with exact values, JSON metadata escaped, capped at 50 rows", () => {
    expect(buildCsv(buildAuditCsvRows(fixture("Complete").auditEvents))).toBe([
      "createdAt,eventType,entityType,entityId,locationId,metadata",
      '2026-08-30T21:00:00Z,daily_close.finalized,daily_close_session,7,3,"{""note"":""short, by $10""}"',
      "2026-08-30T20:00:00Z,login,user,,,",
    ].join("\n"));
    const events = Array.from({ length: 60 }, (_, i) => ({ ...fixture("Complete").auditEvents[1], entityId: i }));
    expect(buildAuditCsvRows(events as never)).toHaveLength(50);
  });

  it("builds a safe download file name", () => {
    expect(safeFilenamePart("Queen St Cafe & Bar!")).toBe("queen-st-cafe-bar");
    expect(safeFilenamePart("   ")).toBe("organization");
    expect(safeFilenamePart("A".repeat(60))).toHaveLength(32);
  });
});
