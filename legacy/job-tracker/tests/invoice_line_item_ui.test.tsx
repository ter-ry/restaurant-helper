// @ts-nocheck
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { InvoiceLineItemCard } from "../src/components/InvoiceLineItemCard";
import { PilotInvoiceDetailsModal } from "../src/components/PilotInvoiceDetailsModal";
import { buildInvoiceSaveConfirmation, createDraftFromInvoice, getDraftSummaryDisplay } from "../src/lib/invoiceHistory";
import { getLineTotalReviewState, updateLineItemDescription } from "../src/lib/invoiceLineItemView";
import { buildDemoRestaurantInvoiceDraft } from "../src/lib/invoiceSamples";
import { getRecentInvoicePreview, normalizeStoredWorkspace, sortInvoicesNewestFirst, upsertInvoiceRecord } from "../src/lib/pilotWorkspace";
import { parseInvoiceDraft } from "../src/lib/invoiceParsing";
import { InvoiceReviewModal } from "../src/pages/InvoiceUploadPage";
import type { PilotInvoiceDraft, PilotInvoiceLineItem, PilotInvoiceRecord, PilotReconciliationRecord } from "../src/types";
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

function renderReviewModal(savedInvoice: PilotInvoiceRecord | null, draft: PilotInvoiceDraft) {
  return renderToStaticMarkup(
    createElement(InvoiceReviewModal, {
      open: true,
      draft,
      errorMessage: "",
      isProcessing: false,
      isSaving: false,
      onClose: () => undefined,
      onConfirm: () => undefined,
      onSave: () => undefined,
      setDraft: () => undefined,
      uncertainFields: [],
      lineItemsNeedingReview: 0,
      onAddLineItem: () => undefined,
      onRemoveLineItem: () => undefined,
      savedInvoice,
      onReceiveSavedInvoice: () => undefined,
      onSkipSavedInvoice: () => undefined,
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

function testTableAwareParserKeepsRowsAndStopsAtFooter() {
  const draft = parseInvoiceDraft(
    [
      "Bill To Flowtally Kitchen",
      "No. Description Quantity Unit Price Amount (USD)",
      "Ocean Freight - FCL 20 Container container $120000 $120000",
      "Export Customs Clearance 1shipment $9000 $9000",
      "Port Handing Fee-Crigin container $15000 $15000",
      "Bill of Lading Issuance document $35.00 $35.00",
      "5 Documentation Handing 1job $45.00 $45.00",
      "Subtotal $2,420.00",
      "Thank you for your business",
    ].join("\n"),
    "shipping-invoice.pdf",
    "application/pdf",
  );

  assert.equal(draft.lineItems.length, 5);
  assert.equal(draft.lineItems[0].itemName, "Ocean Freight - FCL Container");
  assert.equal(draft.lineItems[0].unit, "container");
  assert.equal(draft.lineItems[1].itemName, "Export Customs Clearance");
  assert.equal(draft.lineItems[1].unit, "shipment");
  assert.equal(draft.lineItems[2].itemName, "Port Handing Fee-Crigin");
  assert.equal(draft.lineItems[3].itemName, "Bill of Lading Issuance");
  assert.equal(draft.lineItems[4].itemName, "Documentation Handing");
  assert.equal(draft.lineItems[4].quantity, 1);
  assert.equal(draft.lineItems[4].unit, "job");
  assert.ok(draft.extractionWarnings.length >= 1);
}

function testMessyCommercialInvoiceParserIgnoresFootersAndKeepsLikelyRows() {
  const draft = parseInvoiceDraft(
    [
      "PRODUCT HS CODE UNITS UNIT PRICE TOTAL",
      "veyor Belt:",
      "88565.2252",
      "stry of origt 2 $200.00 $400.00",
      "Pole with bracker 88565.2545 $85.00 $85.00",
      "Country of origin US",
      "Pole with bracket 88565.2545 1 $85.00 $85.00",
      "Insurance: NOT INCLUDED Sub Total $485.00",
      "Reason for export: SALE shipping Charges $100.00",
      "Incoterms: DAP Insurance $0.00",
      "Description of the goods",
      "Sales Tax (VAT) $117.00",
      "Total $702.00",
    ].join("\n"),
    "commercial-invoice.pdf",
    "application/pdf",
  );

  assert.ok(draft.lineItems.length <= 3);
  assert.ok(draft.lineItems.every((item) => !/country of origin|reason for export|incoterms|description of the goods|sales tax|subtotal|shipping charges|insurance|total/i.test(item.originalDescription)));
  assert.ok(draft.lineItems.some((item) => /pole with bracket/i.test(item.itemName) || /conveyor belt/i.test(item.itemName) || /veyor belt/i.test(item.itemName)));
  assert.ok(draft.extractedText.includes("Country of origin US"));
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

function testDemoRestaurantInvoiceDraftLoadsInstantly() {
  const sample = buildDemoRestaurantInvoiceDraft();
  assert.equal(sample.supplier, "Bubble Bay Tea Supply");
  assert.equal(sample.lineItems.length, 8);
  assert.ok(sample.sourceDocumentUrl?.startsWith("data:image/svg+xml"));
  assert.ok(sample.extractedText.includes("Tapioca Pearls 3kg"));
  assert.ok(sample.extractionWarnings[0].includes("Demo sample invoice"));
}

function testInvoiceReviewModalSaveStepAndCleanupTools() {
  const draft = createDraftFromInvoice(createInvoiceRecord());
  const savedHtml = renderReviewModal(createInvoiceRecord(), draft);
  assert.ok(savedHtml.includes("Invoice saved"));
  assert.ok(savedHtml.includes("Receive into inventory"));
  assert.ok(savedHtml.includes("Skip for now"));
  assert.ok(savedHtml.includes("Close"));

  const reviewHtml = renderToStaticMarkup(
    createElement(InvoiceReviewModal, {
      open: true,
      draft: {
        ...draft,
        lineItems: [
          { ...draft.lineItems[0], id: "a", confidence: 0.4, needsReview: true },
          { ...draft.lineItems[0], id: "b", confidence: 0.95, needsReview: false, itemName: "Oat Milk Carton 4L" },
        ],
      },
      errorMessage: "",
      isProcessing: false,
      isSaving: false,
      onClose: () => undefined,
      onConfirm: () => undefined,
      onSave: () => undefined,
      setDraft: () => undefined,
      uncertainFields: ["supplier"],
      lineItemsNeedingReview: 1,
      onAddLineItem: () => undefined,
      onRemoveLineItem: () => undefined,
      savedInvoice: null,
      onReceiveSavedInvoice: () => undefined,
      onSkipSavedInvoice: () => undefined,
    }),
  );
  assert.ok(reviewHtml.includes("Remove low-confidence rows"));
  assert.ok(reviewHtml.includes("Clear all line items"));
  assert.ok(reviewHtml.includes("Add line item"));
  assert.ok(reviewHtml.includes("Select"));
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
      inventoryStatus: "Received",
      onClose: () => undefined,
      onReopenInReview: () => undefined,
      onReceiveIntoInventory: () => undefined,
    }),
  );
  assert.ok(html.includes("Reopen in review"));
  assert.ok(html.includes("Receive into inventory"));
  assert.ok(html.includes("Saved at"));
  assert.ok(html.includes("Inventory status"));
  assert.ok(html.includes("Received"));
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
testTableAwareParserKeepsRowsAndStopsAtFooter();
testMessyCommercialInvoiceParserIgnoresFootersAndKeepsLikelyRows();
testLegacyStorageCompatibility();
testInvoiceHistoryOrderingAndPreview();
testDuplicateSavePrevention();
testDraftResetAndSaveMessaging();
testDemoRestaurantInvoiceDraftLoadsInstantly();
testInvoiceReviewModalSaveStepAndCleanupTools();
testReopenModalPreservesValues();

console.log("invoice_line_item_ui.test.tsx passed");
