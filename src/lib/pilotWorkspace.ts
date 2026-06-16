import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultDemoProfileSlug, getDemoProfileView } from "./demoProfile";
import type {
  InvoiceLineItem,
  PilotInvoiceDraft,
  PilotInvoiceLineItem,
  PilotInvoiceRecord,
  PilotPriceChangeRecord,
  PilotReconciliationDraft,
  PilotReconciliationRecord,
  PilotWorkspaceSummary,
  PriceStatus,
  Severity,
} from "../types";

const STORAGE_KEY = "flowtally.pilot.workspace.v1";
const PRICE_CHANGE_EPSILON = 0.01;

interface PilotWorkspaceState {
  invoices: PilotInvoiceRecord[];
  reconciliations: PilotReconciliationRecord[];
}

interface PilotWorkspaceContextValue extends PilotWorkspaceState {
  priceChanges: PilotPriceChangeRecord[];
  summary: PilotWorkspaceSummary;
  recentInvoices: PilotInvoiceRecord[];
  reviewQueue: PilotInvoiceRecord[];
  unresolvedReconciliations: PilotReconciliationRecord[];
  saveInvoice: (draft: PilotInvoiceDraft) => PilotInvoiceRecord;
  saveReconciliation: (draft: PilotReconciliationDraft) => PilotReconciliationRecord;
  resetWorkspace: () => void;
}

const PilotWorkspaceContext = createContext<PilotWorkspaceContextValue | null>(null);

function nowIso() {
  return new Date().toISOString();
}

function clampMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function itemKey(supplier: string, itemName: string) {
  return `${normalizeText(supplier)}::${normalizeText(itemName)}`;
}

function severityFromPercent(changePercent: number): Severity {
  const absolute = Math.abs(changePercent);
  if (absolute >= 10) return "High";
  if (absolute >= 5) return "Medium";
  return "Low";
}

function statusFromPercent(changePercent: number): PriceStatus {
  if (changePercent > PRICE_CHANGE_EPSILON) return "Increased";
  if (changePercent < -PRICE_CHANGE_EPSILON) return "Decreased";
  return "Stable";
}

function detectCategory(itemName: string) {
  const value = normalizeText(itemName);
  if (/(coffee|espresso|tea|latte|cappuccino)/.test(value)) return "Coffee";
  if (/(milk|cream|butter|cheese|dairy)/.test(value)) return "Dairy";
  if (/(flour|sugar|dough|bread|bake|pastry|yeast)/.test(value)) return "Dry Goods";
  if (/(produce|lettuce|tomato|fruit|vegetable)/.test(value)) return "Produce";
  if (/(packaging|cup|lid|container|bag|wrap)/.test(value)) return "Packaging";
  if (/(clean|soap|sanit|paper|towel)/.test(value)) return "Operations";
  return "Other";
}

function normalizeComparisonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(?:qty|quantity|case|cs|pack|pkg|x)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapInvoiceStatus(status: string | undefined) {
  return status === "Processed" ? "Ready" : "Needs Review";
}

function createSeedInvoices(): PilotInvoiceRecord[] {
  const demo = getDemoProfileView(defaultDemoProfileSlug);

  return [...demo.invoices]
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))
    .map((invoice, index) => {
      const createdAt = `${invoice.invoiceDate}T09:00:00.000Z`;

      return {
        id: `seed-invoice-${index + 1}`,
        supplier: invoice.supplier,
        invoiceDate: invoice.invoiceDate,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: clampMoney(invoice.totalAmount),
        status: mapInvoiceStatus(invoice.status),
        notes: invoice.status === "Needs Review" || invoice.status === "Price Changes Found" ? "Review the highlighted items." : "",
        fileName: `${invoice.invoiceNumber}.pdf`,
        fileType: "application/pdf",
        extractedText: `Seeded invoice record for ${invoice.invoiceNumber}`,
        subtotal: invoice.totalAmount,
        tax: 0,
        extractionWarnings: [],
        fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 0, total: 1, lineItems: 1 },
        extractionProvider: "seed",
        confirmed: true,
        lineItems: invoice.lineItems.map((item) => normalizeInvoiceLineItem({
          ...item,
          originalDescription: item.itemName,
          comparisonKey: normalizeComparisonKey(item.itemName),
          confidence: 1,
          needsReview: false,
        })),
        createdAt,
        updatedAt: createdAt,
      };
    });
}

function createSeedReconciliations(): PilotReconciliationRecord[] {
  const samples = [
    {
      date: "2026-06-12",
      uberEats: 248.4,
      doorDash: 193.25,
      skip: 81.2,
      cash: 164.0,
      card: 2448.7,
      other: 27.15,
      expectedPosSales: 3160.0,
      status: "Balanced" as const,
      notes: "Evening counts matched after the drawer was re-counted.",
    },
    {
      date: "2026-06-13",
      uberEats: 274.9,
      doorDash: 216.1,
      skip: 88.6,
      cash: 141.5,
      card: 2588.8,
      other: 19.0,
      expectedPosSales: 3370.0,
      status: "Needs Review" as const,
      notes: "Card batch settled late and the cash drawer was short by one closeout slip.",
    },
    {
      date: "2026-06-14",
      uberEats: 261.75,
      doorDash: 204.0,
      skip: 79.4,
      cash: 158.5,
      card: 2512.2,
      other: 24.5,
      expectedPosSales: 3240.0,
      status: "Balanced" as const,
      notes: "All channels matched after the end-of-day correction.",
    },
  ];

  return samples.map((record, index) => {
    const actualSales = record.uberEats + record.doorDash + record.skip + record.cash + record.card + record.other;
    const variance = clampMoney(actualSales - record.expectedPosSales);
    const createdAt = `${record.date}T20:00:00.000Z`;

    return {
      id: `seed-reconciliation-${index + 1}`,
      ...record,
      variance,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function createSeedWorkspace(): PilotWorkspaceState {
  return {
    invoices: createSeedInvoices(),
    reconciliations: createSeedReconciliations(),
  };
}

function isPilotWorkspaceState(value: unknown): value is PilotWorkspaceState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PilotWorkspaceState>;
  return Array.isArray(candidate.invoices) && Array.isArray(candidate.reconciliations);
}

function loadWorkspace(): PilotWorkspaceState {
  if (typeof window === "undefined") {
    return createSeedWorkspace();
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return createSeedWorkspace();
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (isPilotWorkspaceState(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to the seed workspace if storage is corrupted.
  }

  return createSeedWorkspace();
}

function saveWorkspace(state: PilotWorkspaceState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeInvoiceLineItem(item: InvoiceLineItem | PilotInvoiceLineItem): PilotInvoiceLineItem {
  const line = item as PilotInvoiceLineItem;
  return {
    ...item,
    itemName: item.itemName.trim() || "Line item",
    originalDescription: line.originalDescription?.trim() || item.itemName.trim() || "Line item",
    comparisonKey: line.comparisonKey?.trim() || normalizeComparisonKey(item.itemName),
    unit: item.unit.trim() || "each",
    category: item.category.trim() || detectCategory(item.itemName),
    quantity: Number.isFinite(item.quantity) ? Number(item.quantity) : 1,
    unitPrice: clampMoney(item.unitPrice),
    lineTotal: clampMoney(item.lineTotal || item.quantity * item.unitPrice),
    status: item.status ?? "Needs Review",
    confidence: Number.isFinite(line.confidence) ? Number(line.confidence) : 0.6,
    needsReview: line.needsReview ?? true,
    previousUnitPrice: line.previousUnitPrice,
    priceChangePercent: line.priceChangePercent,
  };
}

function buildPriceChanges(invoices: PilotInvoiceRecord[]): PilotPriceChangeRecord[] {
  const sortedInvoices = [...invoices].sort((a, b) => {
    const dateDelta = a.invoiceDate.localeCompare(b.invoiceDate);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });
  const lastSeen = new Map<string, { price: number; invoiceDate: string; invoiceId: string }>();
  const changes: PilotPriceChangeRecord[] = [];

  for (const invoice of sortedInvoices) {
    for (const item of invoice.lineItems) {
      const key = itemKey(invoice.supplier, item.comparisonKey || normalizeComparisonKey(item.itemName));
      const previous = lastSeen.get(key);
      if (previous && Math.abs(previous.price - item.unitPrice) > PRICE_CHANGE_EPSILON) {
        const changePercent = ((item.unitPrice - previous.price) / previous.price) * 100;
        changes.push({
          id: `${invoice.id}-${item.id}`,
          invoiceId: invoice.id,
          invoiceDate: invoice.invoiceDate,
          previousInvoiceDate: previous.invoiceDate,
          supplier: invoice.supplier,
          itemName: item.itemName,
          originalDescription: item.originalDescription,
          comparisonKey: item.comparisonKey,
          category: item.category,
          previousPrice: clampMoney(previous.price),
          currentPrice: clampMoney(item.unitPrice),
          changePercent: Number(changePercent.toFixed(1)),
          status: statusFromPercent(changePercent),
          severity: severityFromPercent(changePercent),
        });
      }

      lastSeen.set(key, { price: item.unitPrice, invoiceDate: invoice.invoiceDate, invoiceId: invoice.id });
    }
  }

  return changes.sort((a, b) => {
    const dateDelta = b.invoiceDate.localeCompare(a.invoiceDate);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return Math.abs(b.changePercent) - Math.abs(a.changePercent);
  });
}

function buildSummary(invoices: PilotInvoiceRecord[], reconciliations: PilotReconciliationRecord[]): PilotWorkspaceSummary {
  const priceChanges = buildPriceChanges(invoices);
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(now.getDate() - 30);

  const invoiceStats = invoices.reduce(
    (acc, invoice) => {
      const invoiceDate = new Date(`${invoice.invoiceDate}T12:00:00`);
      acc.totalSpend += invoice.totalAmount;
      acc.totalCount += 1;
      if (invoice.status === "Needs Review") {
        acc.reviewQueueCount += 1;
      }
      if (invoiceDate >= weekAgo) {
        acc.weeklySpend += invoice.totalAmount;
        acc.weeklyCount += 1;
      }
      if (invoiceDate >= monthAgo) {
        acc.monthlySpend += invoice.totalAmount;
        acc.monthlyCount += 1;
      }
      return acc;
    },
    { totalSpend: 0, totalCount: 0, reviewQueueCount: 0, weeklySpend: 0, weeklyCount: 0, monthlySpend: 0, monthlyCount: 0 },
  );

  const reconciliationStats = reconciliations.reduce(
    (acc, record) => {
      const recordDate = new Date(`${record.date}T12:00:00`);
      if (record.status === "Needs Review" || Math.abs(record.variance) >= 1) {
        acc.unresolvedCount += 1;
      }
      acc.totalCount += 1;
      if (recordDate >= weekAgo) {
        acc.weeklyVariance += record.variance;
      }
      if (recordDate >= monthAgo) {
        acc.monthlyVariance += record.variance;
      }
      return acc;
    },
    { totalCount: 0, unresolvedCount: 0, weeklyVariance: 0, monthlyVariance: 0 },
  );

  return {
    invoiceCount: invoiceStats.totalCount,
    invoiceSpend: Number(invoiceStats.totalSpend.toFixed(2)),
    invoiceReviewQueueCount: invoiceStats.reviewQueueCount,
    weeklyInvoiceSpend: Number(invoiceStats.weeklySpend.toFixed(2)),
    weeklyInvoiceCount: invoiceStats.weeklyCount,
    monthlyInvoiceSpend: Number(invoiceStats.monthlySpend.toFixed(2)),
    monthlyInvoiceCount: invoiceStats.monthlyCount,
    reconciliationCount: reconciliationStats.totalCount,
    unresolvedReconciliationCount: reconciliationStats.unresolvedCount,
    weeklyVariance: Number(reconciliationStats.weeklyVariance.toFixed(2)),
    monthlyVariance: Number(reconciliationStats.monthlyVariance.toFixed(2)),
    recentPriceChangeCount: priceChanges.filter((change) => new Date(`${change.invoiceDate}T12:00:00`) >= monthAgo).length,
  };
}

function deriveInvoiceState(existingInvoices: PilotInvoiceRecord[], draft: PilotInvoiceDraft): PilotInvoiceRecord {
  const id = `invoice-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = nowIso();
  const normalizedLineItems: PilotInvoiceLineItem[] = draft.lineItems.map((item, index) => {
    const comparisonKey = item.comparisonKey || normalizeComparisonKey(item.itemName);
    const previous = findPreviousPrice(existingInvoices, draft.supplier, comparisonKey);
    const currentUnitPrice = clampMoney(item.unitPrice);
    const lineTotal = clampMoney(item.lineTotal || item.quantity * currentUnitPrice);
    const priceChangePercent = previous && previous > PRICE_CHANGE_EPSILON ? ((currentUnitPrice - previous) / previous) * 100 : undefined;

    return {
      ...normalizeInvoiceLineItem({
        ...item,
        id: item.id || `line-${index + 1}`,
        comparisonKey,
        originalDescription: item.originalDescription || item.itemName,
        quantity: item.quantity || 1,
        unitPrice: currentUnitPrice,
        lineTotal,
        status: previous === undefined ? "New Item" : Math.abs(currentUnitPrice - previous) <= PRICE_CHANGE_EPSILON ? "Matched" : currentUnitPrice > previous ? "Price Increased" : "Matched",
        needsReview: item.needsReview ?? currentUnitPrice <= 0,
      }),
      previousUnitPrice: previous,
      priceChangePercent: priceChangePercent === undefined ? undefined : Number(priceChangePercent.toFixed(1)),
    };
  });

  const status: PilotInvoiceRecord["status"] =
    draft.status === "Ready" && draft.supplier.trim() && draft.invoiceDate.trim() && draft.totalAmount > 0 ? "Ready" : "Needs Review";

  return {
    id,
    supplier: draft.supplier.trim() || "Unknown supplier",
    invoiceDate: draft.invoiceDate,
    invoiceNumber: draft.invoiceNumber.trim() || `INV-${new Date().getTime()}`,
    totalAmount: clampMoney(draft.totalAmount),
    subtotal: clampMoney(draft.subtotal),
    tax: clampMoney(draft.tax),
    status,
    notes: draft.notes.trim(),
    fileName: draft.fileName,
    fileType: draft.fileType,
    extractedText: draft.extractedText,
    extractionWarnings: draft.extractionWarnings,
    fieldConfidence: draft.fieldConfidence,
    extractionProvider: draft.extractionProvider,
    confirmed: draft.confirmed,
    lineItems: normalizedLineItems,
    createdAt,
    updatedAt: createdAt,
  };
}

function findPreviousPrice(invoices: PilotInvoiceRecord[], supplier: string, comparisonKey: string) {
  const key = itemKey(supplier, comparisonKey);
  const sorted = [...invoices].sort((a, b) => {
    const dateDelta = a.invoiceDate.localeCompare(b.invoiceDate);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });

  let price: number | undefined;
  for (const invoice of sorted) {
    for (const item of invoice.lineItems) {
      if (itemKey(invoice.supplier, item.comparisonKey || normalizeComparisonKey(item.itemName)) === key) {
        price = item.unitPrice;
      }
    }
  }
  return price;
}

function deriveReconciliationState(draft: PilotReconciliationDraft): PilotReconciliationRecord {
  const id = `recon-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = nowIso();
  const actualSales = draft.uberEats + draft.doorDash + draft.skip + draft.cash + draft.card + draft.other;
  const variance = clampMoney(actualSales - draft.expectedPosSales);
  const status: PilotReconciliationRecord["status"] = draft.status ?? (Math.abs(variance) < 1 ? "Balanced" : "Needs Review");

  return {
    id,
    date: draft.date,
    uberEats: clampMoney(draft.uberEats),
    doorDash: clampMoney(draft.doorDash),
    skip: clampMoney(draft.skip),
    cash: clampMoney(draft.cash),
    card: clampMoney(draft.card),
    other: clampMoney(draft.other),
    expectedPosSales: clampMoney(draft.expectedPosSales),
    variance,
    status,
    notes: draft.notes.trim(),
    createdAt,
    updatedAt: createdAt,
  };
}

export function PilotWorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PilotWorkspaceState>(() => loadWorkspace());

  useEffect(() => {
    saveWorkspace(state);
  }, [state]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setState(loadWorkspace());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo<PilotWorkspaceContextValue>(() => {
    const priceChanges = buildPriceChanges(state.invoices);
    const recentInvoices = [...state.invoices].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.createdAt.localeCompare(a.createdAt));
    const reviewQueue = recentInvoices.filter((invoice) => invoice.status === "Needs Review");
    const unresolvedReconciliations = [...state.reconciliations]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .filter((record) => record.status === "Needs Review" || Math.abs(record.variance) >= 1);

    return {
      ...state,
      priceChanges,
      summary: buildSummary(state.invoices, state.reconciliations),
      recentInvoices,
      reviewQueue,
      unresolvedReconciliations,
      saveInvoice: (draft) => {
        const created = deriveInvoiceState(state.invoices, draft);
        setState((current) => ({ ...current, invoices: [created, ...current.invoices] }));
        return created;
      },
      saveReconciliation: (draft) => {
        const created = deriveReconciliationState(draft);
        setState((current) => ({ ...current, reconciliations: [created, ...current.reconciliations] }));
        return created;
      },
      resetWorkspace: () => setState(createSeedWorkspace()),
    };
  }, [state]);

  return createElement(PilotWorkspaceContext.Provider, { value }, children);
}

export function usePilotWorkspace() {
  const context = useContext(PilotWorkspaceContext);
  if (!context) {
    throw new Error("usePilotWorkspace must be used within a PilotWorkspaceProvider");
  }
  return context;
}
