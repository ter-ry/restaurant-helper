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
    locations: [{ id: 7, name: "Main" }],
  }),
}));

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
});
