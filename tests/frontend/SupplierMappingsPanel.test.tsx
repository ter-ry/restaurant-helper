import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupplierMappingsPanel } from "../../src/pilot/SupplierMappingsPanel";
import type { PilotSupplierItemMappingRow } from "../../src/pilot/pilotApi";

const api = vi.hoisted(() => ({
  fetchPilotSupplierItemMappings: vi.fn(),
  createPilotSupplierItemMapping: vi.fn(),
  updatePilotSupplierItemMapping: vi.fn(),
  deletePilotSupplierItemMapping: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return { ...actual, ...api };
});

const row = (overrides: Partial<PilotSupplierItemMappingRow> = {}): PilotSupplierItemMappingRow => ({
  id: 1,
  organizationId: 1,
  supplierId: 5,
  inventoryItemId: 7,
  supplierItemName: "Flour 20kg",
  normalizedSupplierItemName: "flour 20kg",
  purchaseUnit: "bag",
  inventoryUnit: "kg",
  conversionFactor: 20,
  lastSeenAt: null,
  createdAt: null,
  updatedAt: null,
  inventoryItemName: "Flour",
  ...overrides,
} as PilotSupplierItemMappingRow);

describe("SupplierMappingsPanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it("lists, adds with refetch and shows success without reload", async () => {
    api.fetchPilotSupplierItemMappings.mockResolvedValueOnce({ mappings: [row()] }).mockResolvedValueOnce({ mappings: [row(), row({ id: 2, supplierItemName: "Sugar 10kg", inventoryItemName: "Sugar" })] });
    api.createPilotSupplierItemMapping.mockResolvedValue(row({ id: 2 }));
    const onChanged = vi.fn();
    render(<SupplierMappingsPanel supplierId={5} inventoryItems={[{ id: 7, name: "Flour" }, { id: 8, name: "Sugar" }]} onChanged={onChanged} />);
    expect(await screen.findByText("Flour 20kg")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    fireEvent.change(screen.getByLabelText("Supplier item name"), { target: { value: "Sugar 10kg" } });
    fireEvent.change(screen.getByLabelText("Inventory item"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Inventory units per purchase unit"), { target: { value: "10" } });
    const submit = screen.getAllByRole("button", { name: "Add mapping" }).pop()!;
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByText("Sugar 10kg")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Mapping added");
    expect(api.createPilotSupplierItemMapping).toHaveBeenCalledTimes(1);
    expect(api.createPilotSupplierItemMapping).toHaveBeenCalledWith(5, expect.objectContaining({ inventoryItemId: 8, conversionFactor: 10 }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("rejects a non-positive conversion factor and surfaces server errors", async () => {
    api.fetchPilotSupplierItemMappings.mockResolvedValue({ mappings: [row()] });
    api.updatePilotSupplierItemMapping.mockRejectedValue(new Error("That supplier item is already mapped to this inventory item."));
    render(<SupplierMappingsPanel supplierId={5} inventoryItems={[{ id: 7, name: "Flour" }]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Inventory units per purchase unit"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    expect((await screen.findByRole("alert")).textContent).toContain("greater than 0");
    expect(api.updatePilotSupplierItemMapping).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Inventory units per purchase unit"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already mapped"));
  });

  it("removes a mapping after confirmation and refetches", async () => {
    api.fetchPilotSupplierItemMappings.mockResolvedValueOnce({ mappings: [row()] }).mockResolvedValueOnce({ mappings: [] });
    api.deletePilotSupplierItemMapping.mockResolvedValue({ deleted: true, id: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SupplierMappingsPanel supplierId={5} inventoryItems={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText(/No mappings yet/)).toBeTruthy());
    expect(api.deletePilotSupplierItemMapping).toHaveBeenCalledWith(5, 1);
  });
});
