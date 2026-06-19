// @ts-nocheck
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PilotWorkspaceProvider } from "../src/lib/pilotWorkspace";
import {
  buildCopyOrderText,
  buildInventoryOperationsSummary,
  buildReorderCsv,
  buildReorderSuggestions,
  canConfirmCountSession,
  confirmCountSession,
  countSessionProgress,
  createCountSessionDraft,
  groupReorderSuggestionsBySupplier,
  largeAdjustmentSignal,
  normalizeCountSession,
  normalizeReorderIntent,
  setCountSessionMetadata,
  updateCountSessionLine,
  upsertReorderIntent,
} from "../src/lib/inventoryOperations";
import { InventoryPage, buildReceiveLines } from "../src/pages/InventoryPageNew";
import {
  buildInventoryMappingKey,
  buildInventorySummary,
  createSeedInventoryState,
  createInventoryDraft,
  deriveInventoryReceiptKey,
  findExactInventoryItemSuggestion,
  findRememberedInventoryMapping,
  findInventoryItemSuggestions,
  normalizeStoredInventoryState,
  rememberInventoryMapping,
  sortInventoryItems,
  upsertInventoryItem,
} from "../src/lib/inventoryWorkspace";
import type { InventoryItem, PilotInventoryState, PilotInvoiceLineItem, PilotInvoiceRecord } from "../src/types";

function createItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "item-1",
    name: "House Espresso Beans 5lb",
    normalizedName: "house espresso beans 5lb",
    category: "Coffee",
    currentQuantity: 8,
    unit: "bag",
    minQuantity: 4,
    parLevel: 10,
    preferredSupplier: "Heritage Coffee Roasters",
    latestPurchasePrice: 69.5,
    latestPurchaseUnit: "bag",
    latestPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-05-30",
    lastCountedAt: "2026-05-30",
    averageDailyUsage: 0.7,
    supplierMatchKey: "heritage coffee roasters",
    itemMatchKey: "house espresso beans 5lb",
    active: true,
    notes: "",
    createdAt: "2026-05-30T12:00:00.000Z",
    updatedAt: "2026-05-30T12:00:00.000Z",
    ...overrides,
  };
}

function createLineItem(overrides: Partial<PilotInvoiceLineItem> = {}): PilotInvoiceLineItem {
  return {
    id: "line-1",
    itemName: "House Espresso Beans 5lb",
    originalDescription: "House Espresso Beans 5lb",
    rawSourceLine: "House Espresso Beans 5lb 69.50 69.50",
    comparisonKey: "house espresso beans 5lb",
    quantity: 1,
    unit: "bag",
    unitPrice: 69.5,
    lineTotal: 69.5,
    category: "Coffee",
    status: "Matched",
    confidence: 0.92,
    needsReview: false,
    ...overrides,
  };
}

function createInvoice(): PilotInvoiceRecord {
  return {
    id: "invoice-1",
    supplier: "Heritage Coffee Roasters",
    invoiceDate: "2026-05-30",
    invoiceNumber: "HC-1001",
    totalAmount: 69.5,
    subtotal: 61.5,
    tax: 8,
    status: "Ready",
    notes: "",
    fileName: "invoice.pdf",
    fileType: "application/pdf",
    extractedText: "Invoice total 69.50",
    extractionWarnings: [],
    fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 1, total: 1, lineItems: 1 },
    extractionProvider: "ocr.space",
    confirmed: true,
    lineItems: [createLineItem()],
    createdAt: "2026-05-30T12:00:00.000Z",
    updatedAt: "2026-05-30T12:00:00.000Z",
    savedAt: "2026-05-30T12:00:00.000Z",
  };
}

function renderInventoryPage() {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/demo/cafe/inventory"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/demo/:profile/inventory",
          element: createElement(PilotWorkspaceProvider, null, createElement(InventoryPage, null)),
        }),
      ),
    ),
  );
}

function testInventorySummaryAndSorting() {
  const seed = createSeedInventoryState();
  const summary = buildInventorySummary(seed);
  assert.ok(summary.inventoryItemCount > 0);
  assert.ok(summary.inventoryReceiptCount > 0);
  assert.ok(summary.inventoryMovementCount > 0);

  const items = sortInventoryItems([createItem({ id: "b", currentQuantity: 0, minQuantity: 0, parLevel: 2 }), createItem({ id: "a", currentQuantity: 8 })]);
  assert.equal(items[0].id, "b");
}

function testLegacyNormalizationAndSuggestions() {
  const normalized = normalizeStoredInventoryState({
    items: [
      {
        id: "legacy",
        name: "Brewed Coffee Beans 5lb",
        category: "Coffee",
        currentQuantity: 5,
        unit: "bag",
        minQuantity: 2,
        parLevel: 5,
        preferredSupplier: "Heritage Coffee Roasters",
        latestPurchasePrice: 50,
        latestPurchaseUnit: "bag",
        latestPurchaseConversionFactor: 1,
        lastReceivedAt: "2026-05-30",
        lastCountedAt: "2026-05-30",
        supplierMatchKey: "",
        itemMatchKey: "",
        active: true,
        notes: "  Legacy item  ",
        createdAt: "2026-05-30T12:00:00.000Z",
        updatedAt: "2026-05-30T12:00:00.000Z",
      } as InventoryItem,
    ],
    movements: [],
    receipts: [],
  } as Partial<PilotInventoryState>);

  assert.equal(normalized.items[0].normalizedName, "brewed coffee beans 5lb");
  assert.equal(normalized.items[0].notes, "Legacy item");

  const suggestions = findInventoryItemSuggestions(normalized.items, "Brewed Coffee Beans 5lb");
  assert.equal(suggestions[0].id, "legacy");
}

function testReceiptKeyStability() {
  const invoice = createInvoice();
  const line = invoice.lineItems[0];
  const keyA = deriveInventoryReceiptKey(invoice, line, "item-1", 1);
  const keyB = deriveInventoryReceiptKey(invoice, line, "item-1", 1);
  assert.equal(keyA, keyB);
  assert.ok(keyA.includes("HC-1001"));
}

function testInventoryMappingHelpers() {
  const items = [
    createItem({ id: "beans", name: "House Espresso Beans 5lb", itemMatchKey: "house espresso beans 5lb" }),
    createItem({ id: "cups", name: "Paper Cups", itemMatchKey: "paper cups" }),
  ];
  const exact = findExactInventoryItemSuggestion(items, "House Espresso Beans 5lb");
  assert.equal(exact?.id, "beans");

  const mappings = rememberInventoryMapping([], {
    supplierKey: "Heritage Coffee Roasters",
    lineKey: "House Espresso Beans 5lb",
    inventoryItemId: "beans",
    inventoryItemName: "House Espresso Beans 5lb",
    confirmedInvoiceUnit: "case",
    inventoryUnit: "bag",
    conversionFactor: 2,
  });
  assert.equal(buildInventoryMappingKey("Heritage Coffee Roasters", "House Espresso Beans 5lb"), buildInventoryMappingKey("heritage coffee roasters", "house espresso beans 5lb"));
  assert.equal(findRememberedInventoryMapping(mappings, "Heritage Coffee Roasters", "House Espresso Beans 5lb")?.inventoryItemId, "beans");
}

function testCountSessionLifecycle() {
  const items = [
    createItem({ id: "beans", name: "House Espresso Beans 5lb", currentQuantity: 8, minQuantity: 4, parLevel: 10 }),
    createItem({ id: "cups", name: "Paper Cups", currentQuantity: 3, minQuantity: 2, parLevel: 4 }),
  ];
  const draft = createCountSessionDraft(items, "category", "Coffee", "Alex", "Pre-open count");
  assert.equal(draft.filterKind, "category");
  assert.equal(draft.selectedCategory, "Coffee");
  assert.equal(draft.countedBy, "Alex");
  assert.equal(countSessionProgress(draft).total, draft.lines.length);

  const updated = updateCountSessionLine(
    updateCountSessionLine(draft, draft.lines[0].id, { countedQuantity: 9 }),
    draft.lines[1].id,
    { skip: true, note: "Skipped for next count" },
  );
  assert.equal(updated.lines[0].confirmationStatus, "confirmed");
  assert.equal(updated.lines[1].confirmationStatus, "skipped");
  assert.equal(canConfirmCountSession(updated), true);

  const result = confirmCountSession({ items, movements: [], countSessions: [updated] }, updated.id);
  assert.ok(result);
  assert.equal(result?.changedCount, 1);
  assert.equal(result?.movements[0].movementType, "physical count adjustment");
  assert.equal(result?.movements[0].sourceCountSessionId, updated.id);
}

function testReorderSuggestionsAndExport() {
  const items = [
    createItem({
      id: "beans",
      name: "House Espresso Beans 5lb",
      currentQuantity: 2,
      minQuantity: 3,
      parLevel: 6,
      latestPurchasePrice: 12,
      latestPurchaseUnit: "case",
      latestPurchaseConversionFactor: 2,
      preferredSupplier: "Heritage Coffee Roasters",
      averageDailyUsage: 1,
    }),
    createItem({
      id: "cups",
      name: "Paper Cups",
      currentQuantity: 1,
      minQuantity: 1,
      parLevel: 0,
      latestPurchasePrice: 4,
      latestPurchaseUnit: "pack",
      latestPurchaseConversionFactor: 4,
      preferredSupplier: "Packaging Pro",
      averageDailyUsage: 0.5,
    }),
  ];

  const suggestions = buildReorderSuggestions(items);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].itemId, "beans");
  assert.equal(suggestions[0].suggestedQuantity, 4);
  assert.equal(suggestions[0].estimatedCost, 24);

  const grouped = groupReorderSuggestionsBySupplier(suggestions);
  assert.equal(grouped[0].supplier, "Heritage Coffee Roasters");
  assert.equal(grouped[0].itemCount, 1);

  const copyText = buildCopyOrderText(grouped[0].supplier, grouped[0].lines.map((line) => ({ itemName: line.itemName, adjustedQuantity: line.adjustedQuantity, unit: line.unit })));
  assert.ok(copyText.includes("House Espresso Beans 5lb"));

  const csv = buildReorderCsv([
    {
      supplier: suggestions[0].supplier,
      itemName: suggestions[0].itemName,
      currentQuantity: suggestions[0].currentQuantity,
      unit: suggestions[0].unit,
      parLevel: suggestions[0].parLevel,
      suggestedQuantity: suggestions[0].adjustedQuantity,
      latestPurchasePrice: suggestions[0].latestPurchasePrice,
      estimatedCost: suggestions[0].estimatedCost,
      notes: suggestions[0].note,
    },
  ]);
  assert.ok(csv.includes("supplier,item,current quantity,unit,PAR"));

  const intent = upsertReorderIntent([], {
    itemId: "beans",
    itemName: "House Espresso Beans 5lb",
    category: "Coffee",
    supplier: "Heritage Coffee Roasters",
    currentQuantity: 2,
    unit: "bag",
    minimumQuantity: 3,
    parLevel: 6,
    suggestedQuantity: 4,
    adjustedQuantity: 5,
    latestPurchasePrice: 12,
    estimatedCost: 24,
    costStatus: "available",
    daysRemaining: 2.5,
    notes: "Ordered by phone",
    status: "Ordered",
  });
  assert.equal(intent[0].itemId, "beans");
  assert.equal(intent[0].status, "Ordered");
  assert.equal(intent[0].markedAt !== undefined, true);

  assert.equal(largeAdjustmentSignal({ quantityDelta: 6, quantityBefore: 10, quantityAfter: 16 } as never), true);
  assert.equal(largeAdjustmentSignal({ quantityDelta: 2, quantityBefore: 100, quantityAfter: 102 } as never), false);
}

function testInventoryOperationsSummaryAndLegacyConversionMemory() {
  const normalized = normalizeCountSession({
    id: "count-legacy",
    lines: [],
    status: "Draft",
    startedAt: "2026-06-18T10:00:00.000Z",
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:00.000Z",
    countedBy: "Sam",
    notes: "  Legacy session  ",
  } as never);
  assert.equal(normalized.notes, "Legacy session");

  const summary = buildInventoryOperationsSummary({
    items: [createItem({ currentQuantity: 2, minQuantity: 3, parLevel: 6 })],
    movements: [{ id: "move-1", inventoryItemId: "item-1", inventoryItemName: "House Espresso Beans 5lb", movementType: "physical count adjustment", quantityDelta: 6, quantityBefore: 2, quantityAfter: 8, unit: "bag", note: "", createdAt: "2026-06-18T10:00:00.000Z", updatedAt: "2026-06-18T10:00:00.000Z" }],
    countSessions: [createCountSessionDraft([createItem()], "all-active")],
  });
  assert.ok(summary.inventoryCountSessionDraftCount >= 1);
  assert.ok(summary.inventoryItemsToReorderCount >= 1);
  assert.ok(summary.inventoryRecentLargeAdjustmentCount >= 1);
}

function testReceiveMappingPreview() {
  const inventoryItems = [createItem({ id: "beans", name: "House Espresso Beans 5lb", itemMatchKey: "house espresso beans 5lb" })];
  const invoice = createInvoice();
  const lines = buildReceiveLines(invoice.id, inventoryItems, [], [], [invoice]);
  assert.equal(lines[0].state, "unmapped");
  assert.equal(lines[0].matchLabel, "Suggested match");
  assert.equal(lines[0].selectedItemId, "");

  const remembered = rememberInventoryMapping([], {
    supplierKey: invoice.supplier,
    lineKey: invoice.lineItems[0].originalDescription,
    inventoryItemId: "beans",
    inventoryItemName: "House Espresso Beans 5lb",
    confirmedInvoiceUnit: "case",
    inventoryUnit: "bag",
    conversionFactor: 2,
  });
  const mappedLines = buildReceiveLines(invoice.id, inventoryItems, remembered, [], [invoice]);
  assert.equal(mappedLines[0].state, "linked");
  assert.equal(mappedLines[0].matchLabel, "Previously confirmed");
  assert.equal(mappedLines[0].selectedItemId, "beans");
  assert.equal(mappedLines[0].conversionFactor, 2);
}

function testBlankDraftCreatesNewItem() {
  const items = [createItem({ id: "item-1", name: "House Espresso Beans 5lb" })];
  const draft = createInventoryDraft();
  draft.name = "Fresh Limes";
  draft.category = "Produce";
  draft.currentQuantity = 12;
  draft.unit = "case";
  draft.minQuantity = 2;
  draft.parLevel = 6;
  draft.preferredSupplier = "Local Farm";
  draft.latestPurchasePrice = 18.5;

  const result = upsertInventoryItem(items, draft);
  assert.equal(result.items.length, 2);
  assert.equal(result.item.id, result.items[0].id);
  assert.equal(result.items[0].name, "Fresh Limes");
  assert.equal(result.items[1].name, "House Espresso Beans 5lb");
}

function testEditDraftUpdatesExistingItem() {
  const items = [createItem({ id: "item-1", name: "House Espresso Beans 5lb" })];
  const draft = createInventoryDraft(items[0]);
  draft.name = "House Espresso Beans 10lb";

  const result = upsertInventoryItem(items, draft);
  assert.equal(result.items.length, 1);
  assert.equal(result.item.id, "item-1");
  assert.equal(result.items[0].name, "House Espresso Beans 10lb");
}

function testInventoryPageLayout() {
  const html = renderInventoryPage();
  assert.ok(html.includes("Inventory"));
  assert.ok(html.includes("Inventory list"));
  assert.ok(html.includes("Receive from saved invoice"));
  assert.ok(html.includes("Adjust stock"));
  assert.ok(html.includes("Physical count"));
  assert.ok(html.includes("History"));
  assert.ok(html.includes("Review invoices"));
  assert.ok(!html.includes("Focused workflow"));
  assert.ok(!html.includes("Save changes"));
}

testInventorySummaryAndSorting();
testLegacyNormalizationAndSuggestions();
testReceiptKeyStability();
testInventoryMappingHelpers();
testCountSessionLifecycle();
testReorderSuggestionsAndExport();
testInventoryOperationsSummaryAndLegacyConversionMemory();
testReceiveMappingPreview();
testBlankDraftCreatesNewItem();
testEditDraftUpdatesExistingItem();
testInventoryPageLayout();

console.log("inventory_workspace_ui.test.tsx passed");
