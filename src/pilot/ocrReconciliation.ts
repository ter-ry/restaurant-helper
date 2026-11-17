import type { PilotInvoiceOcrResponse } from "./pilotApi";

/** What the invoice itself printed, captured at extraction time. `null` means the amount could not be read. */
export interface OcrPrintedEvidence {
  printedSubtotal: number | null;
  printedTax: number | null;
  printedTotal: number | null;
  /** Backend extraction notes, shown verbatim. Never used to mark anything verified. */
  warnings: string[];
  /** Message the backend attached to its own reconciliation, so it is not shown twice. */
  serverMessage: string;
  /** Null while the extracted draft is unsaved; set to the saved invoice id once that draft is saved, so the check follows it. */
  invoiceId: number | null;
  /** Server-signed provenance token from the OCR response; saved with the invoice so the server can guard receipt. */
  provenance: string;
}

export type OcrCheckStatus = "matched" | "incomplete" | "unverified";

export interface OcrCheck {
  status: OcrCheckStatus;
  itemsTotal: number;
  expectedAmount: number | null;
  difference: number | null;
  message: string;
}

const cents = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => `$${cents(Math.abs(value)).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Only an amount the backend actually read counts as printed evidence. The backend reports a missing amount as
 * `{ value: 0, confidence: 0, needsReview: true }` and an inferred one with `needsReview: true`; neither is a printed
 * figure, so both stay "unknown" instead of becoming a $0 target. A printed zero (e.g. "Tax 0.00") is kept.
 */
function printedAmount(field: { value: string | number | null; confidence?: number; needsReview?: boolean } | undefined): number | null {
  if (!field || field.needsReview === true || (typeof field.confidence === "number" && field.confidence <= 0)) return null;
  const value = field.value;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rebuilds the evidence of a saved invoice from the amounts the server recorded (survives reload). */
export function persistedOcrEvidence(invoice: { id: number; ocrProvenance?: { recorded: boolean; printedSubtotal: number | null; printedTax: number | null; printedTotal: number | null } }): OcrPrintedEvidence | null {
  const recorded = invoice.ocrProvenance;
  if (!recorded?.recorded) return null;
  return { printedSubtotal: recorded.printedSubtotal, printedTax: recorded.printedTax, printedTotal: recorded.printedTotal, warnings: [], serverMessage: "", invoiceId: invoice.id, provenance: "" };
}

export function buildOcrPrintedEvidence(result: PilotInvoiceOcrResponse): OcrPrintedEvidence {
  return {
    printedSubtotal: printedAmount(result.fields.subtotal),
    printedTax: printedAmount(result.fields.tax),
    printedTotal: printedAmount(result.fields.total),
    warnings: (result.warnings ?? []).filter((warning) => typeof warning === "string" && warning.trim()),
    serverMessage: result.reconciliation?.message ?? "",
    invoiceId: null,
    provenance: result.provenance ?? "",
  };
}

/**
 * Compares the CURRENT editor lines with what the invoice printed. It never adjusts or invents anything: the
 * warning clears only when the lines themselves add up to the printed amount.
 */
export function checkOcrLines(evidence: OcrPrintedEvidence, lineTotals: number[]): OcrCheck {
  const itemsTotal = cents(lineTotals.reduce((sum, value) => sum + (Number(value) || 0), 0));
  let expectedAmount: number | null = null;
  let label = "";
  if (evidence.printedSubtotal !== null) {
    expectedAmount = cents(evidence.printedSubtotal);
    label = "the invoice subtotal";
  } else if (evidence.printedTotal !== null && evidence.printedTax !== null) {
    expectedAmount = cents(evidence.printedTotal - (evidence.printedTax ?? 0));
    label = evidence.printedTax ? "the invoice total less tax" : "the invoice total";
  }
  if (expectedAmount === null) {
    return {
      status: "unverified",
      itemsTotal,
      expectedAmount: null,
      difference: null,
      message: `The invoice subtotal and total could not be read, so the extracted items (${money(itemsTotal)}) are not verified. Compare them with the original document before receiving.`,
    };
  }
  const difference = cents(expectedAmount - itemsTotal);
  if (Math.abs(difference) <= 0.01) {
    return { status: "matched", itemsTotal, expectedAmount, difference: 0, message: `Extracted items total ${money(itemsTotal)}, which matches ${label}.` };
  }
  const advice = difference > 0 ? "Review missing or incorrect items before receiving." : "The items add up to more than the invoice. Check for duplicated or misread lines before receiving.";
  return {
    status: "incomplete",
    itemsTotal,
    expectedAmount,
    difference,
    message: `Extracted items total ${money(itemsTotal)}, but ${label} is ${money(expectedAmount)}. Difference: ${money(difference)}. ${advice}`,
  };
}
