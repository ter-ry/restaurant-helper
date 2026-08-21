import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotPurchasesPage } from "../../src/pilot/PilotPurchasesPage";
import { PilotApiError } from "../../src/pilot/pilotApi";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotPurchases: vi.fn(),
  fetchPilotInventory: vi.fn(),
  createPilotSupplier: vi.fn(),
  createPilotInventoryItem: vi.fn(),
  createPilotPurchaseInvoice: vi.fn(),
  updatePilotPurchaseInvoice: vi.fn(),
  receivePilotPurchaseInvoice: vi.fn(),
  correctPilotPurchaseInvoice: vi.fn(),
  fetchPilotPurchaseInvoice: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotPurchases: pilotApiMocks.fetchPilotPurchases,
    fetchPilotInventory: pilotApiMocks.fetchPilotInventory,
    createPilotSupplier: pilotApiMocks.createPilotSupplier,
    createPilotInventoryItem: pilotApiMocks.createPilotInventoryItem,
    createPilotPurchaseInvoice: pilotApiMocks.createPilotPurchaseInvoice,
    updatePilotPurchaseInvoice: pilotApiMocks.updatePilotPurchaseInvoice,
    receivePilotPurchaseInvoice: pilotApiMocks.receivePilotPurchaseInvoice,
    correctPilotPurchaseInvoice: pilotApiMocks.correctPilotPurchaseInvoice,
    fetchPilotPurchaseInvoice: pilotApiMocks.fetchPilotPurchaseInvoice,
  };
});

function emptyPurchases() {
  return {
    invoices: [],
    suppliers: [],
    purchaseLines: [],
    priceChanges: [],
    summary: {
      thisMonthSpend: 0,
      uploadsNeedingReview: 0,
      priceChangesFlagged: 0,
      mappedItems: 0,
      exportReady: 0,
      needsMapping: 0,
    },
    exportReadiness: {
      readyForCsv: 0,
      needsReview: 0,
      needsMapping: 0,
      quickBooksFutureOnly: false,
    },
  };
}

function emptyInventory() {
  return {
    items: [],
    movements: [],
    countSessions: [],
    reorderPlan: { suggestions: [], groupedBySupplier: [] },
    summary: {},
  };
}

function createInvoice(state: TestState, payload: Record<string, unknown>) {
  const supplierName = String(payload.supplierName ?? "");
  const supplier = state.suppliers.find((entry) => entry.name === supplierName) ?? null;
  const invoice = {
    id: state.nextInvoiceId++,
    organizationId: 5,
    locationId: 9,
    supplierId: supplier?.id ?? 0,
    supplier,
    invoiceNumber: String(payload.invoiceNumber ?? "FP-1000"),
    invoiceDate: String(payload.invoiceDate ?? "2026-08-18"),
    subtotal: Number(payload.subtotal ?? 0),
    tax: Number(payload.tax ?? 0),
    totalAmount: Number(payload.totalAmount ?? 0),
    notes: String(payload.notes ?? ""),
    status: String(payload.status ?? "Draft"),
    sourceFileName: String(payload.sourceFileName ?? ""),
    sourceFileType: String(payload.sourceFileType ?? ""),
    sourceFileKey: "",
    extractedText: String(payload.extractedText ?? ""),
    extractionStatus: String(payload.extractionStatus ?? "manual"),
    receivedAt: null,
    receivedByUserId: null,
    createdByUserId: 1,
    updatedByUserId: 1,
    postedAt: null,
    lineItems: (Array.isArray(payload.lineItems) ? payload.lineItems : []).map((line: any, index: number) => ({
      id: state.nextLineId++,
      invoiceId: state.nextInvoiceId - 1,
      supplierName,
      invoiceNumber: String(payload.invoiceNumber ?? "FP-1000"),
      invoiceDate: String(payload.invoiceDate ?? "2026-08-18"),
      inventoryItemId: line.inventoryItemId ?? null,
      supplierItemMappingId: null,
      lineIndex: index,
      description: String(line.description ?? ""),
      normalizedDescription: String(line.description ?? "").trim().toLowerCase(),
      purchaseUnit: String(line.purchaseUnit ?? "each"),
      inventoryUnit: String(line.inventoryUnit ?? "each"),
      conversionFactor: Number(line.conversionFactor ?? 1),
      quantity: Number(line.quantity ?? 1),
      unitPrice: Number(line.unitPrice ?? 0),
      lineTotal: Number(line.lineTotal ?? 0),
      confidence: Number(line.confidence ?? 0.5),
      needsReview: Boolean(line.needsReview ?? true),
      previousUnitPrice: null,
      priceChangePercent: null,
      note: String(line.note ?? ""),
      createdAt: null,
      updatedAt: null,
    })),
    createdAt: null,
    updatedAt: null,
  };

  state.invoices = [invoice, ...state.invoices.filter((entry) => entry.id !== invoice.id)];
  return invoice;
}

type TestState = {
  suppliers: Array<{ id: number; name: string; categoryFocus: string }>;
  inventoryItems: Array<{ id: number; name: string; stockUnit: string }>;
  invoices: Array<any>;
  nextSupplierId: number;
  nextItemId: number;
  nextInvoiceId: number;
  nextLineId: number;
};

beforeEach(() => {
  vi.clearAllMocks();
  const state: TestState = {
    suppliers: [],
    inventoryItems: [],
    invoices: [],
    nextSupplierId: 20,
    nextItemId: 30,
    nextInvoiceId: 100,
    nextLineId: 1,
  };

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });

  const nextPurchases = () => ({
    ...emptyPurchases(),
    invoices: state.invoices,
    suppliers: state.suppliers.map((supplier) => ({
      id: supplier.id,
      organizationId: 5,
      name: supplier.name,
      normalizedName: supplier.name.trim().toLowerCase(),
      categoryFocus: supplier.categoryFocus,
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      orderingNotes: "",
      notes: "",
      isActive: true,
      inventoryItemCount: 0,
      purchaseInvoiceCount: 0,
      supplierItemMappingCount: 0,
      latestInvoiceDate: null,
      historicalReferenceCount: 0,
      recentInvoices: [],
      recentMappings: [],
    })),
    purchaseLines: state.invoices.flatMap((invoice) => invoice.lineItems),
    summary: {
      thisMonthSpend: 0,
      uploadsNeedingReview: 0,
      priceChangesFlagged: 0,
      mappedItems: state.invoices.flatMap((invoice) => invoice.lineItems).filter((line) => line.inventoryItemId).length,
      exportReady: state.invoices.length,
      needsMapping: state.invoices.flatMap((invoice) => invoice.lineItems).filter((line) => !line.inventoryItemId).length,
    },
  });

  pilotApiMocks.fetchPilotPurchases.mockImplementation(async () => nextPurchases());
  pilotApiMocks.fetchPilotInventory.mockImplementation(async () => ({
    ...emptyInventory(),
    items: state.inventoryItems.map((item) => ({
      id: item.id,
      organizationId: 5,
      locationId: 9,
      supplierId: null,
      name: item.name,
      normalizedName: item.name.trim().toLowerCase(),
      category: "Other",
      stockUnit: item.stockUnit,
      currentOnHand: 0,
      minQuantity: 0,
      parLevel: 0,
      preferredSupplierName: "",
      latestPurchasePrice: 0,
      lastPurchaseUnit: item.stockUnit,
      lastPurchaseConversionFactor: 1,
      lastReceivedAt: null,
      lastCountedAt: null,
      averageDailyUsage: null,
      estimatedCostMethod: "latest_purchase_price",
      active: true,
      notes: "",
      createdByUserId: 1,
      updatedByUserId: 1,
      createdAt: null,
      updatedAt: null,
    })),
  }));
  pilotApiMocks.createPilotSupplier.mockImplementation(async (payload: Record<string, unknown>) => {
    const supplier = {
      id: state.nextSupplierId++,
      name: String(payload.name ?? ""),
      categoryFocus: String(payload.categoryFocus ?? "Other"),
    };
    state.suppliers = [...state.suppliers, supplier];
    return {
      ...supplier,
      organizationId: 5,
      normalizedName: supplier.name.trim().toLowerCase(),
      contactName: String(payload.contactName ?? ""),
      contactPhone: String(payload.contactPhone ?? ""),
      contactEmail: String(payload.contactEmail ?? ""),
      orderingNotes: String(payload.orderingNotes ?? ""),
      notes: String(payload.notes ?? ""),
      isActive: true,
      inventoryItemCount: 0,
      purchaseInvoiceCount: 0,
      supplierItemMappingCount: 0,
      latestInvoiceDate: null,
      historicalReferenceCount: 0,
      recentInvoices: [],
      recentMappings: [],
    };
  });
  pilotApiMocks.createPilotInventoryItem.mockImplementation(async (payload: Record<string, unknown>) => {
    const item = {
      id: state.nextItemId++,
      name: String(payload.name ?? ""),
      stockUnit: String(payload.stockUnit ?? "each"),
    };
    state.inventoryItems = [...state.inventoryItems, item];
    return {
      id: item.id,
      organizationId: 5,
      locationId: 9,
      supplierId: null,
      name: item.name,
      normalizedName: item.name.trim().toLowerCase(),
      category: String(payload.category ?? "Other"),
      stockUnit: item.stockUnit,
      currentOnHand: Number(payload.currentOnHand ?? 0),
      minQuantity: Number(payload.minQuantity ?? 0),
      parLevel: Number(payload.parLevel ?? 0),
      preferredSupplierName: String(payload.preferredSupplierName ?? ""),
      latestPurchasePrice: Number(payload.latestPurchasePrice ?? 0),
      lastPurchaseUnit: String(payload.lastPurchaseUnit ?? "each"),
      lastPurchaseConversionFactor: Number(payload.lastPurchaseConversionFactor ?? 1),
      lastReceivedAt: null,
      lastCountedAt: null,
      averageDailyUsage: null,
      estimatedCostMethod: "latest_purchase_price",
      active: Boolean(payload.active ?? true),
      notes: String(payload.notes ?? ""),
      createdByUserId: 1,
      updatedByUserId: 1,
      createdAt: null,
      updatedAt: null,
    };
  });
  pilotApiMocks.createPilotPurchaseInvoice.mockImplementation(async (payload: Record<string, unknown>) => createInvoice(state, payload));
  pilotApiMocks.updatePilotPurchaseInvoice.mockImplementation(async (_id: number, payload: Record<string, unknown>) => createInvoice(state, payload));
  pilotApiMocks.receivePilotPurchaseInvoice.mockImplementation(async (invoiceId: number) => ({
    ...(state.invoices.find((invoice) => invoice.id === invoiceId) ?? state.invoices[0]),
    status: "Completed",
    receivedAt: new Date().toISOString(),
  }));
  pilotApiMocks.correctPilotPurchaseInvoice.mockResolvedValue({
    id: 999,
    organizationId: 5,
    locationId: 9,
    supplierId: 0,
    supplier: null,
    invoiceNumber: "FP-9999",
    invoiceDate: "2026-08-18",
    subtotal: 0,
    tax: 0,
    totalAmount: 0,
    notes: "",
    status: "Corrected",
    sourceFileName: "",
    sourceFileType: "manual",
    sourceFileKey: "",
    extractedText: "",
    extractionStatus: "manual",
    receivedAt: null,
    receivedByUserId: null,
    createdByUserId: 1,
    updatedByUserId: 1,
    postedAt: null,
    lineItems: [],
    createdAt: null,
    updatedAt: null,
  });
  pilotApiMocks.fetchPilotPurchaseInvoice.mockImplementation(async (id: number) => state.invoices.find((invoice) => invoice.id === id) ?? state.invoices[0]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

describe("PilotPurchasesPage", () => {
  it("keeps unsaved purchase lines independent while supporting inline supplier and inventory creation", async () => {
    render(
      <MemoryRouter initialEntries={["/app/purchases"]}>
        <PilotPurchasesPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Capture invoices, confirm items, and move stock" });

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const editorCard = screen.getByTestId("purchase-editor-card");
    const historyCard = screen.getByTestId("purchase-history-card");
    expect(editorCard).toBeVisible();
    expect(historyCard).toBeVisible();
    expect(within(editorCard).getByRole("heading", { name: "New purchase" })).toBeVisible();
    expect(within(historyCard).getByRole("heading", { name: "Review queue and purchase history" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Review queue and purchase history" })).toHaveLength(1);
    expect(within(editorCard).getByText("Supplier")).toBeVisible();
    expect(within(editorCard).getByLabelText("Invoice number")).toBeVisible();
    expect(within(historyCard).queryByLabelText("Supplier")).not.toBeInTheDocument();
    expect(within(historyCard).queryByLabelText("Invoice number")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New purchase" }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    expect(screen.getByTestId("purchase-mutation-toast")).toHaveClass("fixed", "bottom-4");
    expect(screen.getByLabelText("Supplier name")).toBeVisible();
    await waitFor(() => expect(screen.getAllByTestId("purchase-line-card")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Blank draft" }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));

    const supplierNameInput = await screen.findByPlaceholderText("Enter supplier name");
    fireEvent.change(supplierNameInput, { target: { value: "North Bay Dairy" } });
    fireEvent.click(screen.getByRole("button", { name: "Create supplier" }));
    await waitFor(() => expect(pilotApiMocks.createPilotSupplier).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.getElementById("purchase-supplier")).toHaveValue("North Bay Dairy"));

    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    await waitFor(() => expect(screen.getAllByTestId("purchase-line-card")).toHaveLength(2));

    const [firstLine, secondLine] = screen.getAllByTestId("purchase-line-card");
    fireEvent.change(within(firstLine).getByLabelText("Description"), { target: { value: "2% Milk" } });
    fireEvent.change(within(secondLine).getByLabelText("Description"), { target: { value: "Whole Milk" } });

    fireEvent.click(within(firstLine).getByRole("button", { name: "Create inventory item" }));
    await waitFor(() => expect(within(firstLine).getByText("Create inventory item from this line")).toBeVisible());
    expect(within(firstLine).getByLabelText("Item name")).toHaveValue("2% Milk");

    fireEvent.click(within(firstLine).getByRole("button", { name: "Create and map item" }));
    await waitFor(() => expect(pilotApiMocks.createPilotInventoryItem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(firstLine).getByLabelText("Inventory item")).toHaveValue("30"));
    expect(within(secondLine).getByLabelText("Inventory item")).toHaveValue("");

    fireEvent.click(within(secondLine).getByRole("button", { name: "Create inventory item" }));
    await waitFor(() => expect(within(secondLine).getByText("Create inventory item from this line")).toBeVisible());
    expect(within(secondLine).getByLabelText("Item name")).toHaveValue("Whole Milk");
    fireEvent.click(within(secondLine).getByRole("button", { name: "Create and map item" }));
    await waitFor(() => expect(pilotApiMocks.createPilotInventoryItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(firstLine).getByLabelText("Inventory item")).toHaveValue("30"));
    await waitFor(() => expect(within(secondLine).getByLabelText("Inventory item")).toHaveValue("31"));

    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    await waitFor(() => expect(screen.getAllByTestId("purchase-line-card")).toHaveLength(3));
    const thirdLine = screen.getAllByTestId("purchase-line-card")[2];
    fireEvent.click(within(thirdLine).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getAllByTestId("purchase-line-card")).toHaveLength(2));
    const [afterFirstLine, afterSecondLine] = screen.getAllByTestId("purchase-line-card");
    expect(within(afterFirstLine).getByLabelText("Inventory item")).toHaveValue("30");
    expect(within(afterSecondLine).getByLabelText("Inventory item")).toHaveValue("31");

    const firstLineFields = within(afterFirstLine).getAllByRole("spinbutton");
    fireEvent.change(firstLineFields[0], { target: { value: "2" } });
    fireEvent.change(firstLineFields[1], { target: { value: "2" } });
    fireEvent.change(firstLineFields[2], { target: { value: "4.5" } });
    fireEvent.change(firstLineFields[3], { target: { value: "9" } });

    const secondLineFields = within(afterSecondLine).getAllByRole("spinbutton");
    fireEvent.change(secondLineFields[0], { target: { value: "1" } });
    fireEvent.change(secondLineFields[1], { target: { value: "3" } });
    fireEvent.change(secondLineFields[2], { target: { value: "2" } });
    fireEvent.change(secondLineFields[3], { target: { value: "6" } });

    fireEvent.click(screen.getByRole("button", { name: "Save ready" }));
    await waitFor(() => expect(pilotApiMocks.createPilotPurchaseInvoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Receive into inventory" })).toBeEnabled());
  });

  it("saves dirty purchase edits before receiving and preserves the mapped invoice", async () => {
    const invoice = {
      id: 1,
      organizationId: 5,
      locationId: 9,
      supplierId: 20,
      supplier: {
        id: 20,
        organizationId: 5,
        name: "Test Food Supplier",
        normalizedName: "test food supplier",
        categoryFocus: "Dairy",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        orderingNotes: "",
        notes: "",
        isActive: true,
        inventoryItemCount: 0,
        purchaseInvoiceCount: 0,
        supplierItemMappingCount: 0,
        latestInvoiceDate: null,
        historicalReferenceCount: 0,
        recentInvoices: [],
        recentMappings: [],
      },
      invoiceNumber: "TEST-001",
      invoiceDate: "2026-08-18",
      subtotal: 20,
      tax: 2.6,
      totalAmount: 22.6,
      notes: "Initial notes",
      status: "Ready",
      sourceFileName: "",
      sourceFileType: "",
      sourceFileKey: "",
      extractedText: "",
      extractionStatus: "manual",
      receivedAt: null,
      receivedByUserId: null,
      createdByUserId: 1,
      updatedByUserId: 1,
      postedAt: null,
      lineItems: [
        {
          id: 1,
          invoiceId: 1,
          supplierName: "Test Food Supplier",
          invoiceNumber: "TEST-001",
          invoiceDate: "2026-08-18",
          inventoryItemId: 30,
          supplierItemMappingId: null,
          lineIndex: 0,
          description: "Chicken Breast",
          normalizedDescription: "chicken breast",
          purchaseUnit: "case",
          inventoryUnit: "case",
          conversionFactor: 1,
          quantity: 2,
          unitPrice: 10,
          lineTotal: 20,
          confidence: 0.99,
          needsReview: false,
          previousUnitPrice: null,
          priceChangePercent: null,
          note: "",
          createdAt: null,
          updatedAt: null,
        },
      ],
      createdAt: null,
      updatedAt: null,
    };

    pilotApiMocks.fetchPilotPurchases.mockResolvedValueOnce({
      ...emptyPurchases(),
      invoices: [invoice],
      suppliers: [invoice.supplier],
      purchaseLines: invoice.lineItems,
      summary: {
        thisMonthSpend: 22.6,
        uploadsNeedingReview: 0,
        priceChangesFlagged: 0,
        mappedItems: 1,
        exportReady: 1,
        needsMapping: 0,
      },
    });
    pilotApiMocks.fetchPilotInventory.mockResolvedValueOnce({
      ...emptyInventory(),
      items: [
        {
          id: 30,
          organizationId: 5,
          locationId: 9,
          supplierId: null,
          name: "Chicken Breast",
          normalizedName: "chicken breast",
          category: "Poultry",
          stockUnit: "case",
          currentOnHand: 0,
          minQuantity: 0,
          parLevel: 0,
          preferredSupplierName: "Test Food Supplier",
          latestPurchasePrice: 10,
          lastPurchaseUnit: "case",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: null,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
      ],
    });

    pilotApiMocks.updatePilotPurchaseInvoice.mockImplementation(async (_id: number, payload: Record<string, unknown>) => ({
      ...invoice,
      notes: String(payload.notes ?? invoice.notes),
      status: String(payload.status ?? invoice.status),
    }));
    pilotApiMocks.receivePilotPurchaseInvoice.mockImplementation(async (invoiceId: number) => ({
      ...invoice,
      id: invoiceId,
      status: "Completed",
      receivedAt: new Date().toISOString(),
    }));

    render(
      <MemoryRouter initialEntries={["/app/purchases"]}>
        <PilotPurchasesPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Capture invoices, confirm items, and move stock" });
    const editorCard = screen.getByTestId("purchase-editor-card");
    fireEvent.change(within(editorCard).getByLabelText("Notes"), { target: { value: "Updated before receiving" } });

    fireEvent.click(screen.getByRole("button", { name: /receive/i }));
    await waitFor(() => expect(pilotApiMocks.updatePilotPurchaseInvoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pilotApiMocks.receivePilotPurchaseInvoice).toHaveBeenCalledTimes(1));
    expect((pilotApiMocks.updatePilotPurchaseInvoice as any).mock.invocationCallOrder[0]).toBeLessThan(
      (pilotApiMocks.receivePilotPurchaseInvoice as any).mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(screen.getByTestId("purchase-mutation-toast").textContent).toContain("Purchase received"));
  });

  it("shows field-level validation errors for supplier and inventory creation without losing the draft", async () => {
    let supplierNameInput: HTMLInputElement;
    render(
      <MemoryRouter initialEntries={["/app/purchases"]}>
        <PilotPurchasesPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Capture invoices, confirm items, and move stock" });
    fireEvent.click(screen.getByRole("button", { name: "New purchase" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "New purchase" })).toBeInTheDocument());

    supplierNameInput = await screen.findByPlaceholderText("Enter supplier name");
    fireEvent.change(supplierNameInput, { target: { value: "North Bay Dairy" } });
    pilotApiMocks.createPilotSupplier.mockRejectedValueOnce(new PilotApiError("Validation failed.", 400, { name: "Supplier name is required." }));
    fireEvent.click(screen.getByRole("button", { name: "Create supplier" }));

    await waitFor(() => expect(screen.getByText("Supplier name is required.")).toBeVisible());
    expect(supplierNameInput).toHaveAttribute("aria-invalid", "true");
    expect(supplierNameInput).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Create supplier" }));
    await waitFor(() => expect(document.getElementById("purchase-supplier")).toHaveValue("North Bay Dairy"));

    fireEvent.click(screen.getByRole("button", { name: "Add line" }));
    const lineCard = screen.getAllByTestId("purchase-line-card")[1];
    fireEvent.change(within(lineCard).getByLabelText("Description"), { target: { value: "2% Milk" } });
    fireEvent.click(within(lineCard).getByRole("button", { name: "Create inventory item" }));
    await waitFor(() => expect(within(lineCard).getByText("Create inventory item from this line")).toBeVisible());

    const itemNameInput = within(lineCard).getByText("Item name").parentElement?.querySelector("input") as HTMLInputElement;
    fireEvent.change(itemNameInput, { target: { value: "2% Milk" } });
    pilotApiMocks.createPilotInventoryItem.mockRejectedValueOnce(new PilotApiError("Validation failed.", 400, { name: "Inventory item name is required." }));
    fireEvent.click(within(lineCard).getByRole("button", { name: "Create and map item" }));

    await waitFor(() => expect(within(lineCard).getByText("Inventory item name is required.")).toBeVisible());
    expect(itemNameInput).toHaveAttribute("aria-invalid", "true");
  });

  it("shows purchase save validation errors inline and focuses the first invalid field", async () => {
    pilotApiMocks.fetchPilotPurchases.mockResolvedValueOnce({
      ...emptyPurchases(),
      suppliers: [
        {
          id: 20,
          organizationId: 5,
          name: "North Bay Dairy",
          normalizedName: "north bay dairy",
          categoryFocus: "Dairy",
          contactName: "",
          contactPhone: "",
          contactEmail: "",
          orderingNotes: "",
          notes: "",
          isActive: true,
          inventoryItemCount: 0,
          purchaseInvoiceCount: 0,
          supplierItemMappingCount: 0,
          latestInvoiceDate: null,
          historicalReferenceCount: 0,
          recentInvoices: [],
          recentMappings: [],
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/app/purchases"]}>
        <PilotPurchasesPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Capture invoices, confirm items, and move stock" });
    fireEvent.click(screen.getByRole("button", { name: "New purchase" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "New purchase" })).toBeInTheDocument());

    fireEvent.change(document.getElementById("purchase-supplier") as HTMLSelectElement, { target: { value: "North Bay Dairy" } });
    const invoiceNumberInput = await screen.findByText("Invoice number").then((label) => {
      const input = label.parentElement?.querySelector("input");
      if (!input) {
        throw new Error("Invoice number input not found.");
      }
      return input as HTMLInputElement;
    });
    fireEvent.change(invoiceNumberInput, { target: { value: "" } });
    pilotApiMocks.createPilotPurchaseInvoice.mockRejectedValueOnce(new PilotApiError("Validation failed.", 400, { invoiceNumber: "Invoice number is required." }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByTestId("purchase-validation-errors")).toBeVisible());
    expect(invoiceNumberInput).toHaveAttribute("aria-invalid", "true");
    expect(invoiceNumberInput).toHaveFocus();
  });
});
