import type { InventoryItem, InventoryInvoiceReceipt, InventoryLineMapping, PilotInvoiceLineItem, PilotInvoiceRecord, InvoiceInventoryStatus } from "../types";
import { normalizeComparisonKey } from "./invoiceLineItemView";
import { findRememberedInventoryMapping, findInventoryItemSuggestions, sortInventoryItems } from "./inventoryWorkspace";

export type InvoiceReceiveLineState = {
  invoiceLineItemId: string;
  invoiceLineName: string;
  sourceDescription: string;
  invoiceQuantity: number;
  invoiceUnit: string;
  unitPrice: number;
  selectedItemId: string;
  state: "unmapped" | "linked" | "do-not-track" | "already-received";
  matchLabel: "Previously confirmed" | "Auto-matched" | "Suggested match" | "Not mapped" | "Already received";
  conversionFactor: number;
  inventoryUnit: string;
  note: string;
  suggestedItemId?: string;
};

const safeAutoMatchUnits = new Set([
  "bag",
  "bags",
  "bottle",
  "bottles",
  "box",
  "boxes",
  "can",
  "cans",
  "case",
  "cases",
  "carton",
  "cartons",
  "container",
  "containers",
  "cup",
  "cups",
  "document",
  "documents",
  "each",
  "gal",
  "gallon",
  "gallons",
  "hour",
  "hours",
  "hr",
  "hrs",
  "job",
  "jobs",
  "kg",
  "lb",
  "lbs",
  "litre",
  "litres",
  "liter",
  "liters",
  "l",
  "ml",
  "pack",
  "packs",
  "piece",
  "pieces",
  "pallet",
  "pallets",
  "shipment",
  "shipments",
  "unit",
  "units",
  "wrap",
  "wraps",
]);

function normalizeForSafeMatch(value: string) {
  return normalizeComparisonKey(value.replace(/(\d)([a-zA-Z])/g, "$1 $2").replace(/([a-zA-Z])(\d)/g, "$1 $2"))
    .replace(/\b\d+(?:\.\d+)?\s*(?:oz|lb|lbs|kg|g|mg|l|ml|ct|count|pack|packs|box|boxes|bag|bags|can|cans|cup|cups|case|cases|carton|cartons|container|containers|document|documents|shipment|shipments|job|jobs|unit|units)\b/g, " ")
    .replace(/\b(?:oz|lb|lbs|kg|g|mg|l|ml|ct|count)\s*\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLineNumber(value: string) {
  return value.replace(/^\s*\d+\s+(?=[A-Za-z])/g, "").trim();
}

function isFooterLine(line: string) {
  return /^(subtotal|tax|gst|hst|vat|total|amount due|balance due|payment info|payment information|notes?|terms|thank you|grand total)\b/i.test(line.trim());
}

function looksLikeTableHeader(line: string) {
  const normalized = line.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /description/.test(normalized) &&
    /(qty|quantity)/.test(normalized) &&
    /(unit price|price)/.test(normalized) &&
    /(amount|total)/.test(normalized)
  ) ||
    (/^no\.?\s+description/.test(normalized) && /(qty|quantity)/.test(normalized) && /(amount|total)/.test(normalized));
}

function extractTableRegion(lines: string[]) {
  const headerIndex = lines.findIndex((line) => looksLikeTableHeader(line));
  if (headerIndex === -1) {
    return { headerFound: false, lines };
  }

  const region: string[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFooterLine(line)) {
      break;
    }
    region.push(line);
  }

  return { headerFound: true, lines: region };
}

function parseMoneyToken(token: string) {
  const cleaned = token.replace(/[^0-9.]/g, "");
  if (!cleaned) {
    return { value: 0, normalized: false };
  }

  if (cleaned.includes(".")) {
    return { value: Number(cleaned), normalized: false };
  }

  if (cleaned.length >= 4 && /000$/.test(cleaned)) {
    return { value: Number(cleaned) / 100, normalized: true };
  }

  return { value: Number(cleaned), normalized: false };
}

function extractMoneyValues(line: string) {
  const tokens = [...line.matchAll(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/g)].map((match) => match[1]);
  return tokens.map((token) => parseMoneyToken(token));
}

function parseQuantityAndUnit(raw: string) {
  const line = stripLineNumber(raw);
  const fusedMatch = line.match(/^(.*?)(?:\s+)?(\d+(?:\.\d+)?)([A-Za-z][A-Za-z/-]*)$/);
  if (fusedMatch) {
    const unit = fusedMatch[3].toLowerCase();
    if (safeAutoMatchUnits.has(unit)) {
      return {
        description: fusedMatch[1].trim(),
        quantity: Number(fusedMatch[2]) || 1,
        unit,
      };
    }
  }

  const unitMatch = line.match(/^(.*?)(?:\s+)([A-Za-z][A-Za-z/-]*)$/);
  if (unitMatch) {
    const unit = unitMatch[2].toLowerCase();
    if (safeAutoMatchUnits.has(unit)) {
      return {
        description: unitMatch[1].trim(),
        quantity: 1,
        unit,
      };
    }
  }

  return {
    description: line.trim(),
    quantity: 1,
    unit: "each",
  };
}

function parseTableLine(line: string) {
  const moneyValues = extractMoneyValues(line);
  if (!moneyValues.length) {
    return null;
  }

  const stripped = stripLineNumber(line);
  const rowInfo = parseQuantityAndUnit(stripped);
  const hasTwoMoneyValues = moneyValues.length >= 2;
  const lastMoney = moneyValues[moneyValues.length - 1];
  const secondLastMoney = moneyValues[moneyValues.length - 2];
  const lineTotal = hasTwoMoneyValues ? lastMoney.value : lastMoney.value;
  const unitPrice = hasTwoMoneyValues ? secondLastMoney.value : lastMoney.value;
  const normalizedMoneyUsed = moneyValues.some((money) => money.normalized);
  const resolvedDescription = rowInfo.description || stripped.replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?$/g, "").trim();

  return {
    itemName: resolvedDescription || stripped,
    originalDescription: resolvedDescription || stripped,
    rawSourceLine: line,
    comparisonKey: normalizeComparisonKey(resolvedDescription || stripped).toLowerCase(),
    quantity: rowInfo.quantity,
    unit: rowInfo.unit,
    unitPrice,
    lineTotal,
    confidence: normalizedMoneyUsed ? 0.55 : 0.9,
    needsReview: normalizedMoneyUsed || !hasTwoMoneyValues,
  };
}

function shouldParseAsTable(lines: string[]) {
  return lines.some((line) => looksLikeTableHeader(line));
}

export function normalizeInventoryMatchKey(value: string) {
  return normalizeForSafeMatch(value);
}

export function findSafeInventoryItemSuggestion(items: InventoryItem[], value: string) {
  const normalized = normalizeInventoryMatchKey(value);
  if (!normalized) {
    return null;
  }

  const matches = sortInventoryItems(items).filter((item) => {
    const itemKey = normalizeInventoryMatchKey(item.name);
    return itemKey === normalized || item.itemMatchKey === normalized || item.normalizedName === normalized;
  });

  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

export function buildInvoiceReceiveLines(
  invoiceId: string,
  inventoryItems: InventoryItem[],
  inventoryMappings: InventoryLineMapping[],
  inventoryReceipts: InventoryInvoiceReceipt[],
  recentInvoices: PilotInvoiceRecord[],
): InvoiceReceiveLineState[] {
  const invoice = recentInvoices.find((item) => item.id === invoiceId) ?? null;
  if (!invoice) {
    return [];
  }

  return invoice.lineItems.map((line, index) => {
    const sourceDescription = line.originalDescription || line.itemName || line.rawSourceLine || `Line ${index + 1}`;
    const lineKey = line.comparisonKey || sourceDescription;
    const remembered = findRememberedInventoryMapping(inventoryMappings, invoice.supplier, lineKey);
    const safeMatch = findSafeInventoryItemSuggestion(inventoryItems, lineKey);
    const suggestedMatches = findInventoryItemSuggestions(inventoryItems, lineKey);
    const alreadyReceived = inventoryReceipts.some((receipt) => receipt.invoiceId === invoice.id && receipt.invoiceLineItemId === line.id);

    if (alreadyReceived) {
      return {
        invoiceLineItemId: line.id,
        invoiceLineName: line.itemName || sourceDescription,
        sourceDescription,
        invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
        invoiceUnit: line.unit || "each",
        unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
        selectedItemId: "",
        state: "already-received",
        matchLabel: "Already received",
        conversionFactor: 1,
        inventoryUnit: line.unit || "each",
        note: "",
      };
    }

    if (remembered) {
      return {
        invoiceLineItemId: line.id,
        invoiceLineName: line.itemName || sourceDescription,
        sourceDescription,
        invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
        invoiceUnit: line.unit || "each",
        unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
        selectedItemId: remembered.inventoryItemId,
        state: "linked",
        matchLabel: "Previously confirmed",
        conversionFactor: remembered.conversionFactor || 1,
        inventoryUnit: remembered.inventoryUnit || line.unit || "each",
        note: "",
        suggestedItemId: remembered.inventoryItemId,
      };
    }

    if (safeMatch) {
      return {
        invoiceLineItemId: line.id,
        invoiceLineName: line.itemName || sourceDescription,
        sourceDescription,
        invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
        invoiceUnit: line.unit || "each",
        unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
        selectedItemId: safeMatch.id,
        state: "linked",
        matchLabel: "Auto-matched",
        conversionFactor: 1,
        inventoryUnit: safeMatch.unit || line.unit || "each",
        note: "",
        suggestedItemId: safeMatch.id,
      };
    }

    return {
      invoiceLineItemId: line.id,
      invoiceLineName: line.itemName || sourceDescription,
      sourceDescription,
      invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
      invoiceUnit: line.unit || "each",
      unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
      selectedItemId: "",
      state: "unmapped",
      matchLabel: suggestedMatches.length ? "Suggested match" : "Not mapped",
      conversionFactor: 1,
      inventoryUnit: suggestedMatches[0]?.unit || line.unit || "each",
      note: "",
      suggestedItemId: suggestedMatches[0]?.id,
    };
  });
}

export function summarizeInvoiceInventoryStatus(
  invoice: Pick<PilotInvoiceRecord, "id" | "lineItems" | "inventoryReceiptStatus">,
  inventoryReceipts: InventoryInvoiceReceipt[],
): InvoiceInventoryStatus {
  if (invoice.inventoryReceiptStatus) {
    return invoice.inventoryReceiptStatus;
  }

  const receivedLineIds = new Set(
    inventoryReceipts.filter((receipt) => receipt.invoiceId === invoice.id).map((receipt) => receipt.invoiceLineItemId),
  );
  const totalLines = invoice.lineItems.length;
  const receivedCount = receivedLineIds.size;
  const serviceLikeCount = invoice.lineItems.filter((line) => isLikelyServiceLine(line)).length;

  if (totalLines === 0 || serviceLikeCount === totalLines) {
    return receivedCount > 0 ? "Partially received" : "No tracked items";
  }

  if (receivedCount === 0) {
    return serviceLikeCount > 0 ? "Not received" : "Not received";
  }

  if (receivedCount >= totalLines) {
    return "Received";
  }

  return "Partially received";
}

export function buildInvoiceInventorySummary(
  invoice: Pick<PilotInvoiceRecord, "id" | "lineItems" | "inventoryReceiptStatus">,
  inventoryReceipts: InventoryInvoiceReceipt[],
) {
  const status = summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
  const receivedLineCount = new Set(inventoryReceipts.filter((receipt) => receipt.invoiceId === invoice.id).map((receipt) => receipt.invoiceLineItemId)).size;
  const skippedLineCount = invoice.inventoryReceiptStatus === "Skipped" ? invoice.lineItems.length : 0;
  const unresolvedLineCount = Math.max(invoice.lineItems.length - receivedLineCount - skippedLineCount, 0);

  return {
    status,
    receivedLineCount,
    skippedLineCount,
    unresolvedLineCount,
  };
}

function isLikelyServiceLine(line: Pick<PilotInvoiceLineItem, "itemName" | "originalDescription" | "rawSourceLine" | "comparisonKey">) {
  const value = `${line.originalDescription || line.itemName || line.rawSourceLine || line.comparisonKey || ""}`.toLowerCase();
  return /(labor|service|delivery|freight|shipping|customs|fee|fees|tax|vat|gst|hst|tip|payout|discount|promotion|commission|handling|admin|document)/.test(value);
}
