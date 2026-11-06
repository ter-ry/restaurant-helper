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
  reversePilotInventoryAdjustment: vi.fn(),
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
  reversePilotInventoryAdjustment: mocks.reversePilotInventoryAdjustment,
}));

const item = (onHand: number): any => ({
  id: 30, organizationId: 42, locationId: 7, supplierId: null, name: "Chicken Breast", normalizedName: "chicken breast", category: "Poultry",
  stockUnit: "kg", currentOnHand: onHand, minQuantity: 1, parLevel: 5, preferredSupplierName: "", latestPurchasePrice: 9, averageUnitCost: 8.88,
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

async function openMovements() {
  render(<MemoryRouter initialEntries={["/app/inventory"]}><PilotInventoryPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("row", { name: /Chicken Breast/ }));
  fireEvent.click(await screen.findByRole("tab", { name: "History" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Movements" }));
}

describe("adjustment reversal UI (#231)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPilotDataCache();
    setPilotCacheScope("42:7");
    mocks.fetchPilotSuppliers.mockResolvedValue({ suppliers: [] });
    mocks.fetchPilotInventory.mockResolvedValue(list(6));
    mocks.fetchPilotInventoryItem.mockResolvedValue(detail(6, [movement({})]));
  });

  it("requires a reason, shows progress, blocks duplicate submits, then reconciles with server state", async () => {
    let resolve!: (value: unknown) => void;
    mocks.reversePilotInventoryAdjustment.mockReturnValue(new Promise((r) => { resolve = r; }));
    await openMovements();

    fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reversal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a reason");
    expect(mocks.reversePilotInventoryAdjustment).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason for reversing"), { target: { value: "Typo" } });
    mocks.fetchPilotInventory.mockResolvedValue(list(10));
    mocks.fetchPilotInventoryItem.mockResolvedValue(detail(10, [movement({ reversedByMovementId: 6, reversible: false }), movement({ id: 6, sourceType: "adjustment reversal", quantityDelta: 4, quantityBefore: 6, quantityAfter: 10, reversalOfMovementId: 5, reversible: false })]));
    const confirm = screen.getByRole("button", { name: "Confirm reversal" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByRole("button", { name: "Reversing…" })).toBeDisabled();
    expect(mocks.reversePilotInventoryAdjustment).toHaveBeenCalledTimes(1);
    const [movementId, payload] = mocks.reversePilotInventoryAdjustment.mock.calls[0];
    expect(movementId).toBe(5);
    expect(payload.reason).toBe("Typo");
    expect(payload.idempotencyKey).toBeTruthy();

    resolve({ id: 6, quantityBefore: 6, quantityAfter: 10, unit: "kg", inventoryItemName: "Chicken Breast" });
    expect(await screen.findByText(/Adjustment reversed: Chicken Breast 6 → 10 kg/)).toBeVisible();
    expect(await screen.findByText("Reversed by #6")).toBeVisible();
    expect(screen.getByText("Reversal of #5")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reverse" })).not.toBeInTheDocument();
  });

  it("shows the server error, keeps the panel open and reuses the same idempotency key on retry", async () => {
    mocks.reversePilotInventoryAdjustment
      .mockRejectedValueOnce(new Error("Reversal would make inventory negative."))
      .mockResolvedValueOnce({ id: 6, quantityBefore: 6, quantityAfter: 10, unit: "kg", inventoryItemName: "Chicken Breast" });
    await openMovements();
    fireEvent.click(await screen.findByRole("button", { name: "Reverse" }));
    fireEvent.change(screen.getByLabelText("Reason for reversing"), { target: { value: "Typo" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reversal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Reversal would make inventory negative.");
    expect(screen.getByRole("button", { name: "Confirm reversal" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm reversal" }));
    await waitFor(() => expect(mocks.reversePilotInventoryAdjustment).toHaveBeenCalledTimes(2));
    expect(mocks.reversePilotInventoryAdjustment.mock.calls[1][1].idempotencyKey).toBe(mocks.reversePilotInventoryAdjustment.mock.calls[0][1].idempotencyKey);
  });

  it("offers no reverse action for non-adjustment or already linked movements", async () => {
    mocks.fetchPilotInventoryItem.mockResolvedValue(detail(6, [movement({ id: 9, sourceType: "invoice receipt", reversible: false })]));
    await openMovements();
    expect(await screen.findByText("Count fix")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reverse" })).not.toBeInTheDocument();
  });
});
