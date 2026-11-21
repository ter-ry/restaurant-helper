import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotCloverMappingPanel } from "../../src/pilot/PilotCloverMappingPanel";

const api = vi.hoisted(() => ({
  fetchPilotCloverMappings: vi.fn(),
  fetchPilotMenuCosting: vi.fn(),
  savePilotCloverLocationMapping: vi.fn(),
  savePilotCloverMenuMapping: vi.fn(),
  deletePilotCloverLocationMapping: vi.fn(),
  deletePilotCloverMenuMapping: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", () => api);
vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    currentLocation: { id: 7, name: "Main" },
    locations: [{ id: 7, name: "Main" }, { id: 9, name: "Kiosk" }],
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const catalog = {
  readOnly: true as const,
  merchantName: "Sandbox Cafe",
  location: { id: "clover-location-1", name: "Main" },
  itemCount: 1,
  items: [{
    id: "clover-item-1",
    name: "Test Burger",
    priceCents: 1800,
    active: true,
    deleted: false,
    hidden: false,
    available: true,
    itemGroupId: null,
    optionIds: [],
    categories: [],
    modifierGroups: [],
  }],
};

describe("PilotCloverMappingPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchPilotCloverMappings.mockResolvedValue({ locationMapping: { id: 1, restaurantLocationId: 7, cloverLocationId: "clover-location-1" }, menuMappings: [] });
    api.fetchPilotMenuCosting.mockResolvedValue({ menuItems: [{ id: 10, name: "Harbour Burger", active: true, recipe: null }] });
    api.savePilotCloverMenuMapping.mockResolvedValue({ mapping: { id: 2, cloverItemId: "clover-item-1", flowtallyMenuItemId: 10, flowtallyMenuItemName: "Harbour Burger", hasRecipe: false } });
  });

  it("offers Retry after a failed initial load and hides the false unmapped state", async () => {
    api.fetchPilotCloverMappings.mockRejectedValueOnce(new Error("Clover unreachable"));
    render(<PilotCloverMappingPanel organizationId={1} catalog={catalog} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Clover unreachable");
    expect(screen.queryByRole("combobox", { name: "Map Test Burger" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("combobox", { name: "Map Test Burger" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("requires explicit Save mapping confirmation before writing a dropdown change", async () => {
    render(<PilotCloverMappingPanel organizationId={1} catalog={catalog} />);
    const select = await screen.findByRole("combobox", { name: "Map Test Burger" });
    fireEvent.change(select, { target: { value: "10" } });
    expect(api.savePilotCloverMenuMapping).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
    await waitFor(() => expect(api.savePilotCloverMenuMapping).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1,
      locationId: 7,
      cloverItemId: "clover-item-1",
      flowtallyMenuItemId: 10,
    })));
  });

  it("ignores a slow mapping response for a previously selected location", async () => {
    const slowMain = deferred<{ locationMapping: null; menuMappings: Array<Record<string, unknown>> }>();
    api.fetchPilotCloverMappings.mockImplementation((_org: number, locationId: number) => locationId === 7
      ? slowMain.promise
      : Promise.resolve({ locationMapping: { id: 3, restaurantLocationId: 9, cloverLocationId: "clover-location-1" }, menuMappings: [] }));
    render(<PilotCloverMappingPanel organizationId={1} catalog={catalog} />);

    fireEvent.change(screen.getByLabelText("Flowtally location"), { target: { value: "9" } });
    await screen.findByRole("combobox", { name: "Map Test Burger" });
    slowMain.resolve({ locationMapping: null, menuMappings: [{ id: 99, cloverItemId: "clover-item-1", flowtallyMenuItemId: 10, flowtallyMenuItemName: "Main-only mapping", hasRecipe: false }] });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/Main-only mapping/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm location" })).not.toBeInTheDocument();
  });

  it("keeps a successful save visible and offers Refresh when the follow-up read fails", async () => {
    render(<PilotCloverMappingPanel organizationId={1} catalog={catalog} />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Map Test Burger" }), { target: { value: "10" } });
    api.fetchPilotCloverMappings.mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));

    expect(await screen.findByText("Saved mapping for Test Burger.")).toBeInTheDocument();
    expect(screen.getByText("Mapped to Harbour Burger · recipe missing")).toBeInTheDocument();
    expect(screen.getByText("Saved, but the latest state could not be reloaded.")).toBeInTheDocument();

    api.fetchPilotCloverMappings.mockResolvedValue({ locationMapping: { id: 1, restaurantLocationId: 7, cloverLocationId: "clover-location-1" }, menuMappings: [{ id: 2, cloverItemId: "clover-item-1", flowtallyMenuItemId: 10, flowtallyMenuItemName: "Harbour Burger", hasRecipe: false }] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByText("Saved, but the latest state could not be reloaded.")).not.toBeInTheDocument());
    expect(screen.getByText("Mapping state refreshed.")).toBeInTheDocument();
  });
});
