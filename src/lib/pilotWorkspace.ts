import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultDemoProfileSlug, getDemoProfileView } from "./demoProfile";
import {
  archiveInventoryItem,
  buildInventorySummary,
  createInventoryDraft,
  createSeedInventoryState,
  deleteInventoryItem,
  deriveInventoryReceiptKey,
  findInventoryItemSuggestions,
  getInventoryStatusLabel,
  normalizeStoredInventoryState,
  sortInventoryItems,
  sortInventoryMovementsNewestFirst,
  sortInventoryReceiptsNewestFirst,
  summarizeInventoryReceiptLines,
  upsertInventoryItem,
} from "./inventoryWorkspace";
import {
  deriveReconciliationRecord,
  normalizeStoredReconciliationRecord,
  sortReconciliationsNewestFirst,
  upsertReconciliationRecord,
} from "./reconciliationWorkflow";
import type {
  InvoiceLineItem,
  InventoryInvoiceReceipt,
  InventoryItem,
  InventoryMovement,
  PilotInventoryDraft,
  PilotInventoryDraftLine,
  PilotInventoryState,
  PilotInvoiceDraft,
  PilotInvoiceLineItem,
  PilotInvoiceRecord,
  PilotPriceChangeRecord,
  PilotReconciliationDraft,
  PilotReconciliationRecord,
  PilotReconciliationStatus,
  PilotWorkspaceSummary,
  PriceStatus,
  Severity,
} from "../types";

const STORAGE_KEY = "flowtally.pilot.workspace.v1";
const PRICE_CHANGE_EPSILON = 0.01;

interface PilotWorkspaceState {
  invoices: PilotInvoiceRecord[];
  reconciliations: PilotReconciliationRecord[];
  inventory: PilotInventoryState;
}

interface PilotWorkspaceContextValue extends PilotWorkspaceState {
  priceChanges: PilotPriceChangeRecord[];
  summary: PilotWorkspaceSummary;
  recentInvoices: PilotInvoiceRecord[];
  reviewQueue: PilotInvoiceRecord[];
  unresolvedReconciliations: PilotReconciliationRecord[];
  inventoryItems: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  inventoryReceipts: InventoryInvoiceReceipt[];
  inventorySummary: ReturnType<typeof buildInventorySummary>;
  saveInvoice: (draft: PilotInvoiceDraft) => PilotInvoiceRecord;
  saveReconciliation: (draft: PilotReconciliationDraft) => PilotReconciliationRecord;
  saveInventoryItem: (draft: PilotInventoryDraft) => InventoryItem;
  archiveInventoryItem: (id: string) => void;
  deleteInventoryItem: (id: string) => void;
  recordInventoryReceipt: (invoiceId: string, lines: PilotInventoryDraftLine[]) => { recorded: number; skipped: number };
  recordInventoryMovement: (itemId: string, movementType: "manual addition" | "usage" | "waste" | "breakage" | "correction" | "other", quantityDelta: number, note?: string) => InventoryMovement | null;
  recordInventoryCount: (itemId: string, quantity: number, note?: string) => InventoryMovement | null;
  deleteReconciliation: (id: string) => void;
  resetWorkspace: () => void;
}

const PilotWorkspaceContext = createContext<PilotWorkspaceContextValue | null>(null);

function nowIso() {
  return new Date().toISOString();
}

function toMillis(value: string | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function clampMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRawLineText(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanLineItemDescription(value: string) {
  return value
    .replace(/\b(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|X|@)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:hrs?|hours?|hr|h)\b/gi, " ")
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?/g, " ")
    .replace(/\b(?:subtotal|tax|gst|hst|vat|balance|due|invoice|amount|paid|total)\b/gi, " ")
    .replace(/[|·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
          rawSourceLine: item.itemName,
          comparisonKey: normalizeComparisonKey(item.itemName),
          confidence: 1,
          needsReview: false,
        })),
        createdAt,
        updatedAt: createdAt,
        savedAt: createdAt,
      };
    });
}

function createSeedReconciliations(): PilotReconciliationRecord[] {
  const samples: PilotReconciliationRecord[] = [
    {
      id: "seed-reconciliation-1",
      date: "2026-06-12",
      uberEats: 248.4,
      doorDash: 193.25,
      skip: 81.2,
      cash: 164.0,
      card: 2448.7,
      other: 27.15,
      expectedPosSales: 3162.7,
      expectedPosEntered: true,
      otherSourceName: "Gift cards",
      refunds: 0,
      discounts: 0,
      tips: 0,
      fees: 0,
      manualAdjustment: 0,
      variance: 0,
      status: "Balanced",
      notes: "Evening counts matched after the drawer was re-counted.",
      confirmed: true,
      origin: "seed",
      createdAt: "2026-06-12T20:00:00.000Z",
      updatedAt: "2026-06-12T20:00:00.000Z",
      savedAt: "2026-06-12T20:00:00.000Z",
    },
    {
      id: "seed-reconciliation-2",
      date: "2026-06-13",
      uberEats: 274.9,
      doorDash: 216.1,
      skip: 88.6,
      cash: 141.5,
      card: 2588.8,
      other: 19.0,
      expectedPosSales: 3325.65,
      expectedPosEntered: true,
      otherSourceName: "",
      refunds: 0,
      discounts: 0,
      tips: 0,
      fees: 0,
      manualAdjustment: 0,
      variance: 3.25,
      status: "Small difference",
      notes: "Card batch settled late and the drawer was off by a small rounding difference.",
      confirmed: true,
      origin: "seed",
      createdAt: "2026-06-13T20:00:00.000Z",
      updatedAt: "2026-06-13T20:00:00.000Z",
      savedAt: "2026-06-13T20:00:00.000Z",
    },
    {
      id: "seed-reconciliation-3",
      date: "2026-06-14",
      uberEats: 261.75,
      doorDash: 204.0,
      skip: 79.4,
      cash: 158.5,
      card: 2512.2,
      other: 24.5,
      expectedPosSales: 3260.35,
      expectedPosEntered: true,
      otherSourceName: "Cash drop",
      refunds: 0,
      discounts: 0,
      tips: 0,
      fees: 0,
      manualAdjustment: 0,
      variance: -20.0,
      status: "Needs Review",
      notes: "Card batch settled late and the cash drawer was short by one closeout slip.",
      confirmed: true,
      origin: "seed",
      createdAt: "2026-06-14T20:00:00.000Z",
      updatedAt: "2026-06-14T20:00:00.000Z",
      savedAt: "2026-06-14T20:00:00.000Z",
    },
  ];

  return samples;
}

function createSeedWorkspace(): PilotWorkspaceState {
  return {
    invoices: createSeedInvoices(),
    reconciliations: createSeedReconciliations(),
    inventory: createSeedInventoryState(),
  };
}

function isPilotWorkspaceState(value: unknown): value is PilotWorkspaceState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PilotWorkspaceState>;
  return Array.isArray(candidate.invoices) && Array.isArray(candidate.reconciliations);
}

export function normalizeStoredWorkspace(state: PilotWorkspaceState): PilotWorkspaceState {
  return {
    invoices: state.invoices.map(normalizeStoredInvoiceRecord),
    reconciliations: state.reconciliations.map(normalizeStoredReconciliationRecord),
    inventory: normalizeStoredInventoryState(state.inventory),
  };
}

export function normalizeStoredInvoiceRecord(record: PilotInvoiceRecord): PilotInvoiceRecord {
  const createdAt = record.createdAt || record.updatedAt || `${record.invoiceDate}T12:00:00.000Z`;
  const savedAt = record.savedAt || record.updatedAt || record.createdAt || createdAt;
  return {
    ...record,
    supplier: record.supplier?.trim() || "Unknown supplier",
    invoiceDate: record.invoiceDate,
    invoiceNumber: record.invoiceNumber?.trim() || "",
    totalAmount: clampMoney(record.totalAmount),
    subtotal: clampMoney(record.subtotal),
    tax: clampMoney(record.tax),
    status: record.status,
    notes: record.notes?.trim() || "",
    fileName: record.fileName || "",
    fileType: record.fileType || "",
    extractedText: record.extractedText || "",
    extractionWarnings: Array.isArray(record.extractionWarnings) ? record.extractionWarnings : [],
    fieldConfidence: record.fieldConfidence,
    extractionProvider: record.extractionProvider || "manual",
    confirmed: Boolean(record.confirmed),
    lineItems: Array.isArray(record.lineItems) ? record.lineItems.map(normalizeInvoiceLineItem) : [],
    createdAt,
    updatedAt: record.updatedAt || createdAt,
    savedAt,
  };
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
      return normalizeStoredWorkspace(parsed);
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

export function sortInvoicesNewestFirst(invoices: PilotInvoiceRecord[]) {
  return [...invoices].sort((a, b) => {
    const savedDelta = toMillis(b.savedAt) - toMillis(a.savedAt);
    if (savedDelta !== 0) {
      return savedDelta;
    }

    const updatedDelta = toMillis(b.updatedAt) - toMillis(a.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const createdDelta = toMillis(b.createdAt) - toMillis(a.createdAt);
    if (createdDelta !== 0) {
      return createdDelta;
    }

    return b.invoiceDate.localeCompare(a.invoiceDate);
  });
}

export function upsertInvoiceRecord(invoices: PilotInvoiceRecord[], record: PilotInvoiceRecord) {
  const index = invoices.findIndex((invoice) => invoice.id === record.id);
  if (index === -1) {
    return [record, ...invoices];
  }

  return [...invoices.slice(0, index), record, ...invoices.slice(index + 1)];
}

export function getRecentInvoicePreview(invoices: PilotInvoiceRecord[], limit = 5) {
  const sorted = sortInvoicesNewestFirst(invoices);
  return {
    visibleInvoices: sorted.slice(0, limit),
    hasMore: sorted.length > limit,
    totalCount: sorted.length,
  };
}

export function normalizeInvoiceLineItem(item: InvoiceLineItem | PilotInvoiceLineItem): PilotInvoiceLineItem {
  const line = item as PilotInvoiceLineItem;
  const rawSourceLine = normalizeRawLineText(line.rawSourceLine || line.originalDescription);
  const cleanDescription = normalizeRawLineText(item.itemName) || cleanLineItemDescription(rawSourceLine) || "Line item";
  return {
    ...item,
    itemName: cleanDescription,
    originalDescription: cleanDescription,
    rawSourceLine,
    comparisonKey: line.comparisonKey?.trim() || normalizeComparisonKey(cleanDescription),
    unit: item.unit.trim() || "each",
    category: item.category.trim() || detectCategory(cleanDescription),
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
          originalDescription: item.itemName,
          rawSourceLine: item.rawSourceLine,
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

function buildSummary(invoices: PilotInvoiceRecord[], reconciliations: PilotReconciliationRecord[], inventory: PilotInventoryState): PilotWorkspaceSummary {
  const priceChanges = buildPriceChanges(invoices);
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(now.getDate() - 30);
  const today = now.toLocaleDateString("en-CA");

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
      const unresolved = record.status !== "Balanced";
      if (unresolved) {
        acc.unresolvedCount += 1;
      }
      acc.totalCount += 1;
      if (recordDate >= weekAgo && unresolved) {
        acc.weeklyVariance += Math.abs(record.variance);
      }
      if (recordDate >= monthAgo && unresolved) {
        acc.monthlyVariance += Math.abs(record.variance);
      }
      if (record.date === today) {
        acc.todayStatus = record.status;
        acc.todayVariance = record.variance;
      }
      return acc;
    },
    {
      totalCount: 0,
      unresolvedCount: 0,
      weeklyVariance: 0,
      monthlyVariance: 0,
      todayStatus: "Incomplete" as PilotReconciliationStatus,
      todayVariance: 0,
    },
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
    weeklyUnresolvedVariance: Number(reconciliationStats.weeklyVariance.toFixed(2)),
    monthlyUnresolvedVariance: Number(reconciliationStats.monthlyVariance.toFixed(2)),
    recentPriceChangeCount: priceChanges.filter((change) => new Date(`${change.invoiceDate}T12:00:00`) >= monthAgo).length,
    todayReconciliationStatus: reconciliationStats.todayStatus,
    todayReconciliationVariance: Number(reconciliationStats.todayVariance.toFixed(2)),
    todayReconciliationDate: today,
    ...buildInventorySummary(inventory),
  };
}

function deriveInvoiceState(existingInvoices: PilotInvoiceRecord[], draft: PilotInvoiceDraft): PilotInvoiceRecord {
  const now = nowIso();
  const existingRecord = draft.id ? existingInvoices.find((invoice) => invoice.id === draft.id) : undefined;
  const id = existingRecord?.id || draft.id || `invoice-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = existingRecord?.createdAt || now;
  const normalizedLineItems: PilotInvoiceLineItem[] = draft.lineItems.map((item, index) => {
    const comparisonKey = item.comparisonKey || normalizeComparisonKey(item.itemName);
    const previous = findPreviousPrice(existingInvoices, draft.supplier, comparisonKey);
    const currentUnitPrice = clampMoney(item.unitPrice);
    const lineTotal = clampMoney(item.lineTotal || item.quantity * currentUnitPrice);
    const rawSourceLine = normalizeRawLineText(item.rawSourceLine || item.originalDescription || item.itemName);
    const itemName = normalizeRawLineText(item.itemName) || cleanLineItemDescription(rawSourceLine) || `Line item ${index + 1}`;
    const priceChangePercent = previous && previous > PRICE_CHANGE_EPSILON ? ((currentUnitPrice - previous) / previous) * 100 : undefined;

    return {
      ...normalizeInvoiceLineItem({
        ...item,
        id: item.id || `line-${index + 1}`,
        itemName,
        comparisonKey,
        originalDescription: itemName,
        rawSourceLine,
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
    updatedAt: now,
    savedAt: now,
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
    const recentInvoices = sortInvoicesNewestFirst(state.invoices);
    const reviewQueue = recentInvoices.filter((invoice) => invoice.status === "Needs Review");
    const unresolvedReconciliations = sortReconciliationsNewestFirst(state.reconciliations).filter((record) => record.status !== "Balanced");
    const inventoryItems = sortInventoryItems(state.inventory.items);
    const inventoryMovements = sortInventoryMovementsNewestFirst(state.inventory.movements);
    const inventoryReceipts = sortInventoryReceiptsNewestFirst(state.inventory.receipts);
    const inventorySummary = buildInventorySummary(state.inventory);

    return {
      ...state,
      priceChanges,
      summary: {
        ...buildSummary(state.invoices, state.reconciliations, state.inventory),
        ...inventorySummary,
      },
      recentInvoices,
      reviewQueue,
      unresolvedReconciliations,
      inventoryItems,
      inventoryMovements,
      inventoryReceipts,
      inventorySummary,
      saveInvoice: (draft) => {
        const created = deriveInvoiceState(state.invoices, draft);
        const nextInvoices = upsertInvoiceRecord(state.invoices, created);
        const nextState = { ...state, invoices: nextInvoices };
        saveWorkspace(nextState);
        setState(nextState);
        return created;
      },
      saveReconciliation: (draft) => {
        const created = deriveReconciliationRecord(state.reconciliations, draft);
        const nextState = { ...state, reconciliations: upsertReconciliationRecord(state.reconciliations, created) };
        saveWorkspace(nextState);
        setState(nextState);
        return created;
      },
      saveInventoryItem: (draft) => {
        const { item, items } = upsertInventoryItem(state.inventory.items, draft);
        const nextInventory = {
          ...state.inventory,
          items,
        };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
        return item;
      },
      archiveInventoryItem: (id) => {
        const nextInventory = { ...state.inventory, items: archiveInventoryItem(state.inventory.items, id) };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
      },
      deleteInventoryItem: (id) => {
        const nextInventory = { ...state.inventory, items: deleteInventoryItem(state.inventory.items, id) };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
      },
      recordInventoryReceipt: (invoiceId, lines) => {
        const invoice = state.invoices.find((record) => record.id === invoiceId);
        if (!invoice) {
          return { recorded: 0, skipped: lines.length };
        }

        const now = new Date().toISOString();
        let items = [...state.inventory.items];
        const movements = [...state.inventory.movements];
        const receipts = [...state.inventory.receipts];
        let recorded = 0;
        let skipped = 0;

        for (const line of lines) {
          const item = items.find((candidate) => candidate.id === line.inventoryItemId);
          if (!item) {
            skipped += 1;
            continue;
          }

          const sourceLine = invoice.lineItems.find((entry) => entry.id === line.invoiceLineItemId);
          if (!sourceLine) {
            skipped += 1;
            continue;
          }

          const multiplier = Number(line.conversionFactor) || 1;
          const receiptKey = deriveInventoryReceiptKey(invoice, sourceLine, item.id, multiplier);
          if (receipts.some((receipt) => receipt.receiptKey === receiptKey)) {
            skipped += 1;
            continue;
          }

          const sourceDescription = sourceLine?.originalDescription || sourceLine?.itemName || "";
          const delta = Number((Number(line.quantity) * multiplier).toFixed(2));
          const quantityBefore = item.currentQuantity;
          const quantityAfter = Number((quantityBefore + delta).toFixed(2));
          const receipt: InventoryInvoiceReceipt = {
            id: `inventory-receipt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            supplier: invoice.supplier,
            invoiceLineItemId: line.invoiceLineItemId,
            invoiceLineDescription: sourceDescription,
            normalizedDescription: sourceLine?.comparisonKey || normalizeComparisonKey(sourceDescription || sourceLine?.itemName || ""),
            inventoryItemId: item.id,
            inventoryItemName: item.name,
            quantity: Number(line.quantity),
            unit: item.unit,
            conversionFactor: multiplier,
            unitPrice: sourceLine?.unitPrice ?? item.latestPurchasePrice,
            lineTotal: sourceLine?.lineTotal ?? Number((delta * (sourceLine?.unitPrice ?? item.latestPurchasePrice)).toFixed(2)),
            receiptKey,
            note: line.note?.trim() || "",
            createdAt: now,
            updatedAt: now,
          };

          const movement: InventoryMovement = {
            id: `inventory-movement-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            inventoryItemId: item.id,
            inventoryItemName: item.name,
            movementType: "invoice receipt",
            quantityDelta: delta,
            quantityBefore,
            quantityAfter,
            unit: item.unit,
            sourceInvoiceId: invoice.id,
            sourceInvoiceNumber: invoice.invoiceNumber,
            sourceInvoiceDate: invoice.invoiceDate,
            sourceInvoiceLineItemId: line.invoiceLineItemId,
            sourceInvoiceLineDescription: sourceDescription,
            receiptKey,
            note: line.note?.trim() || `Received from invoice ${invoice.invoiceNumber}`,
            createdAt: now,
            updatedAt: now,
          };

          items = items.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  currentQuantity: quantityAfter,
                  latestPurchasePrice: sourceLine?.unitPrice ? Number(sourceLine.unitPrice.toFixed(2)) : candidate.latestPurchasePrice,
                  preferredSupplier: invoice.supplier || candidate.preferredSupplier,
                  lastReceivedAt: invoice.invoiceDate || candidate.lastReceivedAt,
                  updatedAt: now,
                }
              : candidate,
          );

          receipts.push(receipt);
          movements.push(movement);
          recorded += 1;
        }

        const nextState = {
          ...state,
          inventory: {
            items,
            movements,
            receipts,
          },
        };
        saveWorkspace(nextState);
        setState(nextState);
        return { recorded, skipped };
      },
      recordInventoryMovement: (itemId, movementType, quantityDelta, note = "") => {
        const item = state.inventory.items.find((candidate) => candidate.id === itemId);
        if (!item) {
          return null;
        }

        const now = new Date().toISOString();
        const normalizedDelta =
          movementType === "usage" || movementType === "waste" || movementType === "breakage"
            ? -Math.abs(Number(quantityDelta) || 0)
            : movementType === "manual addition"
              ? Math.abs(Number(quantityDelta) || 0)
              : Number(quantityDelta) || 0;
        const quantityAfter = Number((item.currentQuantity + normalizedDelta).toFixed(2));
        const movement: InventoryMovement = {
          id: `inventory-movement-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          inventoryItemId: item.id,
          inventoryItemName: item.name,
          movementType,
          quantityDelta: Number(normalizedDelta.toFixed(2)),
          quantityBefore: item.currentQuantity,
          quantityAfter,
          unit: item.unit,
          note: note.trim() || movementType,
          createdAt: now,
          updatedAt: now,
        };

        const nextState = {
          ...state,
          inventory: {
            ...state.inventory,
            items: state.inventory.items.map((candidate) =>
              candidate.id === item.id
                ? {
                    ...candidate,
                    currentQuantity: quantityAfter,
                    updatedAt: now,
                    lastCountedAt: movementType === "correction" || movementType === "manual addition" ? candidate.lastCountedAt : candidate.lastCountedAt,
                  }
                : candidate,
            ),
            movements: [movement, ...state.inventory.movements],
            receipts: state.inventory.receipts,
          },
        };
        saveWorkspace(nextState);
        setState(nextState);
        return movement;
      },
      recordInventoryCount: (itemId, quantity, note = "") => {
        const item = state.inventory.items.find((candidate) => candidate.id === itemId);
        if (!item) {
          return null;
        }

        const now = new Date().toISOString();
        const countedQuantity = Number(quantity.toFixed(2));
        const movement: InventoryMovement = {
          id: `inventory-count-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          inventoryItemId: item.id,
          inventoryItemName: item.name,
          movementType: "count adjustment",
          quantityDelta: Number((countedQuantity - item.currentQuantity).toFixed(2)),
          quantityBefore: item.currentQuantity,
          quantityAfter: countedQuantity,
          unit: item.unit,
          note: note.trim() || "Manual count entry",
          createdAt: now,
          updatedAt: now,
        };

        const nextState = {
          ...state,
          inventory: {
            items: state.inventory.items.map((candidate) =>
              candidate.id === item.id
                ? {
                    ...candidate,
                    currentQuantity: countedQuantity,
                    lastCountedAt: now.slice(0, 10),
                    updatedAt: now,
                  }
                : candidate,
            ),
            movements: [movement, ...state.inventory.movements],
            receipts: state.inventory.receipts,
          },
        };
        saveWorkspace(nextState);
        setState(nextState);
        return movement;
      },
      deleteReconciliation: (id) => {
        const nextState = { ...state, reconciliations: state.reconciliations.filter((record) => record.id !== id) };
        saveWorkspace(nextState);
        setState(nextState);
      },
      resetWorkspace: () => {
        const nextState = createSeedWorkspace();
        saveWorkspace(nextState);
        setState(nextState);
      },
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
