// @ts-nocheck
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PilotWorkspaceProvider } from "../src/lib/pilotWorkspace";
import { buildOwnerDashboardModel } from "../src/lib/ownerDashboard";
import { OwnerDashboardPage } from "../src/pages/OwnerDashboardPage";

function createInvoice(overrides = {}) {
  return {
    id: `invoice-${Math.random().toString(16).slice(2, 8)}`,
    supplier: "Cup & Lid Supply",
    invoiceDate: "2026-06-18",
    invoiceNumber: "CLS-1001",
    totalAmount: 150,
    subtotal: 137.5,
    tax: 12.5,
    status: "Ready",
    notes: "",
    fileName: "invoice.pdf",
    fileType: "application/pdf",
    extractedText: "Sample invoice text",
    extractionWarnings: [],
    fieldConfidence: { supplier: 1, invoiceDate: 1, invoiceNumber: 1, subtotal: 1, tax: 1, total: 1, lineItems: 1 },
    extractionProvider: "seed",
    confirmed: true,
    lineItems: [
      {
        id: "line-1",
        itemName: "Tapioca Pearls",
        originalDescription: "Tapioca Pearls 2 bag",
        rawSourceLine: "Tapioca Pearls 2 bag 35.00 70.00",
        comparisonKey: "tapioca pearls",
        quantity: 2,
        unit: "bag",
        unitPrice: 35,
        lineTotal: 70,
        category: "Packaging",
        status: "Matched",
        confidence: 0.96,
        needsReview: false,
      },
    ],
    createdAt: "2026-06-18T12:00:00.000Z",
    updatedAt: "2026-06-18T12:00:00.000Z",
    savedAt: "2026-06-18T12:00:00.000Z",
    ...overrides,
  };
}

function createSummary(overrides = {}) {
  return {
    invoiceCount: 3,
    invoiceSpend: 500,
    invoiceReviewQueueCount: 1,
    weeklyInvoiceSpend: 500,
    weeklyInvoiceCount: 2,
    monthlyInvoiceSpend: 500,
    monthlyInvoiceCount: 2,
    reconciliationCount: 2,
    unresolvedReconciliationCount: 1,
    weeklyUnresolvedVariance: 7.25,
    monthlyUnresolvedVariance: 7.25,
    recentPriceChangeCount: 1,
    todayReconciliationStatus: "Needs Review",
    todayReconciliationVariance: 7.25,
    todayReconciliationDate: "2026-06-21",
    inventoryItemCount: 1,
    inventoryLowStockCount: 1,
    inventoryReorderNowCount: 1,
    inventoryOutOfStockCount: 0,
    inventoryCountNeededCount: 1,
    inventoryMovementCount: 1,
    inventoryReceiptCount: 1,
    inventoryValue: 25,
    inventoryCountSessionDraftCount: 0,
    inventoryItemsToReorderCount: 1,
    inventoryEstimatedReorderCost: 48,
    inventoryRecentLargeAdjustmentCount: 0,
    ...overrides,
  };
}

function renderOwnerDashboardPage() {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/demo/cafe"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/demo/:profile",
          element: createElement(PilotWorkspaceProvider, null, createElement(OwnerDashboardPage, null)),
        }),
      ),
    ),
  );
}

function testOwnerDashboardModelAggregatesSafely() {
  const currentMonthInvoice = createInvoice({
    id: "invoice-a",
    supplier: "Cup & Lid Supply",
    invoiceDate: "2026-06-18",
    invoiceNumber: "CLS-1001",
    totalAmount: 150,
    inventoryReceiptStatus: "Not received",
    lineItems: [
      {
        id: "line-1",
        itemName: "Tapioca Pearls",
        originalDescription: "Tapioca Pearls 2 bag",
        rawSourceLine: "Tapioca Pearls 2 bag 35.00 70.00",
        comparisonKey: "tapioca pearls",
        quantity: 2,
        unit: "bag",
        unitPrice: 35,
        lineTotal: 70,
        category: "Packaging",
        status: "Matched",
        confidence: 0.96,
        needsReview: false,
      },
      {
        id: "line-2",
        itemName: "Cup Lids",
        originalDescription: "Cup Lids 1 case",
        rawSourceLine: "Cup Lids 1 case 15.00 15.00",
        comparisonKey: "cup lids",
        quantity: 1,
        unit: "case",
        unitPrice: 15,
        lineTotal: 15,
        category: "Packaging",
        status: "Needs Review",
        confidence: 0.52,
        needsReview: true,
      },
    ],
  });

  const laterInvoice = createInvoice({
    id: "invoice-b",
    supplier: "Tea Time Co",
    invoiceDate: "2026-06-19",
    invoiceNumber: "TTC-2044",
    totalAmount: 250,
    inventoryReceiptStatus: "Skipped",
    lineItems: [
      {
        id: "line-3",
        itemName: "Black Tea Leaves",
        originalDescription: "Black Tea Leaves 3 case",
        rawSourceLine: "Black Tea Leaves 3 case 100.00 300.00",
        comparisonKey: "black tea leaves",
        quantity: 3,
        unit: "case",
        unitPrice: 100,
        lineTotal: 300,
        category: "Tea",
        status: "Matched",
        confidence: 0.93,
        needsReview: false,
      },
    ],
  });

  const priorInvoice = createInvoice({
    id: "invoice-c",
    supplier: "Cup & Lid Supply",
    invoiceDate: "2026-05-28",
    invoiceNumber: "CLS-0990",
    totalAmount: 50,
    status: "Needs Review",
    lineItems: [
      {
        id: "line-4",
        itemName: "Tapioca Pearls",
        originalDescription: "Tapioca Pearls 1 bag",
        rawSourceLine: "Tapioca Pearls 1 bag 30.00 30.00",
        comparisonKey: "tapioca pearls",
        quantity: 1,
        unit: "bag",
        unitPrice: 30,
        lineTotal: 30,
        category: "Packaging",
        status: "Price Increased",
        confidence: 0.91,
        needsReview: false,
      },
    ],
  });

  const malformedInvoice = createInvoice({
    id: "invoice-d",
    supplier: "",
    invoiceDate: "not-a-date",
    invoiceNumber: "BAD-1",
    totalAmount: Number.NaN,
    status: "Ready",
    inventoryReceiptStatus: "Received",
    lineItems: [
      {
        id: "line-5",
        itemName: "",
        originalDescription: "",
        rawSourceLine: "",
        comparisonKey: "",
        quantity: 0,
        unit: "each",
        unitPrice: Number.NaN,
        lineTotal: Number.NaN,
        category: "Other",
        status: "Needs Review",
        confidence: 0.1,
        needsReview: true,
      },
    ],
  });

  const model = buildOwnerDashboardModel({
    invoices: [currentMonthInvoice, laterInvoice, priorInvoice, malformedInvoice],
    reviewQueue: [priorInvoice],
    priceChanges: [
      {
        id: "change-1",
        invoiceId: "invoice-c",
        invoiceDate: "2026-06-19",
        previousInvoiceDate: "2026-05-28",
        supplier: "Cup & Lid Supply",
        itemName: "Tapioca Pearls",
        originalDescription: "Tapioca Pearls 1 bag",
        rawSourceLine: "Tapioca Pearls 1 bag 30.00 30.00",
        comparisonKey: "tapioca pearls",
        category: "Packaging",
        previousPrice: 30,
        currentPrice: 35,
        changePercent: 16.7,
        status: "Increased",
        severity: "High",
      },
      {
        id: "change-2",
        invoiceId: "invoice-b",
        invoiceDate: "2026-06-19",
        previousInvoiceDate: "2026-06-01",
        supplier: "Tea Time Co",
        itemName: "Black Tea Leaves",
        originalDescription: "Black Tea Leaves",
        rawSourceLine: "Black Tea Leaves",
        comparisonKey: "black tea leaves",
        category: "Tea",
        previousPrice: 100,
        currentPrice: 100,
        changePercent: 0,
        status: "Stable",
        severity: "Low",
      },
    ],
    unresolvedReconciliations: [
      { id: "rec-1", date: "2026-06-21", variance: 7.25, status: "Needs Review", notes: "" } as any,
    ],
    inventoryItems: [
      {
        id: "item-1",
        name: "Cup Lids",
        normalizedName: "cup lids",
        category: "Packaging",
        currentQuantity: 1,
        unit: "case",
        minQuantity: 4,
        parLevel: 8,
        preferredSupplier: "Cup & Lid Supply",
        latestPurchasePrice: 15,
        latestPurchaseUnit: "case",
        latestPurchaseConversionFactor: 1,
        lastReceivedAt: "2026-06-19",
        lastCountedAt: "2026-06-19",
        averageDailyUsage: 0.5,
        supplierMatchKey: "cup & lid supply",
        itemMatchKey: "cup lids",
        active: true,
        notes: "",
        createdAt: "2026-06-19T12:00:00.000Z",
        updatedAt: "2026-06-19T12:00:00.000Z",
      },
    ],
    inventoryReorderIntents: [],
    inventoryReceipts: [],
    summary: createSummary(),
  });

  assert.equal(model.monthToDateSpend, 400);
  assert.equal(model.monthToDateInvoiceCount, 2);
  assert.equal(model.supplierSpend[0].supplier, "Tea Time Co");
  assert.equal(model.supplierSpend[0].invoiceCount, 1);
  assert.equal(model.priceIncreaseCount, 1);
  assert.equal(model.costIncreases[0].itemName, "Tapioca Pearls");
  assert.equal(model.actionableInvoiceCount, 3);
  assert.ok(model.needsAttention.some((item) => item.title.includes("not received into inventory")));
  assert.ok(model.needsAttention.some((item) => item.title.includes("skipped for now")));
  assert.ok(model.needsAttention.some((item) => item.title.includes("low-confidence invoice rows")));
  assert.ok(model.needsAttention.some((item) => item.title.includes("price increases to review")));
  assert.ok(model.needsAttention.some((item) => item.title.includes("items need reorder")));
  assert.ok(model.needsAttention.some((item) => item.title.includes("unresolved daily closes")));
  assert.ok(model.topItems[0].itemName.includes("Black Tea Leaves"));
  assert.ok(model.topItems[1].itemName.includes("Tapioca Pearls"));
  assert.equal(model.topItems[1].totalSpend, 100);
  assert.equal(model.topItems[1].latestUnitPrice, 35);
}

function testOwnerDashboardPageRendersOwnerCopy() {
  const html = renderOwnerDashboardPage();
  assert.ok(html.includes("Owner Dashboard"));
  assert.ok(html.includes("Start here"));
  assert.ok(html.includes("Spend by supplier"));
  assert.ok(html.includes("Cost increases to review"));
  assert.ok(html.includes("Top purchased items"));
  assert.ok(html.includes("Needs attention"));
  assert.ok(html.includes("Inventory / reorder snapshot"));
  assert.ok(html.includes("Daily close snapshot"));
  assert.ok(html.includes("Load sample restaurant data"));
  assert.ok(html.includes("Open invoices"));
  assert.ok(html.includes("Open inventory"));
  assert.ok(html.includes("View daily close"));
}

testOwnerDashboardModelAggregatesSafely();
testOwnerDashboardPageRendersOwnerCopy();

console.log("owner_dashboard_ui.test.tsx passed");
