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
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?(?!\s*(?:hrs?|hours?|hr|h)\b)/g, " ")
    .replace(/\b(?:subtotal|tax|gst|hst|vat|balance|due|invoice|amount|paid|total)\b/gi, " ")
    .replace(/[|Ã¢â‚¬Â¢Ã‚Â·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_UNITS = new Set([
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
  "l",
  "liter",
  "liters",
  "litre",
  "litres",
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

function guessLabeledAmount(sourceText: string, labelPattern: RegExp) {
  const lines = sourceText.split(/\r?\n/);
  for (const line of [...lines].reverse()) {
    if (!labelPattern.test(line)) {
      continue;
    }

    const matches = [...line.matchAll(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/g)];
    if (matches.length) {
      return normalizeCurrency(matches[matches.length - 1][1]);
    }
  }
  return 0;
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
    .replace(/[|â€¢Â·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

function extractOriginalItemDescription(line: string) {
  return line
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?(?!\s*(?:hrs?|hours?|hr|h)\b)/g, " ")
    .replace(/\b(?:subtotal|tax|gst|hst|vat|balance|due|invoice|amount|paid|total)\b/gi, " ")
    .replace(/[|Ã¢â‚¬Â¢Ã‚Â·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeTableHeader(line: string) {
  const normalized = normalizeWhitespace(line).toLowerCase();
  return (
    (/description/.test(normalized) && /(qty|quantity)/.test(normalized) && /(price|amount|total)/.test(normalized)) ||
    (/^no\.?\s+description/.test(normalized) && /(qty|quantity)/.test(normalized) && /(amount|total)/.test(normalized))
  );
}

function isTableFooter(line: string) {
  return /^(subtotal|tax|gst|hst|vat|total|amount due|balance due|payment info|payment information|notes?|terms|thank you|grand total)\b/i.test(
    normalizeWhitespace(line),
  );
}

function stripRowNumber(line: string) {
  return line.replace(/^\s*\d+\s+(?=[A-Za-z])/g, "").trim();
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

function parseQuantityAndUnit(line: string) {
  const stripped = stripRowNumber(line)
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})/g, " ")
    .replace(/\$?\s*[0-9]{4,}(?![A-Za-z])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fusedMatch = stripped.match(/^(.*?)(?:\s+)?(\d+(?:\.\d+)?)([A-Za-z][A-Za-z/-]*)$/);
  if (fusedMatch) {
    const unit = fusedMatch[3].toLowerCase();
    if (!KNOWN_UNITS.has(unit)) {
      return {
        description: stripped,
        quantity: 1,
        unit: "each",
      };
    }
    return {
      description: normalizeWhitespace(fusedMatch[1]),
      quantity: Number(fusedMatch[2]) || 1,
      unit,
    };
  }

  const unitMatch = stripped.match(/^(.*?)(?:\s+)([A-Za-z][A-Za-z/-]*)$/);
  if (unitMatch) {
    const unit = unitMatch[2].toLowerCase();
    if (!KNOWN_UNITS.has(unit)) {
      return {
        description: stripped,
        quantity: 1,
        unit: "each",
      };
    }
    return {
      description: normalizeWhitespace(unitMatch[1]),
      quantity: 1,
      unit,
    };
  }

  return {
    description: stripped,
    quantity: 1,
    unit: "each",
  };
}

function parseLineItems(sourceText: string) {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !isTableFooter(line));

  const headerIndex = lines.findIndex((line) => looksLikeTableHeader(line));
  const linesToParse = headerIndex >= 0 ? lines.slice(headerIndex + 1).filter((line) => !isTableFooter(line)) : lines;
  const items: PilotInvoiceLineItem[] = [];
  let normalizedMoneyCount = 0;

  for (let index = 0; index < linesToParse.length; index += 1) {
    const line = linesToParse[index];
    const moneyMatches = [...line.matchAll(/\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/g)].map((match) => match[1]);
    if (!moneyMatches.length) {
      continue;
    }

    const moneyValues = moneyMatches.map((token) => {
      const parsed = parseMoneyToken(token);
      if (parsed.normalized) {
        normalizedMoneyCount += 1;
      }
      return parsed.value;
    });
    const rowNormalizedMoney = moneyMatches.some((token) => parseMoneyToken(token).normalized);

    const parsedQuantity = parseQuantityAndUnit(line);
    const itemName = parsedQuantity.description || extractItemName(line);
    const originalDescription = extractOriginalItemDescription(line) || itemName;
    if (!itemName || itemName.length < 2) {
      continue;
    }

    const unitPrice = moneyValues.length >= 2 ? moneyValues[moneyValues.length - 2] : moneyValues[moneyValues.length - 1];
    const lineTotal = moneyValues[moneyValues.length - 1];

    items.push({
      id: `item-${index + 1}`,
      itemName,
      originalDescription,
      rawSourceLine: normalizeWhitespace(line),
      comparisonKey: normalizeLineItemDescription(originalDescription || itemName).toLowerCase(),
      quantity: parsedQuantity.quantity,
      unit: parsedQuantity.unit,
      unitPrice,
      lineTotal,
      category: guessCategory(itemName),
      status: "Needs Review",
      confidence: rowNormalizedMoney ? 0.55 : headerIndex >= 0 ? 0.9 : 0.6,
      needsReview: rowNormalizedMoney || headerIndex === -1,
    });
  }

  return { items, normalizedMoneyCount, headerDetected: headerIndex >= 0 };
}

export function parseInvoiceDraft(sourceText: string, fileName: string, fileType = ""): PilotInvoiceDraft {
  const normalizedText = normalizeWhitespace(sourceText);
  const text = normalizedText || fileName;
  const { items: lineItems, normalizedMoneyCount, headerDetected } = parseLineItems(sourceText);
  const totalAmount = guessInvoiceTotal(sourceText);
  const subtotalAmount = guessLabeledAmount(sourceText, /subtotal/i);
  const taxAmount = guessLabeledAmount(sourceText, /\b(?:tax|gst|hst|vat)\b/i);
  const hasMeaningfulText = Boolean(normalizedText);
  const lineTotalSum = lineItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  const warnings: string[] = [];

  if (normalizedMoneyCount > 0) {
    warnings.push("Some money values were normalized from OCR digits. Review totals before saving.");
  }

  if ((subtotalAmount > 0 && Math.abs(subtotalAmount - lineTotalSum) > 0.5) || (totalAmount > 0 && Math.abs(totalAmount - lineTotalSum) > 0.5)) {
    warnings.push("Line totals do not exactly match the invoice totals. Please review the extracted amounts.");
  }

  return {
    supplier: guessSupplier(text, fileName),
    invoiceDate: guessInvoiceDate(text),
    invoiceNumber: guessInvoiceNumber(text, fileName),
    subtotal: subtotalAmount,
    tax: taxAmount,
    totalAmount,
    status: hasMeaningfulText && lineItems.length && warnings.length === 0 ? "Ready" : "Needs Review",
    notes: "",
    fileName,
    fileType,
    extractedText: sourceText.trim(),
    extractionWarnings: warnings,
    fieldConfidence: {
      supplier: hasMeaningfulText ? 0.6 : 0,
      invoiceDate: 0.5,
      invoiceNumber: 0.5,
      subtotal: subtotalAmount > 0 ? 0.7 : 0,
      tax: taxAmount > 0 ? 0.7 : 0,
      total: 0.6,
      lineItems: lineItems.length ? (headerDetected && normalizedMoneyCount === 0 ? 0.85 : 0.7) : 0,
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
