import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotInventoryBulkEdit } from "../../src/pilot/PilotInventoryBulkEdit";
import { PilotApiError } from "../../src/pilot/pilotApi";

const mocks = vi.hoisted(() => ({ fetchPilotInventory: vi.fn(), fetchPilotSuppliers: vi.fn(), submitBulkEdit: vi.fn() }));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../src/pilot/pilotApi");
  return { ...actual, fetchPilotInventory: mocks.fetchPilotInventory, fetchPilotSuppliers: mocks.fetchPilotSuppliers };
});
vi.mock("../../src/pilot/inventoryBulkEditApi", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../src/pilot/inventoryBulkEditApi");
  return { ...actual, submitBulkEdit: mocks.submitBulkEdit };
});
vi.mock("../../src/pilot/pilotConfig", () => ({ demoReadOnly: false }));

const baseItem = { organizationId: 1, locationId: 1, stockUnit: "kg", category: "Dry", preferredSupplierName: "", supplierId: null, active: true, minQuantity: 1, parLevel: 4 };
let items = [
  { ...baseItem, id: 1, name: "Flour" },
  { ...baseItem, id: 2, name: "Sugar" },
];
const suppliers = [{ id: 5, name: "Acme Foods", isActive: true }, { id: 6, name: "Old Co", isActive: false }];

beforeEach(() => {
  vi.clearAllMocks();
  items = [{ ...baseItem, id: 1, name: "Flour" }, { ...baseItem, id: 2, name: "Sugar" }];
  mocks.fetchPilotInventory.mockImplementation(async () => ({ items }));
  mocks.fetchPilotSuppliers.mockResolvedValue({ suppliers });
});

const reviewResponse = (applied: boolean) => ({
  applied,
  batchId: applied ? "b1" : null,
  summary: { selected: 2, changed: 2, unchanged: 0 },
  items: [
    { id: 1, name: "Flour", status: "changed", changedFields: ["parLevel"], before: { parLevel: 4 }, after: { parLevel: 9 } },
    { id: 2, name: "Sugar", status: "changed", changedFields: ["parLevel"], before: { parLevel: 4 }, after: { parLevel: 9 } },
  ],
});

async function selectBothAndSetPar() {
  await screen.findByText("Flour");
  fireEvent.click(screen.getByRole("button", { name: /Select 2 shown/ }));
  fireEvent.click(screen.getByLabelText("PAR level"));
  fireEvent.change(screen.getByLabelText("New PAR level"), { target: { value: "9" } });
}

describe("PilotInventoryBulkEdit", () => {
  it("selects, clears, reviews, applies once and refreshes from the server", async () => {
    render(<PilotInventoryBulkEdit />);
    await selectBothAndSetPar();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2 selected");

    mocks.submitBulkEdit.mockResolvedValueOnce(reviewResponse(false));
    fireEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(await screen.findByText(/Review: 2 will change/)).toBeInTheDocument();
    expect(screen.getAllByText(/PAR: 4 → 9/)).toHaveLength(2);
    expect(mocks.submitBulkEdit.mock.calls[0][0]).toMatchObject({ itemIds: [1, 2], changes: { parLevel: 9 }, dryRun: true, expected: { "1": { parLevel: 4 }, "2": { parLevel: 4 } } });

    let finish!: (value: unknown) => void;
    mocks.submitBulkEdit.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    items = items.map((item) => ({ ...item, parLevel: 9 }));
    const apply = screen.getByRole("button", { name: "Apply to 2 items" });
    fireEvent.click(apply);
    fireEvent.click(apply); // duplicate click while pending
    expect(await screen.findByText(/Applying changes to 2 items/)).toBeInTheDocument();
    expect(mocks.submitBulkEdit).toHaveBeenCalledTimes(2); // one dry run + exactly one apply
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
    finish(reviewResponse(true));
    expect(await screen.findByText(/Updated 2 items/)).toBeInTheDocument();
    expect(mocks.fetchPilotInventory).toHaveBeenCalledTimes(2); // initial load + authoritative re-fetch
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0 selected");
    expect(screen.getAllByText(/PAR 9/)).toHaveLength(2);
  });

  it("shows validation errors and does not call the server", async () => {
    render(<PilotInventoryBulkEdit />);
    await screen.findByText("Flour");
    fireEvent.click(screen.getByLabelText("Select Flour"));
    fireEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(await screen.findByText(/Choose at least one field/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("PAR level"));
    fireEvent.change(screen.getByLabelText("New PAR level"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(await screen.findByText(/number of 0 or more/)).toBeInTheDocument();
    expect(mocks.submitBulkEdit).not.toHaveBeenCalled();
  });

  it("reports a stale conflict per item, keeps the selection and offers a refresh", async () => {
    render(<PilotInventoryBulkEdit />);
    await selectBothAndSetPar();
    mocks.submitBulkEdit.mockRejectedValueOnce(new PilotApiError("Bulk edit was not applied. Nothing was changed.", 409, { "item-2": "Sugar was changed by someone else since you reviewed it. Refresh and review again." }));
    fireEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(await screen.findByText(/Nothing was saved/)).toBeInTheDocument();
    expect(screen.getByText(/Sugar was changed by someone else/)).toBeInTheDocument();
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2 selected");
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    await waitFor(() => expect(mocks.fetchPilotInventory).toHaveBeenCalledTimes(2));
  });

  it("surfaces a generic failure without losing the selection", async () => {
    render(<PilotInventoryBulkEdit />);
    await selectBothAndSetPar();
    mocks.submitBulkEdit.mockRejectedValueOnce(new Error("Network down"));
    fireEvent.click(screen.getByRole("button", { name: /Review changes/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    expect(screen.getByTestId("selected-count")).toHaveTextContent("2 selected");
    expect(screen.getByRole("button", { name: /Review changes/ })).toBeEnabled();
  });

  it("offers only active suppliers and supports clearing selection", async () => {
    render(<PilotInventoryBulkEdit />);
    await screen.findByText("Flour");
    expect(screen.queryByRole("option", { name: "Old Co" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Acme Foods" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Flour"));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("1 selected");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByTestId("selected-count")).toHaveTextContent("0 selected");
  });
});
