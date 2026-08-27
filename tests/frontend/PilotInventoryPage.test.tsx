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

    expect(await screen.findByRole("heading", { name: "Keep stock, counts, and reorder logic aligned" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Reorder status" })).toBeVisible();
    expect(screen.getByText("Select an item or create one deliberately")).toBeVisible();
    expect(screen.queryByLabelText("Item name")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "New item" })[0]);
    expect(screen.getByText("Create inventory item")).toBeVisible();
    expect(screen.getByLabelText("Item name")).toHaveValue("");

    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());
    expect(screen.getByLabelText("Item name")).toHaveValue("Chicken Breast");
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
    inventoryMocks.updatePilotInventoryItem.mockResolvedValue({
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
    });

    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Keep stock, counts, and reorder logic aligned" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByText("Edit Chicken Breast")).toBeVisible());

    const preview = screen.getByTestId("inventory-live-preview");
    expect(within(preview).getByText("Average cost")).toBeVisible();
    expect(within(preview).getByText("$8.88")).toBeVisible();
    expect(within(preview).getByText("Latest cost")).toBeVisible();
    expect(within(preview).getByText("$9.00")).toBeVisible();
    expect(within(preview).getByText("Estimated inventory value")).toBeVisible();
    expect(within(preview).getByText("$888.00")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Updated notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Update item" }));

    await waitFor(() => expect(inventoryMocks.updatePilotInventoryItem).toHaveBeenCalled());
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("averageUnitCost");
  });
});
