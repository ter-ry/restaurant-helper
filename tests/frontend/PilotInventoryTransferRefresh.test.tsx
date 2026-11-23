import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotInventoryPage } from "../../src/pilot/PilotInventoryPage";
import { clearPilotDataCache, setPilotCacheScope } from "../../src/pilot/pilotDataCache";

const mocks = vi.hoisted(() => ({
  fetchPilotInventory: vi.fn(),
  fetchPilotInventoryItem: vi.fn(),
  fetchPilotSuppliers: vi.fn(),
  createPilotInventoryTransfer: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({ ...((await importOriginal()) as object), useNavigate: () => vi.fn() }));
vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    currentLocation: { id: 7, name: "Line Kitchen" },
    locations: [{ id: 7, name: "Line Kitchen" }, { id: 8, name: "Kiosk" }],
    organization: { id: 42, name: "Inventory Cafe" },
  }),
}));
vi.mock("../../src/pilot/pilotApi", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  fetchPilotInventory: mocks.fetchPilotInventory,
  fetchPilotInventoryItem: mocks.fetchPilotInventoryItem,
  fetchPilotSuppliers: mocks.fetchPilotSuppliers,
  createPilotInventoryTransfer: mocks.createPilotInventoryTransfer,
}));

const item = (onHand: number): any => ({
  id: 30, organizationId: 42, locationId: 7, supplierId: null, name: "Chicken Breast", normalizedName: "chicken breast", category: "Poultry",
  stockUnit: "kg", currentOnHand: onHand, minQuantity: 1, parLevel: 5, preferredSupplierName: "", latestPurchasePrice: 9, averageUnitCost: 8.88,
  lastPurchaseUnit: "kg", lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0.8,
  estimatedCostMethod: "weighted_average", active: true, notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});
const list = (onHand: number): any => ({
  items: [item(onHand)], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
  summary: { inventoryItemCount: 1, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 1 },
});

describe("inventory transfer after a list refresh (stale item detail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPilotDataCache();
    setPilotCacheScope("42:7");
    mocks.fetchPilotSuppliers.mockResolvedValue({ suppliers: [] });
  });

  it("uses the refreshed on-hand quantity, not the older item detail, to validate a transfer", async () => {
    // Detail was loaded when 2 kg were on hand; another user then received stock (list now says 12 kg).
    mocks.fetchPilotInventory.mockResolvedValueOnce(list(2)).mockResolvedValue(list(12));
    mocks.fetchPilotInventoryItem.mockResolvedValue({ item: item(2), purchaseHistory: [], movementHistory: [], supplierMappings: [] });
    mocks.createPilotInventoryTransfer.mockResolvedValue({ quantity: 10, unit: "kg", outMovement: { quantityAfter: 2 } });

    render(<MemoryRouter initialEntries={["/app/inventory"]}><PilotInventoryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("row", { name: /Chicken Breast/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Transfer to another location" }));
    expect(await screen.findByText(/Available here/)).toHaveTextContent("2 kg");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText(/Available here/)).toHaveTextContent("12 kg"));

    fireEvent.change(screen.getByLabelText("Send to"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() => expect(mocks.createPilotInventoryTransfer).toHaveBeenCalledTimes(1));
    expect(mocks.createPilotInventoryTransfer.mock.calls[0][0]).toMatchObject({ sourceItemId: 30, destinationLocationId: 8, quantity: 10 });
  });
});
