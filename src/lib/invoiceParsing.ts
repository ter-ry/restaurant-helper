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
    .replace(/[:;,.-]+$/g, "")
    .trim();
}

function normalizeLineItemDescription(value: string) {
  return value
    .replace(/\b(?:product|description|goods|item|hs\s*code|sku|qty|quantity|units?|unit price|amount|line total|total)\b/gi, " ")
    .replace(/\b(?:country of origin|country of orlgin|description of the goods|reason for export|incoterms|shipping charges|insurance|sub\s*total|sales tax|vat|payment info|payment information|notes?|terms?|grand total|invoice total|balance due|amount due)\b/gi, " ")
    .replace(/\b(?:qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|X|@)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:hrs?|hours?|hr|h)\b/gi, " ")
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{2})?(?!\s*(?:hrs?|hours?|hr|h)\b)/g, " ")
    .replace(/\b(?:product|description|goods|item|hs\s*code|sku|qty|quantity|units?|unit price|amount|line total|total)\b/gi, " ")
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

const MONEY_VALUE_PATTERN = /\$?\s*([0-9][0-9,]*(?:\.\d{2})?)(?!\.\d)(?!\d)/g;
const MONEY_STRIP_PATTERN = /\$?\s*[0-9][0-9,]*(?:\.\d{2})?(?!\.\d)(?!\d)/g;
const CODE_NUMBER_PATTERN = /\b\d{5,}\.\d{3,}\b/g;

function getMoneyMatches(value: string) {
  const pattern = new RegExp(MONEY_VALUE_PATTERN.source, MONEY_VALUE_PATTERN.flags);
  return [...value.matchAll(pattern)];
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
      const matches = getMoneyMatches(line);
      if (matches.length) {
        return normalizeCurrency(matches[matches.length - 1][1]);
      }
    }
  }

  const allMatches = getMoneyMatches(sourceText).map((match) => normalizeCurrency(match[1]));
  return allMatches.length ? Math.max(...allMatches) : 0;
}

function guessLabeledAmount(sourceText: string, labelPattern: RegExp) {
  const lines = sourceText.split(/\r?\n/);
  for (const line of [...lines].reverse()) {
    if (!labelPattern.test(line)) {
      continue;
    }

    const matches = getMoneyMatches(line);
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
    .replace(CODE_NUMBER_PATTERN, " ")
    .replace(/\$\s*[0-9][0-9,]*(?:\.\d{2})?|\b[0-9][0-9,]*\.\d{2}\b/g, " ")
    .replace(/\b(total|subtotal|tax|balance|due|invoice|amount|paid)\b/gi, " ")
    .replace(/[|â€¢Â·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

function extractOriginalItemDescription(line: string) {
  return line
    .replace(CODE_NUMBER_PATTERN, " ")
    .replace(/\$\s*[0-9][0-9,]*(?:\.\d{2})?|\b[0-9][0-9,]*\.\d{2}\b/g, " ")
    .replace(/\b(?:product|description|goods|item|hs\s*code|sku|qty|quantity|units?|unit price|amount|line total|total)\b/gi, " ")
    .replace(/[|Ã¢â‚¬Â¢Ã‚Â·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PRODUCT_HEADER_PATTERNS = [
  /(?:^|\b)(?:product|description)\b.*\b(?:hs\s*code|sku)\b.*\b(?:qty|quantity|units?)\b.*\b(?:unit\s*price|price)\b.*\b(?:total|amount)\b/i,
  /(?:^|\b)(?:product|description)\b.*\b(?:qty|quantity|units?)\b.*\b(?:unit\s*price|price)\b.*\b(?:total|amount)\b/i,
  /(?:^|\b)(?:no\.?|line)\s+description\b.*\b(?:qty|quantity|units?)\b.*\b(?:unit\s*price|price)\b.*\b(?:total|amount)\b/i,
];

const STOP_LINE_PATTERNS = [
  /country of or.?gin/i,
  /description of the goods/i,
  /reason for export/i,
  /incoterms/i,
  /shipping charges/i,
  /insurance:\s*not included/i,
  /(?:^|\b)sub\s*total\b/i,
  /(?:^|\b)sales tax\b/i,
  /\bvat\b/i,
  /payment info/i,
  /payment information/i,
  /(?:^|\b)notes?\b/i,
  /(?:^|\b)terms?\b/i,
  /(?:^|\b)grand total\b/i,
  /(?:^|\b)invoice total\b/i,
  /(?:^|\b)balance due\b/i,
  /(?:^|\b)amount due\b/i,
  /(?:^|\b)total\b/i,
  /(?:^|\b)thank you\b/i,
];

function looksLikeTableHeader(line: string) {
  const normalized = normalizeWhitespace(line).toLowerCase();
  return PRODUCT_HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isTableFooter(line: string) {
  const normalized = normalizeWhitespace(line);
  return STOP_LINE_PATTERNS.some((pattern) => pattern.test(normalized));
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
    .replace(CODE_NUMBER_PATTERN, " ")
    .replace(MONEY_STRIP_PATTERN, " ")
    .replace(/\b\d{4,}(?![A-Za-z])/g, " ")
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

function isLikelyProductDescription(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length < 2) {
    return false;
  }

  if (STOP_LINE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized) || /^[0-9\s./-]+$/.test(normalized)) {
    return false;
  }

  return /[a-z]/i.test(normalized);
}

function chooseDescriptionCandidate(line: string, pendingDescription: string) {
  const currentDescription = extractOriginalItemDescription(line).replace(/[:;,.-]+$/g, "");
  if (pendingDescription) {
    const looksNoisy = /\b(of|origin|origt|country|shipping|insurance|export|incoterms|goods)\b/i.test(currentDescription);
    const currentIsShorter = currentDescription.length > 0 && currentDescription.length < Math.max(12, pendingDescription.length - 2);
    if (looksNoisy || currentIsShorter) {
      return pendingDescription;
    }
  }

  return isLikelyProductDescription(currentDescription) ? currentDescription : pendingDescription;
}

function parseLineItems(sourceText: string) {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !isTableFooter(line));

  const headerIndex = lines.findIndex((line) => looksLikeTableHeader(line));
  const items: PilotInvoiceLineItem[] = [];
  let normalizedMoneyCount = 0;
  let pendingDescription = "";
  let pendingRawSourceLine = "";
  const linesToParse = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;

  for (let index = 0; index < linesToParse.length; index += 1) {
    const line = linesToParse[index];
    if (isTableFooter(line) || looksLikeTableHeader(line)) {
      pendingDescription = "";
      pendingRawSourceLine = "";
      continue;
    }

    const moneySource = line.replace(CODE_NUMBER_PATTERN, " ");
    const moneyMatches = getMoneyMatches(moneySource).map((match) => match[1]);
    if (!moneyMatches.length) {
      const lineWithoutMoney = normalizeWhitespace(
        moneySource
          .replace(MONEY_STRIP_PATTERN, " ")
          .replace(/\b(?:hs\s*code|sku)\b/gi, " ")
          .replace(/\b\d{4,}(?:\.\d+)?\b/g, " ")
          .replace(/\s+/g, " "),
      );
      if (isLikelyProductDescription(lineWithoutMoney) && !/^\d{4,}(?:\.\d+)?$/.test(lineWithoutMoney)) {
        pendingDescription = lineWithoutMoney;
        pendingRawSourceLine = line;
      }
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
    const candidateDescription = chooseDescriptionCandidate(line, pendingDescription);
    const itemName = parsedQuantity.description || candidateDescription || extractItemName(line);
    const originalDescription = candidateDescription || extractOriginalItemDescription(line) || itemName;
    if (!itemName || itemName.length < 2) {
      pendingDescription = "";
      pendingRawSourceLine = "";
      continue;
    }

    const unitPrice = moneyValues.length >= 2 ? moneyValues[moneyValues.length - 2] : moneyValues[moneyValues.length - 1];
    const lineTotal = moneyValues[moneyValues.length - 1];
    const descriptionIsPending = Boolean(pendingDescription) && itemName === pendingDescription;
    const descriptionIsWeak = !isLikelyProductDescription(parsedQuantity.description) || parsedQuantity.description.length < 4;
    const hasStrongEvidence = parsedQuantity.quantity > 1 || parsedQuantity.unit !== "each" || moneyMatches.length >= 2;

    items.push({
      id: `item-${index + 1}`,
      itemName,
      originalDescription,
      rawSourceLine: pendingRawSourceLine ? `${pendingRawSourceLine} | ${normalizeWhitespace(line)}` : normalizeWhitespace(line),
      comparisonKey: normalizeLineItemDescription(originalDescription || itemName).toLowerCase(),
      quantity: parsedQuantity.quantity,
      unit: parsedQuantity.unit,
      unitPrice,
      lineTotal,
      category: guessCategory(itemName),
      status: "Needs Review",
      confidence: rowNormalizedMoney ? (hasStrongEvidence && !descriptionIsPending && !descriptionIsWeak ? 0.82 : 0.55) : headerIndex >= 0 ? 0.88 : 0.6,
      needsReview: rowNormalizedMoney || headerIndex === -1 || descriptionIsPending || descriptionIsWeak,
    });

    pendingDescription = "";
    pendingRawSourceLine = "";
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
