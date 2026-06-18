// @ts-nocheck
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { InvoiceLineItemCard } from "../src/components/InvoiceLineItemCard";
import { getLineTotalReviewState, updateLineItemDescription } from "../src/lib/invoiceLineItemView";
import { normalizeStoredWorkspace } from "../src/lib/pilotWorkspace";
import type { PilotInvoiceDraft, PilotInvoiceLineItem, PilotReconciliationRecord } from "../src/types";

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
  assert.equal(updated.originalDescription, "Labor 3hrs");
  assert.equal(updated.comparisonKey, "labor");
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
  assert.equal(normalized.invoices[0].lineItems[0].rawSourceLine, "Labor 3hrs 5.00 15.00");
  assert.equal(normalized.invoices[0].lineItems[0].comparisonKey, "labor");
}

testLineItemCardSimplification();
testLineTotalSummary();
testDescriptionEditRegeneratesKey();
testLegacyStorageCompatibility();

console.log("invoice_line_item_ui.test.tsx passed");
