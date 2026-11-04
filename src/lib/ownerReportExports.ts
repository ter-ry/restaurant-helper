// Pure builders behind the Owner Reports CSV downloads. The summary, purchase and audit CSVs are live views of
// current data; the Daily Close CSV exports the frozen figures of finalized sessions. Tested with exact CSV text.
import type { CustomerSessionResponse } from "./customerAuth";
import type { CustomerAuditEvent } from "./audit";
import type { PilotDailyCloseSession, PilotDashboardResponse, PilotPurchasesResponse } from "../pilot/pilotApi";

export type OwnerReportsData = {
  session: CustomerSessionResponse;
  dashboard: PilotDashboardResponse;
  purchases: PilotPurchasesResponse;
  auditEvents: CustomerAuditEvent[];
  /** Daily Close session history from /api/pilot/daily-close; finalized sessions carry the frozen figures. */
  dailyCloseHistory?: PilotDailyCloseSession[];
};

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusRow = {
  section: string;
  status: string;
  detail: string;
  tone: StatusTone;
};

/** /api/pilot/dashboard sends today's close as "Complete" (finalized), "In progress" (draft) or "Open"; older fixtures used "Done". */
export function isCloseCaughtUp(status: string | undefined) {
  return status === "Complete" || status === "Done";
}

export function toneForStatus(status: string): StatusTone {
  if (status === "Ready" || status === "Done" || status === "Balanced" || status === "Captured") {
    return "success";
  }
  if (status === "Needs review" || status === "Needs mapping" || status === "Not ready" || status === "Incomplete") {
    return "warning";
  }
  if (status === "No events") {
    return "info";
  }
  return "neutral";
}

export function safeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "organization";
}

export function buildSummaryRows(data: OwnerReportsData): StatusRow[] {
  const activeOrganization = data.session.organizations?.find((entry) => entry.selected)?.organization ?? null;
  const purchaseReady = data.purchases.exportReadiness.readyForCsv;
  const needsReview = data.purchases.exportReadiness.needsReview;
  const needsMapping = data.purchases.exportReadiness.needsMapping;
  const exportStatus = purchaseReady > 0 && needsReview === 0 && needsMapping === 0 ? "Ready" : needsReview > 0 ? "Needs review" : needsMapping > 0 ? "Needs mapping" : "Not ready";
  const monthlyStatus = exportStatus === "Ready" && (data.dashboard.summary.inventoryMovementCount ?? 0) > 0 && isCloseCaughtUp(data.dashboard.workflow.close) ? "Ready" : "Needs review";

  return [
    {
      section: "Purchase CSV",
      status: exportStatus,
      detail: `${purchaseReady} invoices are ready for bookkeeping export.`,
      tone: toneForStatus(exportStatus),
    },
    {
      section: "Supplier spend",
      status: data.dashboard.supplierSpend.length > 0 ? "Ready" : "Not ready",
      detail: data.dashboard.supplierSpend.length > 0 ? `${data.dashboard.supplierSpend[0].supplier} leads spending this period.` : "No supplier spend is available yet.",
      tone: toneForStatus(data.dashboard.supplierSpend.length > 0 ? "Ready" : "Not ready"),
    },
    {
      section: "Inventory summary",
      status: (data.dashboard.summary.inventoryItemCount ?? 0) > 0 ? "Ready" : "Not ready",
      detail: `${data.dashboard.summary.inventoryItemCount ?? 0} items and ${(data.dashboard.summary.inventoryMovementCount ?? 0)} movement records tracked.`,
      tone: toneForStatus((data.dashboard.summary.inventoryItemCount ?? 0) > 0 ? "Ready" : "Not ready"),
    },
    {
      section: "Daily close",
      status: data.dashboard.workflow.close,
      detail: isCloseCaughtUp(data.dashboard.workflow.close) ? "Close workflow is caught up." : "Daily close still needs attention.",
      tone: isCloseCaughtUp(data.dashboard.workflow.close) ? "success" : toneForStatus(data.dashboard.workflow.close),
    },
    {
      section: "Price changes",
      status: (data.dashboard.summary.recentPriceChangeCount ?? 0) > 0 ? "Captured" : "No events",
      detail: (data.dashboard.summary.recentPriceChangeCount ?? 0) > 0 ? `${data.dashboard.summary.recentPriceChangeCount} recent price changes flagged.` : "No price changes were detected.",
      tone: toneForStatus((data.dashboard.summary.recentPriceChangeCount ?? 0) > 0 ? "Captured" : "No events"),
    },
    {
      section: "Monthly owner report",
      status: monthlyStatus,
      detail: activeOrganization ? `${activeOrganization.name} is ready for the accountant handoff when the blockers clear.` : "Select an organization to continue.",
      tone: toneForStatus(monthlyStatus),
    },
    {
      section: "Audit trail",
      status: data.auditEvents.length > 0 ? "Ready" : "No events",
      detail: data.auditEvents.length > 0 ? `${data.auditEvents.length} audit events captured for the current organization.` : "No audit events have been recorded yet.",
      tone: toneForStatus(data.auditEvents.length > 0 ? "Ready" : "No events"),
    },
  ];
}

export function buildSummaryCsvRows(rows: StatusRow[]) {
  return rows.map((row) => ({
    section: row.section,
    status: row.status,
    detail: row.detail,
  }));
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : "");

/** One row per finalized Daily Close session, using the figures frozen at finalize (never live recalculation). */
export function buildDailyCloseCsvRows(sessions: PilotDailyCloseSession[] = []) {
  return sessions
    .filter((session) => session.status === "COMPLETED")
    .map((session) => {
      const snapshot = (session.summarySnapshot ?? {}) as Record<string, any>;
      const sales = (snapshot.sales ?? {}) as Record<string, unknown>;
      const cash = (snapshot.cashReconciliation ?? {}) as Record<string, unknown>;
      return {
        businessDate: session.businessDate,
        completedAt: session.completedAt ?? "",
        grossSales: num(sales.grossSales),
        refunds: num(sales.refunds),
        tips: num(sales.tips),
        netSales: num(sales.netSales),
        expectedCash: num(cash.expectedCash),
        countedCash: num(cash.countedCash ?? snapshot.manualReconciliation?.countedCash),
        cashOverShort: num(cash.overShort),
        notes: session.notes ?? "",
      };
    })
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate));
}

export function buildPurchaseCsvRows(data: OwnerReportsData) {
  return [...data.purchases.invoices]
    .slice(0, 20)
    .map((invoice) => ({
      invoiceDate: invoice.invoiceDate,
      invoiceNumber: invoice.invoiceNumber,
      supplier: invoice.supplier?.name ?? "",
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      lineCount: invoice.lineItems.length,
    }));
}

export function buildAuditCsvRows(events: CustomerAuditEvent[]) {
  return events.slice(0, 50).map((event) => ({
    createdAt: event.createdAt,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId ?? "",
    locationId: event.locationId ?? "",
    metadata: event.metadata ? JSON.stringify(event.metadata) : "",
  }));
}

