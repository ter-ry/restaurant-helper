import { buildReorderSuggestions } from "./inventoryOperations";
import { summarizeInvoiceInventoryStatus } from "./invoiceInventory";
import { normalizeComparisonKey } from "./invoiceLineItemView";
import { dateValueToMillis } from "../utils/format";
import type {
  InventoryInvoiceReceipt,
  InventoryItem,
  InventoryReorderIntent,
  PilotInvoiceLineItem,
  PilotInvoiceRecord,
  PilotPriceChangeRecord,
  PilotReconciliationRecord,
  PilotWorkspaceSummary,
  PriceStatus,
} from "../types";

const confidenceThreshold = 0.8;
function roundMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function safeSupplierName(value: string | undefined | null) {
  return value?.trim() || "Unknown supplier";
}

function safeComparisonKey(item: Pick<PilotInvoiceLineItem, "comparisonKey" | "itemName" | "originalDescription" | "rawSourceLine">) {
  return normalizeComparisonKey(item.comparisonKey || item.originalDescription || item.itemName || item.rawSourceLine || "");
}

function safeDateMillis(value: string | undefined | null) {
  return dateValueToMillis(value ?? undefined);
}

function getMonthStartMillis(referenceDate: Date) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1).getTime();
}

export interface OwnerDashboardCard {
  label: string;
  value: string;
  helper: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface OwnerDashboardSupplierSpendRow {
  supplier: string;
  spend: number;
  invoiceCount: number;
  latestInvoiceDate: string;
  share: number;
}

export interface OwnerDashboardCostChangeRow {
  itemName: string;
  supplier: string;
  previousUnitPrice: number;
  currentUnitPrice: number;
  deltaAmount: number;
  changePercent: number;
  invoiceDate: string;
  previousInvoiceDate: string;
  status: PilotPriceChangeRecord["status"];
}

export interface OwnerDashboardItemRow {
  itemName: string;
  supplierLabel: string;
  totalSpend: number;
  quantity: number;
  latestUnitPrice: number;
  latestInvoiceDate: string;
  previousUnitPrice: number | null;
  priceMovement: PriceStatus | null;
}

export interface OwnerDashboardAttentionRow {
  title: string;
  detail: string;
  ctaLabel: string;
  to: string;
  tone: "neutral" | "warning" | "danger" | "info" | "success";
}

export interface OwnerDashboardModel {
  cards: OwnerDashboardCard[];
  supplierSpend: OwnerDashboardSupplierSpendRow[];
  costChanges: OwnerDashboardCostChangeRow[];
  topItems: OwnerDashboardItemRow[];
  reorderSuggestions: ReturnType<typeof buildReorderSuggestions>;
  needsAttention: OwnerDashboardAttentionRow[];
  monthToDateSpend: number;
  monthToDateInvoiceCount: number;
  monthSourceLabel: string;
  priceIncreaseCount: number;
  lowConfidenceLineCount: number;
  actionableInvoiceCount: number;
  pendingInventoryInvoiceCount: number;
  skippedInventoryInvoiceCount: number;
  dailyCloseStatus: PilotWorkspaceSummary["todayReconciliationStatus"];
  dailyCloseVariance: number;
  dailyCloseDate: string;
  unresolvedDailyCloseCount: number;
}

export interface OwnerDashboardInput {
  invoices: PilotInvoiceRecord[];
  reviewQueue: PilotInvoiceRecord[];
  priceChanges: PilotPriceChangeRecord[];
  unresolvedReconciliations: PilotReconciliationRecord[];
  inventoryItems: InventoryItem[];
  inventoryReorderIntents: InventoryReorderIntent[];
  inventoryReceipts: InventoryInvoiceReceipt[];
  summary: PilotWorkspaceSummary;
  referenceDate?: Date;
}

function buildSupplierSpendRows(invoices: PilotInvoiceRecord[]): OwnerDashboardSupplierSpendRow[] {
  const totals = new Map<string, {
    supplier: string;
    spend: number;
    invoiceIds: Set<string>;
    latestInvoiceDate: string;
    latestMillis: number;
  }>();

  for (const invoice of invoices) {
    const total = Number.isFinite(invoice.totalAmount) ? Number(invoice.totalAmount) : 0;
    if (total <= 0) {
      continue;
    }

    const supplier = safeSupplierName(invoice.supplier);
    const current = totals.get(supplier) ?? {
      supplier,
      spend: 0,
      invoiceIds: new Set<string>(),
      latestInvoiceDate: "",
      latestMillis: Number.NEGATIVE_INFINITY,
    };

    current.spend += total;
    current.invoiceIds.add(invoice.id);
    const millis = safeDateMillis(invoice.invoiceDate);
    if (millis > current.latestMillis) {
      current.latestMillis = millis;
      current.latestInvoiceDate = invoice.invoiceDate || "";
    }

    totals.set(supplier, current);
  }

  const rows = [...totals.values()].map((row) => ({
    supplier: row.supplier,
    spend: roundMoney(row.spend),
    invoiceCount: row.invoiceIds.size,
    latestInvoiceDate: row.latestInvoiceDate,
    share: 0,
  }));

  const grandTotal = rows.reduce((sum, row) => sum + row.spend, 0);
  return rows
    .map((row) => ({
      ...row,
      share: grandTotal > 0 ? Number(((row.spend / grandTotal) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.spend - a.spend || b.invoiceCount - a.invoiceCount || safeDateMillis(b.latestInvoiceDate) - safeDateMillis(a.latestInvoiceDate) || a.supplier.localeCompare(b.supplier));
}

function buildCostChangeRows(priceChanges: PilotPriceChangeRecord[]) {
  return [...priceChanges]
    .filter((change) => Number.isFinite(change.previousPrice) && Number.isFinite(change.currentPrice) && Number.isFinite(change.changePercent))
    .sort((a, b) => {
      const statusRank = (status: PilotPriceChangeRecord["status"]) => (status === "Increased" ? 0 : status === "Decreased" ? 1 : 2);
      const rankDelta = statusRank(a.status) - statusRank(b.status);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      if (a.status === "Increased") {
        return b.changePercent - a.changePercent || safeDateMillis(b.invoiceDate) - safeDateMillis(a.invoiceDate);
      }

      if (a.status === "Decreased") {
        return safeDateMillis(b.invoiceDate) - safeDateMillis(a.invoiceDate) || Math.abs(b.changePercent) - Math.abs(a.changePercent);
      }

      return safeDateMillis(b.invoiceDate) - safeDateMillis(a.invoiceDate);
    })
    .map((change) => ({
      itemName: change.itemName || "Untitled item",
      supplier: safeSupplierName(change.supplier),
      previousUnitPrice: roundMoney(change.previousPrice),
      currentUnitPrice: roundMoney(change.currentPrice),
      deltaAmount: roundMoney(change.currentPrice - change.previousPrice),
      changePercent: Number(change.changePercent.toFixed(1)),
      invoiceDate: change.invoiceDate || "",
      previousInvoiceDate: change.previousInvoiceDate || "",
      status: change.status,
    }));
}

function buildTopPurchasedItems(invoices: PilotInvoiceRecord[]): OwnerDashboardItemRow[] {
  type ItemGroup = {
    itemName: string;
    suppliers: Set<string>;
    totalSpend: number;
    quantity: number;
    latestUnitPrice: number;
    previousUnitPrice: number | null;
    latestInvoiceDate: string;
    latestMillis: number;
  };

  const groups = new Map<string, ItemGroup>();

  for (const invoice of invoices) {
    for (const line of invoice.lineItems || []) {
      const key = safeComparisonKey(line);
      if (!key) {
        continue;
      }

      const lineTotal = Number.isFinite(line.lineTotal) ? Number(line.lineTotal) : Number((Number(line.quantity || 0) * Number(line.unitPrice || 0)).toFixed(2));
      const quantity = Number.isFinite(line.quantity) ? Number(line.quantity) : 0;
      const unitPrice = Number.isFinite(line.unitPrice) ? Number(line.unitPrice) : 0;
      const supplier = safeSupplierName(invoice.supplier);
      const current = groups.get(key) ?? {
        itemName: line.originalDescription?.trim() || line.itemName?.trim() || "Line item",
        suppliers: new Set<string>(),
        totalSpend: 0,
        quantity: 0,
        latestUnitPrice: 0,
        previousUnitPrice: null as number | null,
        latestInvoiceDate: "",
        latestMillis: Number.NEGATIVE_INFINITY,
      };

      current.suppliers.add(supplier);
      current.totalSpend += Number.isFinite(lineTotal) ? lineTotal : 0;
      if (Number.isFinite(quantity) && quantity > 0) {
        current.quantity += quantity;
      }
      const millis = safeDateMillis(invoice.invoiceDate);
      if (millis > current.latestMillis) {
        if (current.latestMillis > Number.NEGATIVE_INFINITY) {
          current.previousUnitPrice = current.latestUnitPrice;
        }
        current.latestMillis = millis;
        current.latestInvoiceDate = invoice.invoiceDate || "";
        current.latestUnitPrice = unitPrice;
      } else if (millis === current.latestMillis && unitPrice !== current.latestUnitPrice) {
        current.previousUnitPrice = current.latestUnitPrice;
        current.latestUnitPrice = unitPrice;
      }
      if ((line.originalDescription?.trim()?.length ?? 0) > current.itemName.length) {
        current.itemName = line.originalDescription!.trim();
      }

      groups.set(key, current);
    }
  }

  return [...groups.values()]
    .map((row) => ({
      itemName: row.itemName,
      supplierLabel: row.suppliers.size === 1 ? [...row.suppliers][0] : "Mixed suppliers",
      totalSpend: roundMoney(row.totalSpend),
      quantity: Number(row.quantity.toFixed(2)),
      latestUnitPrice: roundMoney(row.latestUnitPrice),
      latestInvoiceDate: row.latestInvoiceDate,
      previousUnitPrice: row.previousUnitPrice === null ? null : roundMoney(row.previousUnitPrice),
      priceMovement:
        row.previousUnitPrice === null
          ? null
          : row.latestUnitPrice > row.previousUnitPrice
            ? "Increased"
            : row.latestUnitPrice < row.previousUnitPrice
              ? "Decreased"
              : "Stable",
    }) satisfies OwnerDashboardItemRow)
    .sort((a, b) => b.totalSpend - a.totalSpend || b.quantity - a.quantity || safeDateMillis(b.latestInvoiceDate) - safeDateMillis(a.latestInvoiceDate) || a.itemName.localeCompare(b.itemName));
}

function buildAttentionRows(model: Pick<OwnerDashboardModel, "lowConfidenceLineCount" | "priceIncreaseCount" | "pendingInventoryInvoiceCount" | "skippedInventoryInvoiceCount" | "actionableInvoiceCount"> & {
  summary: PilotWorkspaceSummary;
}) {
  const rows: OwnerDashboardAttentionRow[] = [];

  if (model.actionableInvoiceCount > 0) {
    rows.push({
      title: `${model.actionableInvoiceCount} invoices need action`,
      detail: "Review OCR results, receive stock, or clear skipped invoices before the cost picture is considered final.",
      ctaLabel: "Review invoices",
      to: "/demo/cafe/invoices",
      tone: "warning",
    });
  }

  if (model.pendingInventoryInvoiceCount > 0) {
    rows.push({
      title: `${model.pendingInventoryInvoiceCount} invoices not received into inventory`,
      detail: "Receive stock or mark items as not tracked so the dashboard reflects what is actually on hand.",
      ctaLabel: "Open inventory",
      to: "/demo/cafe/inventory",
      tone: "warning",
    });
  }

  if (model.skippedInventoryInvoiceCount > 0) {
    rows.push({
      title: `${model.skippedInventoryInvoiceCount} invoices skipped for now`,
      detail: "Re-open them later if the stock should be received or if the invoice needs another look.",
      ctaLabel: "Review invoices",
      to: "/demo/cafe/invoices",
      tone: "info",
    });
  }

  if (model.lowConfidenceLineCount > 0) {
    rows.push({
      title: `${model.lowConfidenceLineCount} low-confidence invoice rows`,
      detail: "Delete or correct weak OCR rows before saving the invoice into history.",
      ctaLabel: "Clean up invoices",
      to: "/demo/cafe/invoices",
      tone: "info",
    });
  }

  if (model.priceIncreaseCount > 0) {
    rows.push({
      title: `${model.priceIncreaseCount} price increases to review`,
      detail: "Check the biggest supplier changes before the next order lands.",
      ctaLabel: "Review price changes",
      to: "/demo/cafe/invoices",
      tone: "danger",
    });
  }

  if (model.summary.inventoryItemsToReorderCount > 0) {
    rows.push({
      title: `${model.summary.inventoryItemsToReorderCount} items need reorder`,
      detail: "Stock is below the reorder line or already out of stock.",
      ctaLabel: "Open inventory",
      to: "/demo/cafe/inventory",
      tone: "warning",
    });
  }

  if (model.summary.unresolvedReconciliationCount > 0) {
    rows.push({
      title: `${model.summary.unresolvedReconciliationCount} unresolved daily closes`,
      detail: `Weekly unresolved variance: $${Math.abs(model.summary.weeklyUnresolvedVariance).toFixed(2)}.`,
      ctaLabel: "View daily close",
      to: "/demo/cafe/daily-reconciliation",
      tone: "warning",
    });
  }

  return rows;
}

function countInvoiceStatuses(
  invoices: PilotInvoiceRecord[],
  reviewQueue: PilotInvoiceRecord[],
  inventoryReceipts: InventoryInvoiceReceipt[],
) {
  const pending = new Set<string>();
  const skipped = new Set<string>();
  const lowConfidenceInvoices = new Set<string>();
  let lowConfidenceLineCount = 0;

  for (const invoice of invoices) {
    const status = summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
    if (status === "Skipped") {
      skipped.add(invoice.id);
    }
    if (status === "Not received" || status === "Partially received" || status === "No tracked items") {
      pending.add(invoice.id);
    }

    const invoiceHasLowConfidenceLine = invoice.lineItems.some((line) => !Number.isFinite(line.confidence) || line.confidence < confidenceThreshold || line.needsReview);
    if (invoiceHasLowConfidenceLine) {
      lowConfidenceInvoices.add(invoice.id);
    }
    lowConfidenceLineCount += invoice.lineItems.filter((line) => !Number.isFinite(line.confidence) || line.confidence < confidenceThreshold || line.needsReview).length;
  }

  const actionable = new Set<string>([
    ...reviewQueue.map((invoice) => invoice.id),
    ...pending,
    ...skipped,
  ]);

  return {
    pendingInventoryInvoiceCount: pending.size,
    skippedInventoryInvoiceCount: skipped.size,
    lowConfidenceLineCount,
    lowConfidenceInvoiceCount: lowConfidenceInvoices.size,
    actionableInvoiceCount: actionable.size,
  };
}

export function buildOwnerDashboardModel({
  invoices,
  reviewQueue,
  priceChanges,
  unresolvedReconciliations,
  inventoryItems,
  inventoryReorderIntents,
  inventoryReceipts,
  summary,
  referenceDate = new Date(),
}: OwnerDashboardInput): OwnerDashboardModel {
  const validInvoices = invoices.filter((invoice) => Number.isFinite(invoice.totalAmount) && invoice.totalAmount >= 0);
  const monthStartMillis = getMonthStartMillis(referenceDate);
  const monthInvoices = validInvoices.filter((invoice) => safeDateMillis(invoice.invoiceDate) >= monthStartMillis);
  const monthSource = monthInvoices.length > 0 ? monthInvoices : validInvoices;
  const monthSourceLabel = monthInvoices.length > 0 ? "This month" : validInvoices.length > 0 ? "All saved invoices" : "Upload or load a sample invoice to see spend";
  const monthToDateSpend = roundMoney(monthSource.reduce((sum, invoice) => sum + (Number.isFinite(invoice.totalAmount) ? invoice.totalAmount : 0), 0));
  const monthToDateInvoiceCount = monthSource.length;

  const supplierSpend = buildSupplierSpendRows(validInvoices);
  const costChanges = buildCostChangeRows(priceChanges);
  const topItems = buildTopPurchasedItems(validInvoices);
  const reorderSuggestions = buildReorderSuggestions(inventoryItems, inventoryReorderIntents);
  const counts = countInvoiceStatuses(invoices, reviewQueue, inventoryReceipts);
  const needsAttention = buildAttentionRows({
    lowConfidenceLineCount: counts.lowConfidenceLineCount,
    priceIncreaseCount: costChanges.filter((change) => change.status === "Increased").length,
    pendingInventoryInvoiceCount: counts.pendingInventoryInvoiceCount,
    skippedInventoryInvoiceCount: counts.skippedInventoryInvoiceCount,
    actionableInvoiceCount: counts.actionableInvoiceCount,
    summary,
  });

  const supplierSpendRows = supplierSpend.length > 0 ? supplierSpend : [];
  const topSupplier = supplierSpendRows[0];
  const priceIncreaseCount = costChanges.filter((change) => change.status === "Increased").length;
  const priceDecreaseCount = costChanges.filter((change) => change.status === "Decreased").length;
  const stablePriceCount = costChanges.filter((change) => change.status === "Stable").length;

  const cards: OwnerDashboardCard[] = [
    {
      label: "Month-to-date spend",
      value: monthSource.length > 0 ? `$${monthToDateSpend.toFixed(2)}` : "-",
      helper: monthSource.length > 0 ? `${monthToDateInvoiceCount} invoices - ${monthSourceLabel}` : "Upload or load a sample invoice to see spend.",
      tone: monthSource.length > 0 ? "success" : "info",
    },
    {
      label: "Supplier spend",
      value: topSupplier?.supplier || "-",
      helper: topSupplier
        ? `$${topSupplier.spend.toFixed(2)} across ${supplierSpendRows.length} suppliers`
        : "No supplier spend yet. Upload or load a sample invoice.",
      tone: topSupplier ? "neutral" : "info",
    },
    {
      label: "Cost changes",
      value: String(costChanges.length),
      helper:
        costChanges.length > 0
          ? `${priceIncreaseCount} up - ${priceDecreaseCount} down - ${stablePriceCount} unchanged`
          : "No supplier price changes detected yet.",
      tone: priceIncreaseCount > 0 ? "warning" : "success",
    },
    {
      label: "Invoices needing action",
      value: String(counts.actionableInvoiceCount),
      helper: `${counts.pendingInventoryInvoiceCount} not received - ${counts.lowConfidenceLineCount} low-confidence rows`,
      tone: counts.actionableInvoiceCount > 0 ? "warning" : "success",
    },
    {
      label: "Inventory alerts",
      value: String(summary.inventoryItemsToReorderCount),
      helper: summary.inventoryItemsToReorderCount > 0
        ? `${summary.inventoryLowStockCount} low stock - ${summary.inventoryOutOfStockCount} out of stock`
        : "No inventory alerts.",
      tone: summary.inventoryItemsToReorderCount > 0 ? "warning" : "success",
    },
    {
      label: "Unresolved daily close",
      value: summary.todayReconciliationStatus,
      helper:
        summary.todayReconciliationStatus === "Incomplete"
          ? "No close saved for today yet."
          : `Variance $${Math.abs(summary.todayReconciliationVariance).toFixed(2)} on ${summary.todayReconciliationDate}`,
      tone: summary.todayReconciliationStatus === "Balanced" ? "success" : summary.todayReconciliationStatus === "Incomplete" ? "info" : "warning",
    },
  ];

  return {
    cards,
    supplierSpend: supplierSpendRows,
    costChanges,
    topItems,
    reorderSuggestions,
    needsAttention,
    monthToDateSpend,
    monthToDateInvoiceCount,
    monthSourceLabel,
    priceIncreaseCount,
    lowConfidenceLineCount: counts.lowConfidenceLineCount,
    actionableInvoiceCount: counts.actionableInvoiceCount,
    pendingInventoryInvoiceCount: counts.pendingInventoryInvoiceCount,
    skippedInventoryInvoiceCount: counts.skippedInventoryInvoiceCount,
    dailyCloseStatus: summary.todayReconciliationStatus,
    dailyCloseVariance: summary.todayReconciliationVariance,
    dailyCloseDate: summary.todayReconciliationDate,
    unresolvedDailyCloseCount: summary.unresolvedReconciliationCount,
  };
}
