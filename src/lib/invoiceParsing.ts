import type { PilotInvoiceDraft, PilotInvoiceLineItem } from "../types";

const COMMON_SUPPLIERS = [
  "Heritage Coffee Roasters",
  "Lakeshore Dairy",
  "Northwind Flour Mill",
  "Sweet Rise Pastry Supply",
  "Maple Produce",
  "Urban Packaging",
];

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCurrency(value: string) {
  return Number(value.replace(/[^0-9.]/g, ""));
}

function toIsoDate(value: string) {
  const directIso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (directIso) {
    return directIso[1];
  }

  const parts = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (!parts) {
    return "";
  }

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]);
  const month = first > 12 ? second : first;
  const day = first > 12 ? first : second;
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function formatFileStem(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(inv|invoice|receipt|bill|scan|ocr)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLineItemDescription(value: string) {
  return value
    .replace(/\b(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|X|@)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:hrs?|hours?|hr|h)\b/gi, " ")
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?/g, " ")
    .replace(/\b(?:subtotal|tax|gst|hst|vat|balance|due|invoice|amount|paid|total)\b/gi, " ")
    .replace(/[|â€¢Â·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessSupplier(sourceText: string, fileName: string) {
  const lower = sourceText.toLowerCase();
  for (const supplier of COMMON_SUPPLIERS) {
    if (lower.includes(supplier.toLowerCase())) {
      return supplier;
    }
  }

  const headerLine = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 3 && line.length <= 80 && !/[0-9]/.test(line) && /[A-Za-z]/.test(line));
  if (headerLine) {
    return normalizeWhitespace(headerLine);
  }

  const stem = formatFileStem(fileName);
  return stem ? stem.replace(/\b\w/g, (char) => char.toUpperCase()) : "Unknown supplier";
}

function guessInvoiceNumber(sourceText: string, fileName: string) {
  const lines = sourceText.split(/\r?\n/).map((line) => normalizeWhitespace(line)).filter(Boolean);
  const labelPatterns = [
    /(?:invoice\s*(?:number|no\.?|#|id)?|inv\s*(?:no\.?|#|id)?|bill\s*(?:no\.?|#|id)?|number)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
  ];

  for (const line of lines) {
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      if (match && /\d/.test(match[1])) {
        return match[1];
      }
    }
  }

  return "";
}

function guessInvoiceDate(sourceText: string) {
  const lineDates = sourceText.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g) ?? [];
  for (const candidate of lineDates) {
    const iso = toIsoDate(candidate);
    if (iso) {
      return iso;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function guessInvoiceTotal(sourceText: string) {
  const lines = sourceText.split(/\r?\n/);
  for (const line of [...lines].reverse()) {
    if (/(grand\s+total|invoice\s+total|balance\s+due|amount\s+due|total\s+due)/i.test(line)) {
      const matches = [...line.matchAll(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/g)];
      if (matches.length) {
        return normalizeCurrency(matches[matches.length - 1][1]);
      }
    }
  }

  const allMatches = [...sourceText.matchAll(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/g)].map((match) => normalizeCurrency(match[1]));
  return allMatches.length ? Math.max(...allMatches) : 0;
}

function guessCategory(itemName: string) {
  const value = itemName.toLowerCase();
  if (/(coffee|espresso|tea|latte|cappuccino)/.test(value)) return "Coffee";
  if (/(milk|cream|butter|cheese|dairy)/.test(value)) return "Dairy";
  if (/(flour|sugar|dough|bread|bake|pastry|yeast)/.test(value)) return "Dry Goods";
  if (/(produce|lettuce|tomato|fruit|vegetable)/.test(value)) return "Produce";
  if (/(packaging|cup|lid|container|bag|wrap)/.test(value)) return "Packaging";
  if (/(clean|soap|sanit|paper|towel)/.test(value)) return "Operations";
  return "Other";
}

function extractItemName(line: string) {
  const stripped = line
    .replace(/(?:qty|quantity|x|@)\s*[\d.,]+/gi, " ")
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?/g, " ")
    .replace(/\b(total|subtotal|tax|balance|due|invoice|amount|paid)\b/gi, " ")
    .replace(/[|•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

function parseLineItems(sourceText: string): PilotInvoiceLineItem[] {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !/(subtotal|tax|grand total|balance due|amount due|invoice total)/i.test(line));

  const items: PilotInvoiceLineItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const moneyMatches = [...line.matchAll(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/g)].map((match) => normalizeCurrency(match[1]));
    if (!moneyMatches.length) {
      continue;
    }

    const itemName = extractItemName(line);
    if (!itemName || itemName.length < 2) {
      continue;
    }

    let quantity = 1;
    let unitPrice = moneyMatches[moneyMatches.length - 1];
    let lineTotal = unitPrice;

    if (moneyMatches.length >= 2) {
      unitPrice = moneyMatches[moneyMatches.length - 2];
      lineTotal = moneyMatches[moneyMatches.length - 1];
      const quantityMatch = line.match(/(?:qty|quantity)?\s*(\d+(?:\.\d+)?)\s*(?:x|×|@)/i);
      quantity = quantityMatch ? Number(quantityMatch[1]) : lineTotal > unitPrice && unitPrice > 0 ? Number((lineTotal / unitPrice).toFixed(2)) : 1;
    }

    items.push({
      id: `item-${index + 1}`,
      itemName,
      originalDescription: itemName,
      rawSourceLine: normalizeWhitespace(line),
      comparisonKey: itemName.toLowerCase(),
      quantity,
      unit: "each",
      unitPrice,
      lineTotal,
      category: guessCategory(itemName),
      status: "Needs Review",
      confidence: 0.6,
      needsReview: true,
    });
  }

  return items;
}

export function parseInvoiceDraft(sourceText: string, fileName: string, fileType = ""): PilotInvoiceDraft {
  const normalizedText = normalizeWhitespace(sourceText);
  const text = normalizedText || fileName;
  const lineItems = parseLineItems(sourceText);
  const totalAmount = guessInvoiceTotal(sourceText);
  const hasMeaningfulText = Boolean(normalizedText);

  return {
    supplier: guessSupplier(text, fileName),
    invoiceDate: guessInvoiceDate(text),
    invoiceNumber: guessInvoiceNumber(text, fileName),
    subtotal: 0,
    tax: 0,
    totalAmount,
    status: hasMeaningfulText && lineItems.length ? "Ready" : "Needs Review",
    notes: "",
    fileName,
    fileType,
    extractedText: sourceText.trim(),
    extractionWarnings: [],
    fieldConfidence: {
      supplier: hasMeaningfulText ? 0.6 : 0,
      invoiceDate: 0.5,
      invoiceNumber: 0.5,
      subtotal: 0,
      tax: 0,
      total: 0.6,
      lineItems: lineItems.length ? 0.6 : 0,
    },
    extractionProvider: "heuristic",
    confirmed: false,
    lineItems:
      lineItems.length > 0
        ? lineItems
        : [
            {
              id: "item-1",
              itemName: "Review extracted invoice lines",
              originalDescription: "Review extracted invoice lines",
              rawSourceLine: "Review extracted invoice lines",
              comparisonKey: "review extracted invoice lines",
              quantity: 1,
              unit: "each",
              unitPrice: totalAmount,
              lineTotal: totalAmount,
              category: "Other",
              status: "Needs Review",
              confidence: 0.1,
              needsReview: true,
            },
          ],
  };
}
