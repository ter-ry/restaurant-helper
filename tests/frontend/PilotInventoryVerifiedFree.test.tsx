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
  createPilotInventoryAdjustment: vi.fn(),
  fetchPilotCostVerifications: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({ ...((await importOriginal()) as object), useNavigate: () => vi.fn() }));
vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({ currentLocation: { id: 7, name: "Line Kitchen" }, organization: { id: 42, name: "Inventory Cafe" } }),
}));
vi.mock("../../src/pilot/pilotApi", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  fetchPilotInventory: mocks.fetchPilotInventory,
  fetchPilotInventoryItem: mocks.fetchPilotInventoryItem,
  fetchPilotSuppliers: mocks.fetchPilotSuppliers,
  createPilotInventoryAdjustment: mocks.createPilotInventoryAdjustment,
  fetchPilotCostVerifications: mocks.fetchPilotCostVerifications,
}));

const item = (onHand: number): any => ({
  id: 30, organizationId: 42, locationId: 7, supplierId: null, name: "Chicken Breast", normalizedName: "chicken breast", category: "Poultry",
  stockUnit: "kg", currentOnHand: onHand, minQuantity: 1, parLevel: 5, preferredSupplierName: "", latestPurchasePrice: 9, averageUnitCost: 0,
  lastPurchaseUnit: "kg", lastPurchaseConversionFactor: 1, lastReceivedAt: null, lastCountedAt: null, averageDailyUsage: 0.8,
  estimatedCostMethod: "weighted_average", active: true, notes: "", createdByUserId: 1, updatedByUserId: 1, createdAt: null, updatedAt: null,
});

const movement = (overrides: Record<string, unknown>): any => ({
  id: 5, organizationId: 42, locationId: 7, inventoryItemId: 30, inventoryItemName: "Chicken Breast", quantityDelta: -4, quantityBefore: 10,
  quantityAfter: 6, unit: "kg", sourceType: "manual decrease", sourceRecordId: "manual-1", sourceLineId: "manual", reason: "Count fix",
  actorUserId: 1, createdAt: "2026-08-26T12:00:00.000Z", updatedAt: "2026-08-26T12:00:00.000Z",
  reversalOfMovementId: null, reversedByMovementId: null, reversible: true, ...overrides,
});

const detail = (onHand: number, movements: any[]): any => ({ item: item(onHand), purchaseHistory: [], movementHistory: movements, supplierMappings: [] });
const list = (onHand: number): any => ({
  items: [item(onHand)], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
  summary: { inventoryItemCount: 1, inventoryOutOfStockCount: 0, inventoryReorderNowCount: 0, inventoryLowStockCount: 0, inventoryValue: 1 },
});


describe("verified-free panel in the inventory workspace (#312)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPilotDataCache();
    setPilotCacheScope("42:7");
    mocks.fetchPilotSuppliers.mockResolvedValue({ suppliers: [] });
    mocks.fetchPilotCostVerifications.mockResolvedValue({ itemId: 30, verifications: [] });
    mocks.fetchPilotInventory.mockResolvedValue(list(10));
    mocks.fetchPilotInventoryItem.mockResolvedValue(detail(10, []));
  });

  it("shows the reconciled on-hand quantity after an adjustment, so it never offers a stale default", async () => {
    mocks.createPilotInventoryAdjustment.mockResolvedValue({});
    render(<MemoryRouter initialEntries={["/app/inventory"]}><PilotInventoryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("row", { name: /Chicken Breast/ }));
    expect(await screen.findByText(/On hand 10 kg · verified free 0 · unverified 10/)).toBeVisible();

    mocks.fetchPilotInventory.mockResolvedValue(list(6));
    mocks.fetchPilotInventoryItem.mockResolvedValue(detail(6, []));
    fireEvent.click(await screen.findByRole("button", { name: "Adjust inventory" }));
    fireEvent.change(screen.getByLabelText(/Quantity delta/), { target: { value: "-4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stock movement" }));
    await waitFor(() => expect(mocks.createPilotInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/On hand 6 kg · verified free 0 · unverified 6/)).toBeVisible();
    await waitFor(() => expect(mocks.fetchPilotCostVerifications.mock.calls.length).toBeGreaterThan(1));
  });
  it("re-reads evidence when the workspace Refresh button is used (evidence changed by another session)", async () => {
    render(<MemoryRouter initialEntries={["/app/inventory"]}><PilotInventoryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("row", { name: /Chicken Breast/ }));
    expect(await screen.findByText(/verified free 0 · unverified 10/)).toBeVisible();
    mocks.fetchPilotCostVerifications.mockResolvedValue({ itemId: 30, verifications: [{ id: 1, itemId: 30, quantity: 4, consumedQuantity: 0, remainingQuantity: 4, unit: "kg", evidenceType: "donation", evidenceNote: "Added elsewhere", correctionOfId: null, verifiedAt: null, revokedAt: null, revokedReason: "" }] });
    fireEvent.click(screen.getAllByRole("button", { name: /Refresh/ })[0]);
    expect(await screen.findByText(/verified free 4 · unverified 6/)).toBeVisible();
  });
  it("uses the refreshed list quantities when stock changed in another session", async () => {
    render(<MemoryRouter initialEntries={["/app/inventory"]}><PilotInventoryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("row", { name: /Chicken Breast/ }));
    expect(await screen.findByText(/On hand 10 kg · verified free 0 · unverified 10/)).toBeVisible();
    mocks.fetchPilotInventory.mockResolvedValue(list(6));
    fireEvent.click(screen.getAllByRole("button", { name: /Refresh/ })[0]);
    expect(await screen.findByText(/On hand 6 kg · verified free 0 · unverified 6/)).toBeVisible();
  });
});
