import { buildDemoPath, defaultDemoProfileSlug, type DemoProfileSlug } from "../data/demoProfiles";
import { summarizeInvoiceInventoryStatus } from "./invoiceInventory";
import { formatCurrency } from "../utils/format";
import type { InventoryInvoiceReceipt, PilotInvoiceRecord, PilotReconciliationRecord, PilotWorkspaceSummary } from "../types";

export type DemoWalkthroughStep = {
  title: string;
  detail: string;
  to: string;
  ctaLabel: string;
};

export type DemoCommandCenterSnapshot = {
  menu: {
    costedItems: number;
    marginRisks: number;
    squareReady: number;
    recipeLinks: number;
  };
  schedule: {
    staffCount: number;
    openShifts: number;
    conflicts: number;
    draftStatus: string;
  };
};

export type ExportReadinessStatus = "Ready" | "Needs invoice review" | "Needs mapping" | "Needs daily close review";

export interface ExportReadinessModel {
  purchaseCsv: ExportReadinessStatus;
  supplierSpendSummary: ExportReadinessStatus;
  categorySpendSummary: ExportReadinessStatus;
  inventoryMovementSummary: ExportReadinessStatus;
  dailyCloseSummary: ExportReadinessStatus;
  monthlyOwnerReport: ExportReadinessStatus;
  quickBooksStatus: "Future only";
  blockers: string[];
}

const demoCommandCenterSnapshots: Record<DemoProfileSlug, DemoCommandCenterSnapshot> = {
  cafe: {
    menu: { costedItems: 6, marginRisks: 2, squareReady: 4, recipeLinks: 6 },
    schedule: { staffCount: 6, openShifts: 1, conflicts: 1, draftStatus: "Draft" },
  },
  "quick-service": {
    menu: { costedItems: 10, marginRisks: 3, squareReady: 7, recipeLinks: 9 },
    schedule: { staffCount: 8, openShifts: 1, conflicts: 2, draftStatus: "Draft" },
  },
  "full-service": {
    menu: { costedItems: 14, marginRisks: 4, squareReady: 10, recipeLinks: 12 },
    schedule: { staffCount: 12, openShifts: 2, conflicts: 2, draftStatus: "Draft" },
  },
};

function countReviewNeededInvoices(invoices: PilotInvoiceRecord[]) {
  return invoices.filter((invoice) => invoice.status !== "Ready").length;
}

function countMappedButUnreceivedInvoices(invoices: PilotInvoiceRecord[], inventoryReceipts: InventoryInvoiceReceipt[]) {
  return invoices.filter((invoice) => invoice.status === "Ready" && summarizeInvoiceInventoryStatus(invoice, inventoryReceipts) === "Not received").length;
}

function isDailyCloseBlocked(summary: PilotWorkspaceSummary, reconciliations: PilotReconciliationRecord[]) {
  return summary.todayReconciliationStatus === "Incomplete" || summary.unresolvedReconciliationCount > 0 || reconciliations.some((record) => record.status !== "Balanced");
}

function statusFromBlockers(hasReviewQueue: boolean, hasMappingGap: boolean, hasCloseGap: boolean): ExportReadinessStatus {
  if (hasReviewQueue) {
    return "Needs invoice review";
  }
  if (hasMappingGap) {
    return "Needs mapping";
  }
  if (hasCloseGap) {
    return "Needs daily close review";
  }
  return "Ready";
}

function buildBlockers(hasReviewQueue: boolean, hasMappingGap: boolean, hasCloseGap: boolean) {
  const blockers: string[] = [];
  if (hasReviewQueue) {
    blockers.push("Review invoice OCR and line items");
  }
  if (hasMappingGap) {
    blockers.push("Map remaining invoice lines into inventory");
  }
  if (hasCloseGap) {
    blockers.push("Resolve the daily close variance");
  }
  return blockers;
}

export function buildDemoWalkthroughSteps(profileSlug: DemoProfileSlug = defaultDemoProfileSlug): DemoWalkthroughStep[] {
  const route = (segment: string) => buildDemoPath(profileSlug, segment);

  return [
    {
      title: "Capture a purchase",
      detail: "Upload or load a sample invoice or receipt.",
      to: route("purchases"),
      ctaLabel: "Open purchases",
    },
    {
      title: "Review line items",
      detail: "Confirm supplier, totals, and extracted items.",
      to: route("purchases"),
      ctaLabel: "Review items",
    },
    {
      title: "Receive into stock",
      detail: "Turn a saved purchase into inventory movement.",
      to: route("inventory"),
      ctaLabel: "Open inventory",
    },
    {
      title: "Check reorder needs",
      detail: "See which items are low and due to reorder.",
      to: route("inventory"),
      ctaLabel: "Check stock",
    },
    {
      title: "Review menu margin",
      detail: "See how item costs affect menu profitability.",
      to: route("menu-costing"),
      ctaLabel: "Open menu & costing",
    },
    {
      title: "Close the day",
      detail: "Compare POS, delivery, cash, and card totals.",
      to: route("close-reports"),
      ctaLabel: "Open close & reports",
    },
    {
      title: "Prepare export",
      detail: "Review the accountant-ready CSV and report status.",
      to: route("close-reports"),
      ctaLabel: "Open export",
    },
  ];
}

export function getDemoCommandCenterSnapshot(profileSlug: DemoProfileSlug = defaultDemoProfileSlug) {
  return demoCommandCenterSnapshots[profileSlug] ?? demoCommandCenterSnapshots[defaultDemoProfileSlug];
}

export function buildExportReadinessModel({
  invoices,
  inventoryReceipts,
  reconciliations,
  summary,
}: {
  invoices: PilotInvoiceRecord[];
  inventoryReceipts: InventoryInvoiceReceipt[];
  reconciliations: PilotReconciliationRecord[];
  summary: PilotWorkspaceSummary;
}): ExportReadinessModel {
  const reviewQueueCount = countReviewNeededInvoices(invoices);
  const mappingGapCount = countMappedButUnreceivedInvoices(invoices, inventoryReceipts);
  const closeGap = isDailyCloseBlocked(summary, reconciliations);
  const purchaseCsv = statusFromBlockers(reviewQueueCount > 0, reviewQueueCount === 0 && mappingGapCount > 0, false);
  const supplierSpendSummary = purchaseCsv === "Ready" ? "Ready" : purchaseCsv;
  const categorySpendSummary = purchaseCsv === "Ready" ? "Ready" : purchaseCsv;
  const inventoryMovementSummary = summary.inventoryMovementCount > 0 || summary.inventoryReceiptCount > 0 ? "Ready" : "Needs mapping";
  const dailyCloseSummary = statusFromBlockers(false, false, closeGap);
  const monthlyOwnerReport = purchaseCsv === "Ready" && inventoryMovementSummary === "Ready" && dailyCloseSummary === "Ready" ? "Ready" : dailyCloseSummary !== "Ready" ? dailyCloseSummary : purchaseCsv;

  return {
    purchaseCsv,
    supplierSpendSummary,
    categorySpendSummary,
    inventoryMovementSummary,
    dailyCloseSummary,
    monthlyOwnerReport,
    quickBooksStatus: "Future only",
    blockers: buildBlockers(reviewQueueCount > 0, reviewQueueCount === 0 && mappingGapCount > 0, closeGap),
  };
}

export function buildExportCsv(contentRows: Array<Record<string, string | number | null | undefined>>) {
  if (contentRows.length === 0) {
    return "";
  }

  const headers = Object.keys(contentRows[0]);
  const escapeCell = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  return [
    headers.join(","),
    ...contentRows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noreferrer";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { demoCommandCenterSnapshots };
