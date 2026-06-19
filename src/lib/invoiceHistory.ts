import type { InvoiceFieldConfidence, PilotInvoiceDraft, PilotInvoiceRecord } from "../types";

const confidenceThreshold = 0.8;

export function createDraftFromInvoice(invoice: PilotInvoiceRecord): PilotInvoiceDraft {
  return {
    id: invoice.id,
    supplier: invoice.supplier,
    invoiceDate: invoice.invoiceDate,
    invoiceNumber: invoice.invoiceNumber,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    totalAmount: invoice.totalAmount,
    status: invoice.status,
    notes: invoice.notes,
    fileName: invoice.fileName,
    fileType: invoice.fileType,
    extractedText: invoice.extractedText,
    extractionWarnings: [...invoice.extractionWarnings],
    fieldConfidence: { ...invoice.fieldConfidence },
    extractionProvider: invoice.extractionProvider,
    confirmed: invoice.confirmed,
    lineItems: invoice.lineItems.map((item) => ({ ...item })),
    savedAt: invoice.savedAt,
  };
}

export function getDraftSummaryDisplay(draft: PilotInvoiceDraft, reviewOpen: boolean) {
  const hasActiveDraft = Boolean(
    reviewOpen ||
      draft.fileName ||
      draft.extractedText ||
      draft.notes ||
      draft.extractionWarnings.length ||
      draft.lineItems.some((item) => item.itemName.trim() || item.rawSourceLine.trim() || item.comparisonKey.trim()),
  );
  const confidenceFields: Array<keyof InvoiceFieldConfidence> = ["supplier", "invoiceDate", "invoiceNumber", "subtotal", "tax", "total", "lineItems"];
  const uncertainFieldCount = confidenceFields.filter((field) => draft.fieldConfidence[field] < confidenceThreshold).length;
  const lineItemReviewCount = draft.lineItems.filter((item) => item.needsReview || item.confidence < confidenceThreshold).length;
  const confidence = hasActiveDraft
    ? `${Math.round(((draft.fieldConfidence.supplier + draft.fieldConfidence.invoiceDate + draft.fieldConfidence.invoiceNumber + draft.fieldConfidence.subtotal + draft.fieldConfidence.tax + draft.fieldConfidence.total) / 6) * 100) || 0}%`
    : "-";
  const reviewFlags = hasActiveDraft ? uncertainFieldCount + lineItemReviewCount : 0;
  return { hasActiveDraft, confidence, reviewFlags };
}

export function buildInvoiceSaveConfirmation(invoice: Pick<PilotInvoiceRecord, "supplier" | "invoiceNumber">) {
  return `Invoice saved successfully${invoice.supplier ? `: ${invoice.supplier}` : ""}${invoice.invoiceNumber ? ` / ${invoice.invoiceNumber}` : ""}.`;
}
