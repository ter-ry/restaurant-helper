import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotInventoryPage } from "../../src/pilot/PilotInventoryPage";
import type { PilotInventoryItem, PilotInventoryItemDetail, PilotInventoryResponse } from "../../src/pilot/pilotApi";

const navigateMock = vi.hoisted(() => vi.fn());

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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    currentLocation: { id: 7, name: "Line Kitchen" },
    organization: { id: 42, name: "Inventory Cafe" },
  }),
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../src/pilot/pilotApi");
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

function createInventoryItem(overrides: Partial<PilotInventoryItem> = {}): PilotInventoryItem {
  return {
    id: 30,
    organizationId: 42,
    locationId: 7,
    supplierId: null,
    name: "Chicken Breast",
    normalizedName: "chicken breast",
    category: "Poultry",
    stockUnit: "kg",
    currentOnHand: 28,
    minQuantity: 1,
    parLevel: 5,
    preferredSupplierName: "Dairy Co",
    latestPurchasePrice: 9,
    averageUnitCost: 8.88,
    lastPurchaseUnit: "kg",
    lastPurchaseConversionFactor: 1,
    lastReceivedAt: null,
    lastCountedAt: null,
    averageDailyUsage: 0.8,
    estimatedCostMethod: "weighted_average",
    active: true,
    notes: "",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function createInventoryResponse(overrides: Partial<PilotInventoryResponse> = {}): PilotInventoryResponse {
  return {
    items: [
      createInventoryItem(),
      createInventoryItem({
        id: 31,
        name: "Tomatoes",
        normalizedName: "tomatoes",
        category: "Produce",
        currentOnHand: 12,
        minQuantity: 4,
        parLevel: 10,
        preferredSupplierName: "Fresh Co",
        latestPurchasePrice: 3,
        averageUnitCost: 2.75,
        averageDailyUsage: 1.5,
      }),
    ],
    movements: [
      {
        id: 1,
        organizationId: 42,
        locationId: 7,
        inventoryItemId: 30,
        inventoryItemName: "Chicken Breast",
        quantityDelta: 2,
        quantityBefore: 28,
        quantityAfter: 30,
        unit: "kg",
        sourceType: "manual adjustment",
        sourceRecordId: "manual-1",
        sourceLineId: "manual",
        reason: "Periodic review",
        actorUserId: 1,
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
    ],
    countSessions: [
      {
        id: 1,
        organizationId: 42,
        locationId: 7,
        status: "Completed",
        startedAt: "2026-08-29T11:00:00.000Z",
        completedAt: "2026-08-29T11:20:00.000Z",
        countedBy: "Inventory Lead",
        notes: "",
        itemCount: 2,
        countedLineCount: 2,
        uncountedLineCount: 0,
        varianceTotal: 0,
        movementCountSinceStart: 0,
        hasMovementSinceStart: false,
        createdByUserId: 1,
        finalizedByUserId: 1,
        lines: [],
        createdAt: "2026-08-29T11:00:00.000Z",
        updatedAt: "2026-08-29T11:20:00.000Z",
      } as any,
    ],
    reorderPlan: { suggestions: [], groupedBySupplier: [] },
    summary: {
      inventoryItemCount: 2,
      inventoryOutOfStockCount: 0,
      inventoryReorderNowCount: 1,
      inventoryLowStockCount: 1,
      inventoryValue: 275.04,
    },
    ...overrides,
  };
}

function createInventoryDetail(item: PilotInventoryItem = createInventoryItem()): PilotInventoryItemDetail {
  return {
    item,
    purchaseHistory: [
      {
        id: 1,
        invoiceId: 91,
        supplierName: "Dairy Co",
        invoiceNumber: "HB-1001",
        invoiceDate: "2026-08-26",
        inventoryItemId: item.id,
        supplierItemMappingId: null,
        lineIndex: 0,
        description: "Chicken Breast",
        normalizedDescription: "chicken breast",
        purchaseUnit: "kg",
        inventoryUnit: "kg",
        conversionFactor: 1,
        quantity: 3,
        unitPrice: 9,
        lineTotal: 27,
        confidence: 1,
        needsReview: false,
        previousUnitPrice: null,
        priceChangePercent: null,
        note: "",
        createdAt: "2026-08-26T12:00:00.000Z",
        updatedAt: "2026-08-26T12:00:00.000Z",
      },
    ],
    movementHistory: [
      {
        id: 1,
        organizationId: 42,
        locationId: 7,
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        quantityDelta: 2,
        quantityBefore: 28,
        quantityAfter: 30,
        unit: item.stockUnit,
        sourceType: "manual adjustment",
        sourceRecordId: "manual-1",
        sourceLineId: "manual",
        reason: "Initial receipt",
        actorUserId: 1,
        createdAt: "2026-08-26T12:00:00.000Z",
        updatedAt: "2026-08-26T12:00:00.000Z",
      },
    ],
    supplierMappings: [
      {
        id: 1,
        organizationId: 42,
        supplierId: 11,
        inventoryItemId: item.id,
        supplierItemName: "Chicken Breast",
        normalizedSupplierItemName: "chicken breast",
        purchaseUnit: "kg",
        inventoryUnit: "kg",
        conversionFactor: 1,
        lastSeenAt: "2026-08-26T12:00:00.000Z",
        createdAt: "2026-08-26T12:00:00.000Z",
        updatedAt: "2026-08-26T12:00:00.000Z",
      },
    ],
  };
}

describe("PilotInventoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
    inventoryMocks.fetchPilotInventory.mockResolvedValue(createInventoryResponse());
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
          supplierItemMappingCount: 1,
          latestInvoiceDate: "2026-08-26",
          historicalReferenceCount: 2,
          recentInvoices: [],
          recentMappings: [],
        },
      ],
    });
    inventoryMocks.fetchPilotInventoryItem.mockResolvedValue(createInventoryDetail());
    inventoryMocks.createPilotInventoryAdjustment.mockResolvedValue({
      id: 99,
      organizationId: 42,
      locationId: 7,
      inventoryItemId: 30,
      inventoryItemName: "Chicken Breast",
      quantityDelta: 2,
      quantityBefore: 28,
      quantityAfter: 30,
      unit: "kg",
      sourceType: "manual adjustment",
      sourceRecordId: "manual-1",
      sourceLineId: "manual",
      reason: "Periodic review",
      actorUserId: 1,
      createdAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-08-29T12:00:00.000Z",
    });
  });

  it("opens items in a full-width workspace and restores the browse table", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeVisible();
    expect(screen.queryByText("Count sessions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Back to Inventory" })).toBeVisible());
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("columnheader", { name: "Item" })).not.toBeInTheDocument();
    expect(screen.getByText("28 kg on hand · Dairy Co")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back to Inventory" }));
    expect(await screen.findByRole("columnheader", { name: "Item" })).toBeVisible();
  });

  it("keeps the overview adjustment workflow separate from item notes and blocks zero deltas", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true"));

    expect(screen.getByLabelText("Quantity delta")).toHaveValue(0);
    expect(screen.getByRole("button", { name: "Save stock movement" })).toBeDisabled();
    expect(screen.getByText("Movement note (optional)")).toBeVisible();
    expect(screen.queryByLabelText("Item notes")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Current on hand")).not.toBeInTheDocument();

    inventoryMocks.fetchPilotInventory.mockResolvedValueOnce(
      createInventoryResponse({
        items: [
          createInventoryItem({ currentOnHand: 30 }),
          createInventoryItem({
            id: 31,
            name: "Tomatoes",
            normalizedName: "tomatoes",
            category: "Produce",
            currentOnHand: 12,
            minQuantity: 4,
            parLevel: 10,
            preferredSupplierName: "Fresh Co",
            latestPurchasePrice: 3,
            averageUnitCost: 2.75,
            averageDailyUsage: 1.5,
          }),
        ],
        summary: {
          inventoryItemCount: 2,
          inventoryOutOfStockCount: 0,
          inventoryReorderNowCount: 0,
          inventoryLowStockCount: 1,
          inventoryValue: 290.4,
        },
      }),
    );

    fireEvent.change(screen.getByLabelText("Quantity delta"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Periodic review" } });
    fireEvent.change(screen.getByLabelText("Movement note (optional)"), { target: { value: "Shelf count" } });
    expect(screen.getByRole("button", { name: "Save stock movement" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save stock movement" }));

    await waitFor(() => expect(inventoryMocks.createPilotInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(inventoryMocks.createPilotInventoryAdjustment.mock.calls[0][1]).toMatchObject({
      reason: "Periodic review",
      quantityDelta: 2,
      movementType: "manual increase",
      note: "Shelf count",
    });
    expect(await screen.findByText("Inventory updated: 28 kg → 30 kg (+2 kg).")).toBeVisible();
    expect(screen.getByText((_, element) => element?.textContent === "30 kg on hand · Dairy Co")).toBeVisible();
  });

  it("keeps edit metadata separate from system-derived values and only updates notes through Update item", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true"));

    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(await screen.findByLabelText("Item name")).toHaveValue("Chicken Breast");
    expect(screen.getByLabelText("Category")).toHaveValue("Poultry");
    expect(screen.getByLabelText("Base unit")).toHaveValue("kg");
    expect(screen.getByLabelText("Item notes")).toHaveValue("");
    expect(screen.queryByLabelText("Current on hand")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Latest price")).not.toBeInTheDocument();
    expect(screen.queryByText("Movement note (optional)")).not.toBeInTheDocument();

    inventoryMocks.fetchPilotInventory.mockResolvedValueOnce(
      createInventoryResponse({
        items: [
          createInventoryItem({ notes: "Updated notes" }),
          createInventoryItem({
            id: 31,
            name: "Tomatoes",
            normalizedName: "tomatoes",
            category: "Produce",
            currentOnHand: 12,
            minQuantity: 4,
            parLevel: 10,
            preferredSupplierName: "Fresh Co",
            latestPurchasePrice: 3,
            averageUnitCost: 2.75,
            averageDailyUsage: 1.5,
          }),
        ],
      }),
    );

    fireEvent.change(screen.getByLabelText("Item notes"), { target: { value: "Updated notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Update item" }));

    await waitFor(() => expect(inventoryMocks.updatePilotInventoryItem).toHaveBeenCalledTimes(1));
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).toMatchObject({
      name: "Chicken Breast",
      category: "Poultry",
      stockUnit: "kg",
      preferredSupplierName: "Dairy Co",
      minQuantity: 1,
      parLevel: 5,
      averageDailyUsage: 0.8,
      notes: "Updated notes",
      active: true,
    });
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("currentOnHand");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("latestPurchasePrice");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("lastPurchaseUnit");
    expect(inventoryMocks.updatePilotInventoryItem.mock.calls[0][1]).not.toHaveProperty("lastPurchaseConversionFactor");
    expect(await screen.findByLabelText("Item notes")).toHaveValue("Updated notes");
  });

  it("shows one history stream at a time", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("row", { name: /Chicken Breast/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true"));

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByRole("tab", { name: "Purchases" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("HB-1001")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Movements" }));
    expect(screen.getByText("Initial receipt")).toBeVisible();
    expect(screen.queryByText("HB-1001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Supplier mappings" }));
    expect(within(screen.getByRole("table")).getByText("Chicken Breast")).toBeVisible();
    expect(screen.queryByText("Initial receipt")).not.toBeInTheDocument();
  });

  it("opens the create workspace full width and keeps stock counts navigation available", async () => {
    render(
      <MemoryRouter initialEntries={["/app/inventory"]}>
        <PilotInventoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Browse stock, manage suppliers, and keep cost basis clear" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "New item" }));

    expect(await screen.findByRole("heading", { name: "Create inventory item" })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Item" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current on hand")).toHaveValue(0);
    expect(screen.getByLabelText("Latest price")).toHaveValue(0);
    expect(screen.getByLabelText("Last purchase unit")).toHaveValue("each");
    expect(screen.getByLabelText("Purchase conversion")).toHaveValue(1);
    expect(screen.queryByText("Count sessions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stock counts →" }));
    expect(navigateMock).toHaveBeenCalledWith("/app/stock-counts");
  });
});
