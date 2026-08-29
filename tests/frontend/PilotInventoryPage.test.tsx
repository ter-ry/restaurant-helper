import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotInventoryPage } from "../../src/pilot/PilotInventoryPage";

const inventoryMocks = vi.hoisted(() => ({
  fetchPilotInventory: vi.fn(),
  fetchPilotInventoryItem: vi.fn(),
  fetchPilotSuppliers: vi.fn(),
  createPilotInventoryItem: vi.fn(),
  updatePilotInventoryItem: vi.fn(),
  createPilotInventoryAdjustment: vi.fn(),
  createPilotSupplier: vi.fn(),
  updatePilotSupplier: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    currentLocation: { id: 7, name: "Line Kitchen" },
    organization: { id: 42, name: "Inventory Cafe" },
  }),
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotInventory: inventoryMocks.fetchPilotInventory,
    fetchPilotInventoryItem: inventoryMocks.fetchPilotInventoryItem,
    fetchPilotSuppliers: inventoryMocks.fetchPilotSuppliers,
    createPilotInventoryItem: inventoryMocks.createPilotInventoryItem,
    updatePilotInventoryItem: inventoryMocks.updatePilotInventoryItem,
    createPilotInventoryAdjustment: inventoryMocks.createPilotInventoryAdjustment,
    createPilotSupplier: inventoryMocks.createPilotSupplier,
    updatePilotSupplier: inventoryMocks.updatePilotSupplier,
  };
});

describe("PilotInventoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inventoryMocks.fetchPilotInventory.mockResolvedValue({
      items: [
        {
          id: 30,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Chicken Breast",
          normalizedName: "chicken breast",
          category: "Poultry",
          stockUnit: "kg",
          currentOnHand: 3.3,
          minQuantity: 1,
          parLevel: 5,
          preferredSupplierName: "Dairy Co",
          latestPurchasePrice: 7,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: 0.8,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
        {
          id: 31,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Tomatoes",
          normalizedName: "tomatoes",
          category: "Produce",
          stockUnit: "kg",
          currentOnHand: 12,
          minQuantity: 4,
          parLevel: 10,
          preferredSupplierName: "Fresh Co",
          latestPurchasePrice: 3,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: 1.5,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
      ],
      movements: [],
      countSessions: [],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {
        inventoryItemCount: 2,
        inventoryOutOfStockCount: 0,
        inventoryReorderNowCount: 1,
        inventoryLowStockCount: 1,
        inventoryValue: 63.6,
      },
    });
    inventoryMocks.fetchPilotSuppliers.mockResolvedValue({
      suppliers: [
        {
          id: 11,
          name: "Dairy Co",
          categoryFocus: "Dairy",
          contactName: "",
          contactPhone: "",
          contactEmail: "",
          orderingNotes: "",
          notes: "",
          isActive: true,
          inventoryItemCount: 1,
          purchaseInvoiceCount: 2,
          supplierItemMappingCount: 0,
          latestInvoiceDate: "2026-08-26",
          historicalReferenceCount: 2,
          recentInvoices: [],
          recentMappings: [],
        },
      ],
    });
    inventoryMocks.fetchPilotInventoryItem.mockResolvedValue({
      id: 30,
      purchaseHistory: [
        {
          id: 1,
          invoiceNumber: "HB-1001",
          supplierName: "Dairy Co",
          invoiceDate: "2026-08-26",
          lineTotal: 21,
          description: "Chicken Breast",
          quantity: 3,
          purchaseUnit: "kg",
        },
      ],
      movementHistory: [
        {
          id: 1,
          sourceType: "purchase",
          quantityDelta: 3,
          unit: "kg",
          reason: "Initial receipt",
        },
      ],
      supplierMappings: [
        {
          id: 1,
          supplierItemName: "Chicken Breast",
          purchaseUnit: "kg",
          inventoryUnit: "kg",
          conversionFactor: 1,
          lastSeenAt: "2026-08-26",
        },
      ],
    });
  });

  it("starts in browse mode and opens a deliberate item editor", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Latest cost" })).toBeVisible();
    expect(screen.queryByText("Select an item or create one deliberately")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Item name")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "New item" })[0]);
    expect(screen.getByText("Create inventory item")).toBeVisible();
    expect(screen.getByLabelText("Item name")).toHaveValue("");
    expect(screen.getByLabelText("Current on hand")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("Latest price")).not.toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());
    expect(screen.getByLabelText("Item name")).toHaveValue("Chicken Breast");
    expect(screen.getByLabelText("Current on hand")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Latest price")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Last purchase unit")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Purchase conversion")).toHaveAttribute("readonly");
    expect(screen.getByText("Initial receipt")).toBeVisible();
  });

  it("shows average cost and estimated inventory value from the weighted-average basis", async () => {
    inventoryMocks.fetchPilotInventory.mockResolvedValue({
      items: [
        {
          id: 30,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Chicken Breast",
          normalizedName: "chicken breast",
          category: "Poultry",
          stockUnit: "kg",
          currentOnHand: 100,
          averageUnitCost: 8.88,
          minQuantity: 1,
          parLevel: 5,
          preferredSupplierName: "Dairy Co",
          latestPurchasePrice: 9,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: 0.8,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
      ],
      movements: [],
      countSessions: [],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {
        inventoryItemCount: 1,
        inventoryOutOfStockCount: 0,
        inventoryReorderNowCount: 0,
        inventoryLowStockCount: 0,
        inventoryValue: 888,
      },
    });
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());

    const preview = screen.getByTestId("inventory-live-preview");
    expect(within(preview).getByText("Average cost")).toBeVisible();
    expect(within(preview).getByText("$8.88")).toBeVisible();
    expect(within(preview).getByText("Latest cost")).toBeVisible();
    expect(within(preview).getByText("$9.00")).toBeVisible();
    expect(within(preview).getByText("Estimated inventory value")).toBeVisible();
    expect(within(preview).getByText("$888.00")).toBeVisible();

    expect(screen.getByLabelText("Item notes")).toHaveValue("");
    expect(screen.getByLabelText("Movement note (optional)")).toHaveValue("");
    inventoryMocks.fetchPilotInventory.mockResolvedValueOnce({
      items: [
        {
          id: 30,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Chicken Breast",
          normalizedName: "chicken breast",
          category: "Poultry",
          stockUnit: "kg",
          currentOnHand: 100,
          averageUnitCost: 8.88,
          minQuantity: 1,
          parLevel: 5,
          preferredSupplierName: "Dairy Co",
          latestPurchasePrice: 9,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: 0.8,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "Updated notes",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
      ],
      movements: [],
      countSessions: [],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {
        inventoryItemCount: 1,
        inventoryOutOfStockCount: 0,
        inventoryReorderNowCount: 0,
        inventoryLowStockCount: 0,
        inventoryValue: 888,
      },
    });
    fireEvent.change(screen.getByLabelText("Item notes"), { target: { value: "Updated notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Update item" }));

    await waitFor(() => expect(inventoryMocks.updatePilotInventoryItem).toHaveBeenCalledTimes(1));
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).toMatchObject({ notes: "Updated notes" });
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("averageUnitCost");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("currentOnHand");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("latestPurchasePrice");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("lastPurchaseUnit");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("lastPurchaseConversionFactor");
    expect(inventoryMocks.createPilotInventoryAdjustment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Item notes")).toHaveValue("Updated notes"));
    expect(screen.getByLabelText("Movement note (optional)")).toHaveValue("");
  });

  it("blocks zero-quantity movements and enables non-zero adjustments", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());

    const saveButton = screen.getByRole("button", { name: "Save stock movement" });
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveClass("disabled:opacity-50");
    expect(saveButton).toHaveClass("disabled:cursor-not-allowed");
    fireEvent.change(screen.getByLabelText("Quantity delta"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "Save stock movement" })).toBeEnabled();
  });

  it("shows a local inventory adjustment confirmation and refreshes the edited history", async () => {
    inventoryMocks.createPilotInventoryAdjustment.mockResolvedValue({
      id: 99,
      organizationId: 42,
      locationId: 7,
      inventoryItemId: 30,
      inventoryItemName: "Chicken Breast",
      quantityDelta: 2,
      quantityBefore: 3.3,
      quantityAfter: 5.3,
      unit: "kg",
      sourceType: "manual increase",
      sourceRecordId: "manual-123",
      sourceLineId: "manual-123-line",
      reason: "Shelf count correction",
      actorUserId: 1,
      createdAt: null,
      updatedAt: null,
    });
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());

    inventoryMocks.fetchPilotInventory.mockResolvedValueOnce({
      items: [
        {
          id: 30,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Chicken Breast",
          normalizedName: "chicken breast",
          category: "Poultry",
          stockUnit: "kg",
          currentOnHand: 5.3,
          averageUnitCost: 8.88,
          minQuantity: 1,
          parLevel: 5,
          preferredSupplierName: "Dairy Co",
          latestPurchasePrice: 9,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: 0.8,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
      ],
      movements: [],
      countSessions: [],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {
        inventoryItemCount: 1,
        inventoryOutOfStockCount: 0,
        inventoryReorderNowCount: 0,
        inventoryLowStockCount: 0,
        inventoryValue: 44.4,
      },
    });
    inventoryMocks.fetchPilotInventoryItem.mockResolvedValueOnce({
      id: 30,
      purchaseHistory: [
        {
          id: 1,
          invoiceNumber: "HB-1001",
          supplierName: "Dairy Co",
          invoiceDate: "2026-08-26",
          lineTotal: 21,
          description: "Chicken Breast",
          quantity: 3,
          purchaseUnit: "kg",
        },
      ],
      movementHistory: [
        {
          id: 1,
          sourceType: "purchase",
          quantityDelta: 3,
          unit: "kg",
          reason: "Initial receipt",
        },
        {
          id: 2,
          sourceType: "manual increase",
          quantityDelta: 2,
          unit: "kg",
          reason: "Shelf count correction",
        },
      ],
      supplierMappings: [
        {
          id: 1,
          supplierItemName: "Chicken Breast",
          purchaseUnit: "kg",
          inventoryUnit: "kg",
          conversionFactor: 1,
          lastSeenAt: "2026-08-26",
        },
      ],
    });

    fireEvent.change(screen.getByLabelText("Quantity delta"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock movement" }));

    const confirmations = await screen.findAllByText(/Inventory updated:/);
    expect(confirmations).toHaveLength(2);
    await waitFor(() => expect(within(screen.getByTestId("inventory-live-preview")).getByText("5.3 kg")).toBeVisible());
    await waitFor(() => expect(screen.getByText("Shelf count correction")).toBeVisible());
  });

  it("shows one history category at a time", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());

    expect(screen.getByRole("tab", { name: "Movements" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("HB-1001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Purchases" }));
    expect(await screen.findByText("HB-1001")).toBeVisible();
    expect(screen.queryByText("Initial receipt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Supplier mappings" }));
    expect(await screen.findByText("kg → kg · x1")).toBeVisible();
    expect(screen.queryByText("HB-1001")).not.toBeInTheDocument();
  });
});
