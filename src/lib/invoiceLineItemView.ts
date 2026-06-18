import type { PilotInvoiceLineItem } from "../types";

const currencyEpsilon = 0.01;

export function normalizeComparisonKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|hrs?|hours?|hr|h)\b/g, " ")
    .replace(/\b(?:qty|quantity|case|cs|pack|pkg|x|hrs?|hours?|hr|h)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function updateLineItemDescription(item: PilotInvoiceLineItem, description: string): PilotInvoiceLineItem {
  const itemName = description.trim();
  return {
    ...item,
    itemName,
    originalDescription: itemName,
    comparisonKey: normalizeComparisonKey(itemName),
    needsReview: true,
  };
}

export function formatLineConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

export function getLineTotalReviewState(item: Pick<PilotInvoiceLineItem, "quantity" | "unitPrice" | "lineTotal">) {
  const quantity = Number(item.quantity);
  const unitPrice = Number(item.unitPrice);
  const extractedTotal = Number(item.lineTotal);
  const canCalculate = Number.isFinite(quantity) && Number.isFinite(unitPrice) && quantity > 0 && unitPrice > 0;
  const calculatedTotal = canCalculate ? Number((quantity * unitPrice).toFixed(2)) : 0;
  const hasPrintedTotal = Number.isFinite(extractedTotal) && extractedTotal > 0;
  const mismatch = canCalculate && hasPrintedTotal && Math.abs(calculatedTotal - extractedTotal) >= currencyEpsilon;
  const needsReview = mismatch || !canCalculate || !hasPrintedTotal;

  const displayTotal = canCalculate ? calculatedTotal : extractedTotal;
  const summary = `Line total: $${displayTotal.toFixed(2)}`;

  let warning = "";
  if (mismatch) {
    warning = `Printed total $${extractedTotal.toFixed(2)} does not match quantity x unit price.`;
  } else if (!canCalculate) {
    warning = hasPrintedTotal
      ? "Quantity or unit price needs review before a calculated total can be confirmed."
      : "Line total could not be calculated.";
  }

  return {
    calculatedTotal,
    extractedTotal,
    displayTotal,
    summary,
    mismatch,
    hasPrintedTotal,
    canCalculate,
    warning,
    needsReview,
  };
}
