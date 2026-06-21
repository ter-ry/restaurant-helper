// @ts-nocheck
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { InvoiceLineItemCard } from "../src/components/InvoiceLineItemCard";
import { PilotInvoiceDetailsModal } from "../src/components/PilotInvoiceDetailsModal";
import { buildInvoiceSaveConfirmation, createDraftFromInvoice, getDraftSummaryDisplay } from "../src/lib/invoiceHistory";
import { getLineTotalReviewState, updateLineItemDescription } from "../src/lib/invoiceLineItemView";
import { getRecentInvoicePreview, normalizeStoredWorkspace, sortInvoicesNewestFirst, upsertInvoiceRecord } from "../src/lib/pilotWorkspace";
import { parseInvoiceDraft } from "../src/lib/invoiceParsing";
import type { PilotInvoiceDraft, PilotInvoiceLineItem, PilotReconciliationRecord } from "../src/types";
import { formatDate } from "../src/utils/format";

function createLineItem(overrides: Partial<PilotInvoiceLineItem> = {}): PilotInvoiceLineItem {
  return {
    id: "line-1",
    itemName: "Front and rear brake cables",
    originalDescription: "Front and rear brake cables",
    rawSourceLine: "Front and rear brake cables 100.00 100.00",
    comparisonKey: "front and rear brake cables",
    quantity: 1,
    unit: "each",
    unitPrice: 100,
    lineTotal: 100,
    category: "Other",
    status: "Matched",
    confidence: 0.81,
    needsReview: false,
    ...overrides,
  };
}

function createDraft(item: PilotInvoiceLineItem): PilotInvoiceDraft {
  return {
    id: undefined,
    supplier: "East Repair Inc.",
    invoiceDate: "2019-02-11",
    invoiceNumber: "US-001",
    subtotal: 145,
    tax: 9.06,
    totalAmount: 154.06,
    status: "Ready",
    notes: "",
    fileName: "invoice.png",
    fileType: "image/png",
    extractedText: "",
    extractionWarnings: [],
    fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 1, total: 1, lineItems: 1 },
    extractionProvider: "ocr.space",
    confirmed: true,
    lineItems: [item],
    savedAt: undefined,
  };
}

function createInvoiceRecord(overrides: Partial<Parameters<typeof createDraftFromInvoice>[0]> = {}) {
  const lineItem: PilotInvoiceLineItem = createLineItem({
    id: "line-1",
    itemName: "Labor",
    originalDescription: "Labor 3hrs",
    rawSourceLine: "Labor 3hrs 5.00 15.00",
    comparisonKey: "labor",
    quantity: 3,
    unit: "hr",
    unitPrice: 5,
    lineTotal: 15,
    confidence: 0.91,
  });

  return {
    id: "invoice-1",
    supplier: "East Repair Inc.",
    invoiceDate: "2019-02-11",
    invoiceNumber: "US-001",
    totalAmount: 154.06,
    subtotal: 145,
    tax: 9.06,
    status: "Ready" as const,
    notes: "",
    fileName: "invoice.png",
    fileType: "image/png",
    sourceDocumentUrl: "blob:invoice-1",
    sourceDocumentName: "invoice.png",
    sourceDocumentType: "image/png",
    extractedText: "Invoice total 154.06",
    extractionWarnings: [],
    fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 1, total: 1, lineItems: 1 },
    extractionProvider: "ocr.space",
    confirmed: true,
    lineItems: [lineItem],
    createdAt: "2019-02-11T12:00:00.000Z",
    updatedAt: "2019-02-11T12:00:00.000Z",
    savedAt: "2019-02-11T12:00:00.000Z",
    ...overrides,
  };
}

function renderCard(item: PilotInvoiceLineItem) {
  return renderToStaticMarkup(
    createElement(InvoiceLineItemCard, {
      item,
      index: 0,
      setDraft: () => undefined,
      onRemove: () => undefined,
    }),
  );
}

function testLineItemCardSimplification() {
  const html = renderCard(createLineItem());
  assert.equal((html.match(/confidence/g) ?? []).length, 1);
  assert.equal((html.match(/<input\b/g) ?? []).length, 4);
  assert.ok(html.includes("Item description"));
  assert.ok(html.includes("View source details"));
  assert.ok(!html.includes('placeholder="Normalized match key"'));
}

function testLineTotalSummary() {
  const matching = getLineTotalReviewState(createLineItem());
  assert.equal(matching.mismatch, false);
  assert.equal(matching.summary, "Line total: $100.00");
  assert.equal(matching.warning, "");

  const mismatch = getLineTotalReviewState(createLineItem({ quantity: 2, unitPrice: 15, lineTotal: 40 }));
  assert.equal(mismatch.mismatch, true);
  assert.ok(mismatch.warning.includes("does not match quantity x unit price"));
  const mismatchHtml = renderCard(createLineItem({ quantity: 2, unitPrice: 15, lineTotal: 40 }));
  assert.ok(mismatchHtml.includes("Correct printed total"));
  assert.ok(mismatchHtml.includes("Printed total $40.00 does not match quantity x unit price."));
}

function testDescriptionEditRegeneratesKey() {
  const updated = updateLineItemDescription(createLineItem(), "Labor 3hrs");
  assert.equal(updated.itemName, "Labor 3hrs");
  assert.equal(updated.originalDescription, "Front and rear brake cables");
  assert.equal(updated.comparisonKey, "labor");
}

function testInvalidDateFormattingIsSafe() {
  assert.equal(formatDate("not-a-date"), "—");
}

function testParserPreservesOriginalDescription() {
  const draft = parseInvoiceDraft("Labor 3hrs $15.00\nGrand Total $15.00", "invoice.pdf", "application/pdf");
  assert.equal(draft.lineItems[0].originalDescription, "Labor 3hrs");
  assert.equal(draft.lineItems[0].comparisonKey, "labor");
}

function testLegacyStorageCompatibility() {
  const legacyWorkspace = {
    invoices: [
      {
        id: "invoice-1",
        supplier: "East Repair Inc.",
        invoiceDate: "2019-02-11",
        invoiceNumber: "US-001",
        totalAmount: 154.06,
        subtotal: 145,
        tax: 9.06,
        status: "Ready",
        notes: "",
        fileName: "invoice.png",
        fileType: "image/png",
        extractedText: "",
        extractionWarnings: [],
        fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 1, total: 1, lineItems: 1 },
        extractionProvider: "ocr.space",
        confirmed: true,
        lineItems: [
          {
            id: "line-1",
            itemName: "Labor",
            originalDescription: "Labor 3hrs 5.00 15.00",
            comparisonKey: "",
            quantity: 3,
            unit: "hr",
            unitPrice: 5,
            lineTotal: 15,
            category: "Other",
            status: "Matched",
            confidence: 0.9,
            needsReview: false,
          },
        ],
        createdAt: "2019-02-11T12:00:00.000Z",
        updatedAt: "2019-02-11T12:00:00.000Z",
      },
    ],
    reconciliations: [] as PilotReconciliationRecord[],
  };

  const normalized = normalizeStoredWorkspace(legacyWorkspace as never);
  assert.equal(normalized.invoices[0].lineItems[0].originalDescription, "Labor 3hrs 5.00 15.00");
  assert.equal(normalized.invoices[0].lineItems[0].rawSourceLine, "Labor 3hrs 5.00 15.00");
  assert.equal(normalized.invoices[0].lineItems[0].comparisonKey, "labor");
  assert.ok(normalized.invoices[0].savedAt);
}

function testInvoiceHistoryOrderingAndPreview() {
  const invoices = [
    createInvoiceRecord({
      id: "older",
      invoiceNumber: "OLD-1",
      createdAt: "2019-02-10T12:00:00.000Z",
      updatedAt: "2019-02-10T12:00:00.000Z",
      savedAt: "2019-02-10T12:00:00.000Z",
    }),
    createInvoiceRecord({
      id: "newer",
      invoiceNumber: "NEW-1",
      createdAt: "2019-02-09T12:00:00.000Z",
      updatedAt: "2019-02-09T12:00:00.000Z",
      savedAt: "2019-02-12T12:00:00.000Z",
    }),
  ];
  const sorted = sortInvoicesNewestFirst(invoices);
  assert.equal(sorted[0].id, "newer");

  const preview = getRecentInvoicePreview([
    ...invoices,
    createInvoiceRecord({ id: "third", invoiceNumber: "THIRD-1", savedAt: "2019-02-11T12:00:00.000Z", createdAt: "2019-02-11T12:00:00.000Z", updatedAt: "2019-02-11T12:00:00.000Z" }),
    createInvoiceRecord({ id: "fourth", invoiceNumber: "FOURTH-1", savedAt: "2019-02-13T12:00:00.000Z", createdAt: "2019-02-13T12:00:00.000Z", updatedAt: "2019-02-13T12:00:00.000Z" }),
    createInvoiceRecord({ id: "fifth", invoiceNumber: "FIFTH-1", savedAt: "2019-02-14T12:00:00.000Z", createdAt: "2019-02-14T12:00:00.000Z", updatedAt: "2019-02-14T12:00:00.000Z" }),
    createInvoiceRecord({ id: "sixth", invoiceNumber: "SIXTH-1", savedAt: "2019-02-15T12:00:00.000Z", createdAt: "2019-02-15T12:00:00.000Z", updatedAt: "2019-02-15T12:00:00.000Z" }),
  ]);
  assert.equal(preview.visibleInvoices.length, 5);
  assert.equal(preview.visibleInvoices[0].id, "sixth");
  assert.equal(preview.hasMore, true);
  assert.equal(preview.totalCount, 6);
}

function testDuplicateSavePrevention() {
  const existing = [createInvoiceRecord()];
  const replacement = createInvoiceRecord({
    invoiceNumber: "US-002",
    totalAmount: 200,
    savedAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  });
  const next = upsertInvoiceRecord(existing, replacement);
  assert.equal(next.length, 1);
  assert.equal(next[0].invoiceNumber, "US-002");
}

function testDraftResetAndSaveMessaging() {
  const blankDraft: PilotInvoiceDraft = {
    id: undefined,
    supplier: "",
    invoiceDate: "",
    invoiceNumber: "",
    subtotal: 0,
    tax: 0,
    totalAmount: 0,
    status: "Needs Review",
    notes: "",
    fileName: "",
    fileType: "",
    extractedText: "",
    extractionWarnings: [],
    fieldConfidence: { supplier: 0, invoiceDate: 0, invoiceNumber: 0, subtotal: 0, tax: 0, total: 0, lineItems: 0 },
    extractionProvider: "manual",
    confirmed: false,
    lineItems: [createLineItem({ itemName: "", originalDescription: "", rawSourceLine: "", comparisonKey: "", quantity: 0, unitPrice: 0, lineTotal: 0, confidence: 0, needsReview: true })],
    savedAt: undefined,
  };
  const blankMetrics = getDraftSummaryDisplay(blankDraft, false);
  assert.equal(blankMetrics.confidence, "-");
  assert.equal(blankMetrics.reviewFlags, 0);

  const savedMessage = buildInvoiceSaveConfirmation({ supplier: "East Repair Inc.", invoiceNumber: "US-001" });
  assert.equal(savedMessage, "Invoice saved successfully: East Repair Inc. / US-001.");
}

function testReopenModalPreservesValues() {
  const invoice = createInvoiceRecord();
  const draft = createDraftFromInvoice(invoice);
  assert.equal(draft.id, invoice.id);
  assert.equal(draft.lineItems[0].originalDescription, "Labor 3hrs");
  assert.equal(draft.lineItems[0].rawSourceLine, "Labor 3hrs 5.00 15.00");
  assert.equal(draft.lineItems[0].comparisonKey, "labor");
  assert.equal(draft.sourceDocumentUrl, "blob:invoice-1");

  const html = renderToStaticMarkup(
    createElement(PilotInvoiceDetailsModal, {
      open: true,
      invoice,
      onClose: () => undefined,
      onReopenInReview: () => undefined,
      onReceiveIntoInventory: () => undefined,
    }),
  );
  assert.ok(html.includes("Reopen in review"));
  assert.ok(html.includes("Receive into inventory"));
  assert.ok(html.includes("Saved at"));
  assert.ok(html.includes("Labor 3hrs"));
  assert.ok(html.includes("US-001"));
  assert.ok(html.includes("Original description"));
  assert.ok(html.includes("Original document"));
  assert.ok(html.includes("blob:invoice-1"));
  assert.ok(html.includes("sm:hidden"));
  assert.ok(html.includes("Line item 1"));
}

testLineItemCardSimplification();
testLineTotalSummary();
testDescriptionEditRegeneratesKey();
testInvalidDateFormattingIsSafe();
testParserPreservesOriginalDescription();
testLegacyStorageCompatibility();
testInvoiceHistoryOrderingAndPreview();
testDuplicateSavePrevention();
testDraftResetAndSaveMessaging();
testReopenModalPreservesValues();

console.log("invoice_line_item_ui.test.tsx passed");
