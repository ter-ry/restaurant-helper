import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotInventoryPage } from "../../src/pilot/PilotInventoryWorkspace";

const api = vi.hoisted(() => ({
  fetchPilotInventory: vi.fn(),
  fetchPilotSuppliers: vi.fn(),
  updatePilotSupplier: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({ organization: { id: 1, name: "Cafe" }, currentLocation: { id: 1, name: "Main", timezone: "America/Toronto" } }),
}));
vi.mock("../../src/pilot/pilotApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/pilot/pilotApi")>()),
  fetchPilotInventory: api.fetchPilotInventory,
  fetchPilotSuppliers: api.fetchPilotSuppliers,
  updatePilotSupplier: api.updatePilotSupplier,
}));

const supplier = (isActive: boolean) => ({
  id: 5, organizationId: 1, name: "Bean Co", normalizedName: "bean co", categoryFocus: "Coffee", contactName: "", contactPhone: "",
  contactEmail: "", orderingNotes: "", notes: "", isActive, createdAt: null, updatedAt: null, inventoryItemCount: 0,
  purchaseInvoiceCount: 2, supplierItemMappingCount: 0, latestInvoiceDate: null, historicalReferenceCount: 2, recentInvoices: [], recentMappings: [],
});

describe("supplier archive action", () => {
  beforeEach(() => {
    api.fetchPilotInventory.mockResolvedValue({ items: [], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] }, summary: {} });
    api.fetchPilotSuppliers.mockResolvedValue({ suppliers: [supplier(true)] });
  });

  it("shows busy state, blocks duplicate submits, then re-fetches and shows Restore", async () => {
    let resolve!: (value: unknown) => void;
    api.updatePilotSupplier.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<MemoryRouter><PilotInventoryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: /Suppliers/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Bean Co/ }));
    const archive = await screen.findByRole("button", { name: "Archive supplier" });
    fireEvent.click(archive);
    fireEvent.click(archive);
    const busy = await screen.findByRole("button", { name: "Working…" });
    expect(busy).toBeDisabled();
    expect(api.updatePilotSupplier).toHaveBeenCalledTimes(1);
    api.fetchPilotSuppliers.mockResolvedValue({ suppliers: [supplier(false)] });
    resolve(supplier(false));
    expect(await screen.findByRole("button", { name: "Restore supplier" })).toBeEnabled();
    expect(screen.getByText(/archived\. Past invoices keep their history/)).toBeInTheDocument();
    expect(api.fetchPilotSuppliers.mock.calls.length).toBeGreaterThan(1);
  });

  it("shows a failure message and allows retry", async () => {
    api.updatePilotSupplier.mockRejectedValueOnce(new Error("Network down"));
    render(<MemoryRouter><PilotInventoryPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: /Suppliers/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Bean Co/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive supplier" }));
    expect(await screen.findByText("Network down")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Archive supplier" })).toBeEnabled());
  });
});
