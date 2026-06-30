import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  archiveInventoryItem,
  buildInventorySummary,
  createInventoryDraft,
  createSeedInventoryState,
  deleteInventoryItem,
  deriveInventoryReceiptKey,
  normalizeStoredInventoryState,
  sortInventoryItems,
  sortInventoryMovementsNewestFirst,
  sortInventoryReceiptsNewestFirst,
  upsertInventoryItem,
} from "./inventoryWorkspace";
import {
  buildCopyOrderText,
  buildInventoryOperationsSummary,
  buildReorderCsv,
  buildReorderSuggestions,
  cancelCountSession,
  canConfirmCountSession,
  confirmCountSession,
  countSessionProgress,
  createCountSessionDraft,
  groupReorderSuggestionsBySupplier,
  largeAdjustmentSignal,
  normalizeCountSession,
  normalizeReorderIntent,
  setCountSessionMetadata,
  updateCountSessionLine,
  upsertReorderIntent,
} from "./inventoryOperations";
import {
  deriveReconciliationRecord,
  normalizeStoredReconciliationRecord,
  sortReconciliationsNewestFirst,
  upsertReconciliationRecord,
} from "./reconciliationWorkflow";
import type {
  InvoiceLineItem,
  InvoiceInventoryStatus,
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
import { dateValueToMillis } from "../utils/format";

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
  inventoryMappings: PilotInventoryState["lineMappings"];
  inventoryCountSessions: PilotInventoryState["countSessions"];
  inventoryReorderIntents: PilotInventoryState["reorderIntents"];
  inventorySummary: ReturnType<typeof buildInventorySummary>;
  saveInvoice: (draft: PilotInvoiceDraft) => PilotInvoiceRecord;
  saveReconciliation: (draft: PilotReconciliationDraft) => PilotReconciliationRecord;
  saveInventoryItem: (draft: PilotInventoryDraft) => InventoryItem;
  archiveInventoryItem: (id: string) => void;
  deleteInventoryItem: (id: string) => void;
  recordInventoryReceipt: (invoiceId: string, lines: PilotInventoryDraftLine[], inventoryStatus?: InvoiceInventoryStatus) => { recorded: number; skipped: number };
  updateInvoiceInventoryStatus: (invoiceId: string, status: InvoiceInventoryStatus) => void;
  rememberInventoryMappings: (mappings: PilotInventoryState["lineMappings"]) => void;
  upsertInventoryCountSession: (session: PilotInventoryState["countSessions"][number]) => void;
  confirmInventoryCountSession: (sessionId: string) => { confirmed: boolean; changedCount: number };
  cancelInventoryCountSession: (sessionId: string) => void;
  upsertInventoryReorderIntent: (intent: PilotInventoryState["reorderIntents"][number]) => void;
  deleteInventoryReorderIntent: (intentId: string) => void;
  recordInventoryMovement: (itemId: string, movementType: "manual addition" | "adjustment" | "usage" | "waste" | "spoilage / expired" | "damaged" | "staff meal / comped" | "breakage" | "count adjustment" | "physical count adjustment" | "correction" | "other", quantityDelta: number, note?: string) => InventoryMovement | null;
  recordInventoryCount: (itemId: string, quantity: number, note?: string) => InventoryMovement | null;
  deleteReconciliation: (id: string) => void;
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

function normalizeRawLineText(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanLineItemDescription(value: string) {
  return value
    .replace(/\b(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|X|@)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:hrs?|hours?|hr|h)\b/gi, " ")
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?(?!\s*(?:hrs?|hours?|hr|h)\b)/g, " ")
    .replace(/\b(?:subtotal|tax|gst|hst|vat|balance|due|invoice|amount|paid|total)\b/gi, " ")
    .replace(/[|·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveComparisonKey(value: string) {
  return normalizeComparisonKey(
    value
      .replace(/\b(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b/gi, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:x|X|@)\b/g, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:hrs?|hours?|hr|h)\b/gi, " ")
      .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?/g, " "),
  );
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

function createSeedInvoices(): PilotInvoiceRecord[] {
  const seedLineItem = (
    id: string,
    itemName: string,
    quantity: number,
    unit: string,
    unitPrice: number,
    lineTotal: number,
    category: string,
    status: PilotInvoiceLineItem["status"] = "Matched",
  ): PilotInvoiceLineItem =>
    normalizeInvoiceLineItem({
      id,
      itemName,
      originalDescription: itemName,
      rawSourceLine: `${itemName} ${quantity} ${unit} ${unitPrice.toFixed(2)} ${lineTotal.toFixed(2)}`,
      comparisonKey: normalizeComparisonKey(itemName),
      quantity,
      unit,
      unitPrice,
      lineTotal,
      category,
      status,
      confidence: 1,
      needsReview: false,
    });

  const seedInvoices: Array<Pick<PilotInvoiceDraft, "supplier" | "invoiceDate" | "invoiceNumber" | "subtotal" | "tax" | "totalAmount" | "status" | "notes" | "lineItems"> & { createdAt: string }> = [
    {
      supplier: "GTA Beverage Supply",
      invoiceDate: "2026-05-26",
      invoiceNumber: "GTA-5908",
      subtotal: 138.2,
      tax: 17.97,
      totalAmount: 156.17,
      status: "Ready",
      notes: "Earlier week tea and syrup top-up for baseline comparisons.",
      createdAt: "2026-05-26T09:00:00.000Z",
      lineItems: [
        seedLineItem("gta-prev-1", "Tapioca Pearls 3kg Bag", 1, "bag", 41, 41, "Tea / beverage base"),
        seedLineItem("gta-prev-2", "Brown Sugar Syrup 5L", 1, "bottle", 27.2, 27.2, "Syrups / toppings"),
        seedLineItem("gta-prev-3", "Black Tea Leaves 1kg", 1, "bag", 34, 34, "Tea / beverage base"),
        seedLineItem("gta-prev-4", "Oat Milk Cartons", 1, "case", 36, 36, "Dairy"),
      ],
    },
    {
      supplier: "Metro Packaging",
      invoiceDate: "2026-05-29",
      invoiceNumber: "MPC-2114",
      subtotal: 149.4,
      tax: 19.42,
      totalAmount: 168.82,
      status: "Ready",
      notes: "Previous week packaging restock before the weekend rush.",
      createdAt: "2026-05-29T09:00:00.000Z",
      lineItems: [
        seedLineItem("mpc-prev-1", "700ml plastic cups", 1, "case", 60, 60, "Packaging"),
        seedLineItem("mpc-prev-2", "Cup sealing film", 1, "roll", 48, 48, "Packaging"),
        seedLineItem("mpc-prev-3", "Straws", 1, "box", 19.2, 19.2, "Packaging"),
        seedLineItem("mpc-prev-4", "Cup lids", 1, "case", 22.2, 22.2, "Packaging"),
      ],
    },
    {
      supplier: "GTA Beverage Supply",
      invoiceDate: "2026-06-01",
      invoiceNumber: "GTA-6001",
      subtotal: 145,
      tax: 18.85,
      totalAmount: 163.85,
      status: "Needs Review",
      notes: "Review the highlighted items and the tapioca price change.",
      createdAt: "2026-06-01T09:00:00.000Z",
      lineItems: [
        seedLineItem("gta-1", "Tapioca Pearls 3kg Bag", 1, "bag", 42, 42, "Tea / beverage base", "Price Increased"),
        seedLineItem("gta-2", "Brown Sugar Syrup 5L", 1, "bottle", 29, 29, "Syrups / toppings"),
        seedLineItem("gta-3", "Black Tea Leaves 1kg", 1, "bag", 36, 36, "Tea / beverage base"),
        seedLineItem("gta-4", "Oat Milk Cartons", 1, "case", 38, 38, "Dairy"),
      ],
    },
    {
      supplier: "Metro Packaging",
      invoiceDate: "2026-06-04",
      invoiceNumber: "MPC-2201",
      subtotal: 177,
      tax: 23.01,
      totalAmount: 200.01,
      status: "Needs Review",
      notes: "Cup seal and cup prices both moved up.",
      createdAt: "2026-06-04T09:00:00.000Z",
      lineItems: [
        seedLineItem("mpc-1", "700ml plastic cups", 1, "case", 68, 68, "Packaging"),
        seedLineItem("mpc-2", "Cup sealing film", 1, "roll", 55, 55, "Packaging"),
        seedLineItem("mpc-3", "Straws", 1, "box", 22, 22, "Packaging"),
        seedLineItem("mpc-4", "Cup lids", 1, "case", 32, 32, "Packaging"),
      ],
    },
    {
      supplier: "Ontario Produce Co.",
      invoiceDate: "2026-06-06",
      invoiceNumber: "OPC-3314",
      subtotal: 70.8,
      tax: 9.2,
      totalAmount: 80,
      status: "Ready",
      notes: "Dry goods and prep staples keep the week-over-week comparison realistic.",
      createdAt: "2026-06-06T09:00:00.000Z",
      lineItems: [
        seedLineItem("opc-1", "Jasmine Rice 20kg", 1, "bag", 36, 36, "Dry goods"),
        seedLineItem("opc-2", "Wheat Noodles 10kg", 1, "case", 21, 21, "Dry goods"),
        seedLineItem("opc-3", "Teriyaki Sauce 4L", 1, "jug", 13.8, 13.8, "Sauces / condiments"),
      ],
    },
    {
      supplier: "Fresh Dairy Toronto",
      invoiceDate: "2026-06-08",
      invoiceNumber: "FDT-7102",
      subtotal: 179.6,
      tax: 23.35,
      totalAmount: 202.95,
      status: "Ready",
      notes: "Milk and cream top-up before the weekend drink push.",
      createdAt: "2026-06-08T09:00:00.000Z",
      lineItems: [
        seedLineItem("fdt-1", "Oat Milk Cartons", 4, "case", 41, 164, "Dairy", "Price Increased"),
        seedLineItem("fdt-2", "Whole Milk 4L", 1, "case", 7.2, 7.2, "Dairy"),
        seedLineItem("fdt-3", "Whipping Cream", 1, "carton", 8.4, 8.4, "Dairy"),
      ],
    },
    {
      supplier: "Local Bakery Supply",
      invoiceDate: "2026-06-11",
      invoiceNumber: "LBS-4410",
      subtotal: 165.8,
      tax: 21.55,
      totalAmount: 187.35,
      status: "Ready",
      notes: "Bakery shelf is ready for the next brunch rush.",
      createdAt: "2026-06-11T09:00:00.000Z",
      lineItems: [
        seedLineItem("lbs-1", "Croissants", 4, "tray", 28.4, 113.6, "Food / bakery"),
        seedLineItem("lbs-2", "Muffin Tray", 1, "tray", 24.6, 24.6, "Food / bakery"),
        seedLineItem("lbs-3", "Butter Blocks", 1, "block", 13.4, 13.4, "Food / bakery", "Price Increased"),
        seedLineItem("lbs-4", "Sandwich Buns", 1, "bag", 14.2, 14.2, "Food / bakery"),
      ],
    },
    {
      supplier: "No Frills Grocery",
      invoiceDate: "2026-06-15",
      invoiceNumber: "NFG-9021",
      subtotal: 73.8,
      tax: 9.59,
      totalAmount: 83.39,
      status: "Ready",
      notes: "Breakfast sandwich staples and prep items are in stock for the morning shift.",
      createdAt: "2026-06-15T09:00:00.000Z",
      lineItems: [
        seedLineItem("nfg-1", "Breakfast Sandwich Buns", 2, "bag", 13.7, 27.4, "Grocery / prep"),
        seedLineItem("nfg-2", "Eggs", 1, "flat", 18.4, 18.4, "Grocery / prep"),
        seedLineItem("nfg-3", "Cheese Slices", 1, "box", 15.8, 15.8, "Grocery / prep"),
        seedLineItem("nfg-4", "Butter", 1, "block", 12.2, 12.2, "Grocery / prep", "Price Increased"),
      ],
    },
  ];

  return seedInvoices.map((invoice, index) => {
    const lineItems = invoice.lineItems.map((item) =>
      normalizeInvoiceLineItem({
        ...item,
        originalDescription: item.itemName,
        rawSourceLine: `${item.itemName} ${item.quantity} ${item.unit} ${item.unitPrice.toFixed(2)} ${item.lineTotal.toFixed(2)}`,
        comparisonKey: normalizeComparisonKey(item.itemName),
        confidence: 1,
        needsReview: false,
      }),
    );
    return {
      id: `seed-invoice-${index + 1}`,
      supplier: invoice.supplier,
      invoiceDate: invoice.invoiceDate,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: clampMoney(invoice.totalAmount),
      status: invoice.status,
      notes: invoice.notes,
      fileName: `${invoice.invoiceNumber}.pdf`,
      fileType: "application/pdf",
      sourceDocumentName: `${invoice.invoiceNumber}.pdf`,
      sourceDocumentType: "application/pdf",
      extractedText: `Seeded invoice record for ${invoice.invoiceNumber}`,
      subtotal: clampMoney(invoice.subtotal),
      tax: clampMoney(invoice.tax),
      extractionWarnings: [],
      fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 1, total: 1, lineItems: 1 },
      extractionProvider: "seed",
      confirmed: true,
      lineItems,
      createdAt: invoice.createdAt,
      updatedAt: invoice.createdAt,
      savedAt: invoice.createdAt,
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
      notes: "Delivery payouts and the cash drawer matched after the final recount.",
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
      notes: "Card batch settled late and a small delivery rounding difference was resolved on review.",
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
      notes: "Card batch settled late and the cash drawer was short after the delivery shift closed.",
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
    inventory: {
      ...normalizeStoredInventoryState(state.inventory),
      countSessions: Array.isArray(state.inventory?.countSessions) ? state.inventory.countSessions.map((session) => normalizeCountSession(session)) : createSeedInventoryState().countSessions,
      reorderIntents: Array.isArray(state.inventory?.reorderIntents) ? state.inventory.reorderIntents.map((intent) => normalizeReorderIntent(intent)) : createSeedInventoryState().reorderIntents,
    },
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
    sourceDocumentUrl: record.sourceDocumentUrl,
    sourceDocumentName: record.sourceDocumentName || record.fileName || "",
    sourceDocumentType: record.sourceDocumentType || record.fileType || "",
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
    const savedDelta = dateValueToMillis(b.savedAt) - dateValueToMillis(a.savedAt);
    if (savedDelta !== 0) {
      return savedDelta;
    }

    const updatedDelta = dateValueToMillis(b.updatedAt) - dateValueToMillis(a.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    const createdDelta = dateValueToMillis(b.createdAt) - dateValueToMillis(a.createdAt);
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
  const rawSourceLine = normalizeRawLineText(line.rawSourceLine || line.originalDescription || item.itemName);
  const originalDescription = normalizeRawLineText(line.originalDescription || rawSourceLine || item.itemName);
  const cleanDescription = normalizeRawLineText(item.itemName) || cleanLineItemDescription(originalDescription || rawSourceLine) || originalDescription || "Line item";
  return {
    ...item,
    itemName: cleanDescription,
    originalDescription: originalDescription || cleanDescription,
    rawSourceLine,
    comparisonKey: line.comparisonKey?.trim() || deriveComparisonKey(originalDescription || rawSourceLine || cleanDescription),
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
    const dateDelta = dateValueToMillis(a.invoiceDate) - dateValueToMillis(b.invoiceDate);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return dateValueToMillis(a.createdAt) - dateValueToMillis(b.createdAt);
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
    const dateDelta = dateValueToMillis(b.invoiceDate) - dateValueToMillis(a.invoiceDate);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return Math.abs(b.changePercent) - Math.abs(a.changePercent);
  });
}

function buildSummary(invoices: PilotInvoiceRecord[], reconciliations: PilotReconciliationRecord[], inventory: PilotInventoryState): PilotWorkspaceSummary {
  const priceChanges = buildPriceChanges(invoices);
  const now = new Date();
  const latestInvoiceMillis = invoices.reduce((latest, invoice) => Math.max(latest, dateValueToMillis(invoice.invoiceDate)), 0);
  const invoiceWindowDate = latestInvoiceMillis > 0 ? new Date(latestInvoiceMillis) : now;
  const invoiceWeekAgo = new Date(invoiceWindowDate);
  invoiceWeekAgo.setDate(invoiceWindowDate.getDate() - 7);
  const invoiceMonthAgo = new Date(invoiceWindowDate);
  invoiceMonthAgo.setDate(invoiceWindowDate.getDate() - 30);
  const reconciliationWeekAgo = new Date(now);
  reconciliationWeekAgo.setDate(now.getDate() - 7);
  const reconciliationMonthAgo = new Date(now);
  reconciliationMonthAgo.setDate(now.getDate() - 30);
  const today = now.toLocaleDateString("en-CA");

  const invoiceStats = invoices.reduce(
    (acc, invoice) => {
      const invoiceDate = new Date(dateValueToMillis(invoice.invoiceDate));
      acc.totalSpend += invoice.totalAmount;
      acc.totalCount += 1;
      if (invoice.status === "Needs Review") {
        acc.reviewQueueCount += 1;
      }
      if (invoiceDate >= invoiceWeekAgo) {
        acc.weeklySpend += invoice.totalAmount;
        acc.weeklyCount += 1;
      }
      if (invoiceDate >= invoiceMonthAgo) {
        acc.monthlySpend += invoice.totalAmount;
        acc.monthlyCount += 1;
      }
      return acc;
    },
    { totalSpend: 0, totalCount: 0, reviewQueueCount: 0, weeklySpend: 0, weeklyCount: 0, monthlySpend: 0, monthlyCount: 0 },
  );

  const reconciliationStats = reconciliations.reduce(
    (acc, record) => {
      const recordDate = new Date(dateValueToMillis(record.date));
      const unresolved = record.status !== "Balanced";
      if (unresolved) {
        acc.unresolvedCount += 1;
      }
      acc.totalCount += 1;
      if (recordDate >= reconciliationWeekAgo && unresolved) {
        acc.weeklyVariance += Math.abs(record.variance);
      }
      if (recordDate >= reconciliationMonthAgo && unresolved) {
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
    recentPriceChangeCount: priceChanges.filter((change) => new Date(dateValueToMillis(change.invoiceDate)) >= invoiceMonthAgo).length,
    todayReconciliationStatus: reconciliationStats.todayStatus,
    todayReconciliationVariance: Number(reconciliationStats.todayVariance.toFixed(2)),
    todayReconciliationDate: today,
    ...buildInventorySummary(inventory),
    ...buildInventoryOperationsSummary(inventory),
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
        originalDescription: rawSourceLine || item.originalDescription || itemName,
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
    sourceDocumentUrl: draft.sourceDocumentUrl,
    sourceDocumentName: draft.sourceDocumentName,
    sourceDocumentType: draft.sourceDocumentType,
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
    const dateDelta = dateValueToMillis(a.invoiceDate) - dateValueToMillis(b.invoiceDate);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return dateValueToMillis(a.createdAt) - dateValueToMillis(b.createdAt);
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
    const inventoryMappings = state.inventory.lineMappings;
    const inventoryCountSessions = state.inventory.countSessions;
    const inventoryReorderIntents = state.inventory.reorderIntents;
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
      inventoryMappings,
      inventoryCountSessions,
      inventoryReorderIntents,
      inventorySummary,
      saveInvoice: (draft) => {
        const created = deriveInvoiceState(state.invoices, draft);
        const nextInvoices = upsertInvoiceRecord(state.invoices, created);
        const nextState = { ...state, invoices: nextInvoices };
        saveWorkspace(nextState);
        setState(nextState);
        return created;
      },
      updateInvoiceInventoryStatus: (invoiceId, status) => {
        const now = nowIso();
        const nextInvoices = state.invoices.map((invoice) =>
          invoice.id === invoiceId ? { ...invoice, inventoryReceiptStatus: status, inventoryReceiptUpdatedAt: now, updatedAt: now } : invoice,
        );
        const nextState = { ...state, invoices: nextInvoices };
        saveWorkspace(nextState);
        setState(nextState);
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
      recordInventoryReceipt: (invoiceId, lines, inventoryStatus) => {
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
                  latestPurchaseUnit: sourceLine?.unit || candidate.latestPurchaseUnit,
                  latestPurchaseConversionFactor: multiplier || candidate.latestPurchaseConversionFactor || 1,
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

        const nextInvoices = state.invoices.map((entry) =>
          entry.id === invoice.id && inventoryStatus
            ? { ...entry, inventoryReceiptStatus: inventoryStatus, inventoryReceiptUpdatedAt: now, updatedAt: now }
            : entry,
        );
        const nextState = {
          ...state,
          invoices: nextInvoices,
          inventory: {
            ...state.inventory,
            items,
            movements,
            receipts,
          },
        };
        saveWorkspace(nextState);
        setState(nextState);
        return { recorded, skipped };
      },
      rememberInventoryMappings: (mappings) => {
        const nextState = {
          ...state,
          inventory: {
            ...state.inventory,
            lineMappings: mappings,
          },
        };
        saveWorkspace(nextState);
        setState(nextState);
      },
      upsertInventoryCountSession: (session) => {
        const nextInventory = {
          ...state.inventory,
          countSessions: [normalizeCountSession(session), ...state.inventory.countSessions.filter((candidate) => candidate.id !== session.id)],
        };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
      },
      confirmInventoryCountSession: (sessionId) => {
        const result = confirmCountSession(state.inventory, sessionId);
        if (!result) {
          return { confirmed: false, changedCount: 0 };
        }

        const nextInventory = {
          ...state.inventory,
          items: result.items,
          movements: result.movements,
          countSessions: result.countSessions,
        };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
        return { confirmed: true, changedCount: result.changedCount };
      },
      cancelInventoryCountSession: (sessionId) => {
        const nextInventory = {
          ...state.inventory,
          countSessions: cancelCountSession(state.inventory, sessionId),
        };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
      },
      upsertInventoryReorderIntent: (intent) => {
        const nextInventory = {
          ...state.inventory,
          reorderIntents: [normalizeReorderIntent(intent), ...state.inventory.reorderIntents.filter((candidate) => candidate.id !== intent.id)],
        };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
      },
      deleteInventoryReorderIntent: (intentId) => {
        const nextInventory = {
          ...state.inventory,
          reorderIntents: state.inventory.reorderIntents.filter((candidate) => candidate.id !== intentId),
        };
        const nextState = { ...state, inventory: nextInventory };
        saveWorkspace(nextState);
        setState(nextState);
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
          movementType: "physical count adjustment",
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
            ...state.inventory,
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
