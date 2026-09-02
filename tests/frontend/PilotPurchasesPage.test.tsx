import React from "react";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotPurchasesPage } from "../../src/pilot/PilotPurchasesPage";
import { PilotApiError, type PilotInventoryItem, type PilotPurchaseInvoice, type PilotPurchasesResponse } from "../../src/pilot/pilotApi";

const mockApi = vi.hoisted(() => ({
  fetchPilotPurchases: vi.fn(),
  fetchPilotInventory: vi.fn(),
  fetchPilotPurchaseInvoice: vi.fn(),
  createPilotPurchaseInvoice: vi.fn(),
  updatePilotPurchaseInvoice: vi.fn(),
  receivePilotPurchaseInvoice: vi.fn(),
  correctPilotPurchaseInvoice: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return {
    ...actual,
    fetchPilotPurchases: mockApi.fetchPilotPurchases,
    fetchPilotInventory: mockApi.fetchPilotInventory,
    fetchPilotPurchaseInvoice: mockApi.fetchPilotPurchaseInvoice,
    createPilotPurchaseInvoice: mockApi.createPilotPurchaseInvoice,
    updatePilotPurchaseInvoice: mockApi.updatePilotPurchaseInvoice,
    receivePilotPurchaseInvoice: mockApi.receivePilotPurchaseInvoice,
    correctPilotPurchaseInvoice: mockApi.correctPilotPurchaseInvoice,
  };
});

function createLine(overrides: Partial<PilotPurchaseInvoice["lineItems"][number]> = {}) {
  return {
    id: 11,
    invoiceId: 2,
    supplierName: "Fresh Dairy Toronto",
    invoiceNumber: "FD-2201",
    invoiceDate: "2026-08-20",
    inventoryItemId: 301,
    supplierItemMappingId: 401,
    lineIndex: 0,
    description: "Milk 2L",
    normalizedDescription: "milk 2l",
    purchaseUnit: "case",
    inventoryUnit: "carton",
    conversionFactor: 6,
    quantity: 2,
    unitPrice: 24,
    lineTotal: 48,
    confidence: 0.97,
    needsReview: false,
    previousUnitPrice: 22,
    priceChangePercent: 9.1,
    note: "",
    createdAt: "2026-08-20T10:15:00.000Z",
    updatedAt: "2026-08-20T10:15:00.000Z",
    ...overrides,
  };
}

function createInvoice(
  overrides: Partial<PilotPurchaseInvoice> & { id: number; invoiceNumber: string; status: string; supplierName: string },
): PilotPurchaseInvoice {
  const { id, invoiceNumber, status, supplierName, ...rest } = overrides;
  return {
    ...rest,
    id,
    organizationId: 42,
    locationId: 7,
    supplierId: id * 10,
    supplier: {
      id: id * 10,
      organizationId: 42,
      name: supplierName,
      normalizedName: supplierName.toLowerCase(),
      categoryFocus: "Dairy",
      contactName: "Alex",
      contactPhone: "416-555-0101",
      contactEmail: "alex@example.com",
      orderingNotes: "",
      notes: "",
      isActive: true,
      createdAt: "2026-08-20T09:00:00.000Z",
      updatedAt: "2026-08-20T09:00:00.000Z",
    },
    invoiceNumber,
    invoiceDate: "2026-08-20",
    subtotal: 48,
    tax: 6.24,
    totalAmount: 54.24,
    notes: "Pilot purchase",
    status,
    sourceFileName: "invoice.pdf",
    sourceFileType: "application/pdf",
    sourceFileKey: "file-key",
    extractedText: "Milk and cream purchase",
    extractionStatus: "ocr",
    receivedAt: status === "Completed" ? "2026-08-20T10:30:00.000Z" : null,
    receivedByUserId: status === "Completed" ? 9 : null,
    createdByUserId: 7,
    updatedByUserId: 7,
    postedAt: status === "Completed" ? "2026-08-20T10:45:00.000Z" : null,
    lineItems: [createLine()],
    createdAt: "2026-08-20T10:10:00.000Z",
    updatedAt: "2026-08-20T10:20:00.000Z",
  };
}

function createPurchasesResponse(): PilotPurchasesResponse {
  const completedInvoice = createInvoice({
    id: 1,
    invoiceNumber: "FD-1001",
    status: "Completed",
    supplierName: "Heritage Dairy",
  });
  const draftInvoice = createInvoice({
    id: 2,
    invoiceNumber: "FD-1002",
    status: "Draft",
    supplierName: "Fresh Dairy Toronto",
  });
  return {
    invoices: [completedInvoice, draftInvoice],
    suppliers: [completedInvoice.supplier!, draftInvoice.supplier!],
    purchaseLines: draftInvoice.lineItems.map((line) => ({ ...line, invoiceId: draftInvoice.id })),
    priceChanges: [],
    summary: {
      thisMonthSpend: 102.48,
      uploadsNeedingReview: 1,
      priceChangesFlagged: 0,
      mappedItems: 1,
      exportReady: 1,
    },
    exportReadiness: {
      readyForCsv: 1,
      needsReview: 0,
      needsMapping: 0,
      quickBooksFutureOnly: false,
    },
  };
}

function createInventoryResponse(): { items: PilotInventoryItem[] } {
  return {
    items: [
      {
        id: 301,
        organizationId: 42,
        locationId: 7,
        supplierId: null,
        name: "Milk 2L",
        normalizedName: "milk 2l",
        category: "Dairy",
        stockUnit: "carton",
        currentOnHand: 8,
        minQuantity: 3,
        parLevel: 12,
        preferredSupplierName: "Fresh Dairy Toronto",
        latestPurchasePrice: 24,
        lastPurchaseUnit: "case",
        lastPurchaseConversionFactor: 6,
        lastReceivedAt: "2026-08-20T10:30:00.000Z",
        lastCountedAt: "2026-08-18T10:30:00.000Z",
        averageDailyUsage: 1.2,
        estimatedCostMethod: "latest_purchase_price",
        active: true,
        notes: "",
        createdByUserId: 7,
        updatedByUserId: 7,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:20:00.000Z",
      },
    ],
  };
}

function renderPage(path = "/app/purchases") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PilotPurchasesPage />
    </MemoryRouter>,
  );
}

describe("PilotPurchasesPage", () => {
  beforeEach(() => {
    mockApi.fetchPilotPurchases.mockResolvedValue(createPurchasesResponse());
    mockApi.fetchPilotInventory.mockResolvedValue(createInventoryResponse());
    mockApi.fetchPilotPurchaseInvoice.mockImplementation(async (invoiceId: number) => {
      const response = createPurchasesResponse();
      const invoice = response.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }
      return invoice;
    });
    mockApi.receivePilotPurchaseInvoice.mockImplementation(async (invoiceId: number) => {
      const response = createPurchasesResponse();
      const invoice = response.invoices.find((entry) => entry.id === invoiceId);
      if (!invoice) {
        throw new Error("Invoice not found");
      }
      return { ...invoice, status: "Completed", receivedAt: "2026-08-20T10:30:00.000Z" };
    });
    mockApi.createPilotPurchaseInvoice.mockImplementation(async (payload) => ({
      ...createInvoice({ id: 3, invoiceNumber: payload.invoiceNumber, status: payload.status || "Draft", supplierName: payload.supplierName }),
      ...payload,
      id: 3,
    }));
    mockApi.updatePilotPurchaseInvoice.mockImplementation(async (_invoiceId, payload) => ({
      ...createInvoice({ id: 2, invoiceNumber: payload.invoiceNumber, status: payload.status || "Draft", supplierName: payload.supplierName }),
      ...payload,
      id: 2,
    }));
    mockApi.correctPilotPurchaseInvoice.mockResolvedValue(createInvoice({ id: 1, invoiceNumber: "FD-1001", status: "Corrected", supplierName: "Heritage Dairy" }));
  });

  it("starts on a blank new purchase even when historical completed invoices exist", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "New purchase" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Details" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Invoice items" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Review" })).toBeVisible();
    const editor = screen.getByTestId("purchase-editor-card");
    expect(within(editor).queryByText("FD-1001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Supplier")).toHaveValue("");
    expect(screen.getByLabelText("Invoice number")).toHaveValue("");
    expect(screen.getByTestId("purchase-history-card")).toBeVisible();
    expect(screen.getByTestId("purchase-details-panel")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("creates a mapped invoice with a blank invoice number and readable transaction fields", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "New purchase" });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "Fresh Dairy Toronto" } });
    fireEvent.click(screen.getByRole("tab", { name: "Invoice items" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Milk 2L" } });
    fireEvent.change(screen.getByLabelText("Inventory item"), { target: { value: "301" } });

    const quantity = screen.getByLabelText("Quantity");
    const unitPrice = screen.getByLabelText("Unit price");
    expect(quantity).toHaveAttribute("step", "0.0001");
    expect(unitPrice).toHaveAttribute("step", "0.01");
    fireEvent.change(quantity, { target: { value: "10" } });
    fireEvent.change(unitPrice, { target: { value: "12" } });
    expect(screen.getByLabelText("Line total")).toHaveValue(120);
    expect(screen.getByText("Confirmed")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(mockApi.createPilotPurchaseInvoice).toHaveBeenCalledTimes(1));
    const payload = mockApi.createPilotPurchaseInvoice.mock.calls[0][0];
    expect(payload.invoiceNumber).toBe("");
    expect(payload.subtotal).toBe(120);
    expect(payload.totalAmount).toBe(120);
    expect(payload.lineItems[0]).toMatchObject({ quantity: 10, unitPrice: 12, lineTotal: 120, inventoryItemId: 301, needsReview: false });
    expect(await screen.findByText(/Invoice\s+saved successfully\./)).toBeVisible();
  });

  it("surfaces structured invoice validation details", async () => {
    mockApi.createPilotPurchaseInvoice.mockRejectedValueOnce(new PilotApiError("Invoice validation failed.", 400, { supplierName: "Supplier is required." }));
    renderPage();

    await screen.findByRole("heading", { name: "New purchase" });
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText(/Supplier is required\./)).toBeVisible();
  });

  it("moves a draft invoice through details, lines, and review tabs", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "New purchase" });
    fireEvent.click(screen.getByRole("button", { name: /FD-1002/ }));

    expect(await screen.findByRole("heading", { name: "Review FD-1002" })).toBeVisible();
    expect(screen.getByTestId("purchase-details-panel")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Invoice items" }));
    expect(await screen.findByTestId("purchase-lines-panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add item" })).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(await screen.findByTestId("purchase-review-panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save ready" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Receive into inventory" })).toBeVisible();
  });

  it("opens completed invoice history in a read-only detail modal", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "New purchase" });
    fireEvent.click(screen.getByRole("button", { name: /FD-1001/ }));

    expect(await screen.findByTestId("purchase-detail-modal")).toBeVisible();
    expect(screen.getByText("Read-only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive into inventory" })).not.toBeInTheDocument();
  });

  it("opens an explicit draft invoiceId in the editable purchase editor", async () => {
    renderPage("/app/purchases?invoiceId=2");

    expect(await screen.findByRole("heading", { name: "Review FD-1002" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(await screen.findByTestId("purchase-review-panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Receive into inventory" })).toBeVisible();
    expect(screen.queryByTestId("purchase-detail-modal")).not.toBeInTheDocument();
  });

  it("opens an explicit completed invoiceId in the read-only detail modal", async () => {
    renderPage("/app/purchases?invoiceId=1");

    expect(await screen.findByTestId("purchase-detail-modal")).toBeVisible();
    expect(screen.getByText("Read-only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive into inventory" })).not.toBeInTheDocument();
  });

  it("resets to a blank draft after receiving a purchase", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "New purchase" });
    fireEvent.click(screen.getByRole("button", { name: /FD-1002/ }));
    expect(await screen.findByRole("heading", { name: "Review FD-1002" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Receive into inventory" }));

    expect(await screen.findByText("Invoice FD-1002 received into inventory.")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("heading", { name: "New purchase" })).toBeVisible());
    expect(screen.getByLabelText("Supplier")).toHaveValue("");
    expect(screen.getByLabelText("Invoice number")).toHaveValue("");
    expect(screen.getByTestId("purchase-details-panel")).toBeVisible();
    const editor = screen.getByTestId("purchase-editor-card");
    expect(within(editor).queryByText("FD-1002")).not.toBeInTheDocument();
    expect(screen.queryByTestId("purchase-detail-modal")).not.toBeInTheDocument();
  });
});
