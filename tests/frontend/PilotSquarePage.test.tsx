import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotSquarePage } from "../../src/pilot/PilotSquarePage";
import type { PilotMenuCostingResponse, PilotSquareConnectionSummary } from "../../src/pilot/pilotApi";

const mockApi = vi.hoisted(() => ({
  fetchPilotSquareStatus: vi.fn(),
  fetchPilotMenuCosting: vi.fn(),
  syncPilotSquareLocations: vi.fn(),
  syncPilotSquareCatalog: vi.fn(),
  syncPilotSquareOrders: vi.fn(),
  updatePilotSquareLocationMapping: vi.fn(),
  updatePilotSquareCatalogMapping: vi.fn(),
  disconnectPilotSquare: vi.fn(),
  beginPilotSquareConnection: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    organization: { id: 42, name: "Pilot Cafe" },
    currentLocation: { id: 7, name: "Line Kitchen" },
    locations: [
      { id: 7, name: "Line Kitchen" },
      { id: 8, name: "Front Counter" },
    ],
  }),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return {
    ...actual,
    fetchPilotSquareStatus: mockApi.fetchPilotSquareStatus,
    fetchPilotMenuCosting: mockApi.fetchPilotMenuCosting,
    syncPilotSquareLocations: mockApi.syncPilotSquareLocations,
    syncPilotSquareCatalog: mockApi.syncPilotSquareCatalog,
    syncPilotSquareOrders: mockApi.syncPilotSquareOrders,
    updatePilotSquareLocationMapping: mockApi.updatePilotSquareLocationMapping,
    updatePilotSquareCatalogMapping: mockApi.updatePilotSquareCatalogMapping,
    disconnectPilotSquare: mockApi.disconnectPilotSquare,
    beginPilotSquareConnection: mockApi.beginPilotSquareConnection,
  };
});

function createDisconnectedConnection(): PilotSquareConnectionSummary {
  return {
    id: 1,
    organizationId: 42,
    organization: { id: 42, name: "Pilot Cafe" },
    environment: "sandbox",
    squareMerchantId: "",
    status: "disconnected",
    tokenExpiresAt: null,
    revokedAt: null,
    lastSyncAt: null,
    syncStatus: "idle",
    syncError: "",
    catalogCount: 0,
    orderCount: 0,
    locationCount: 0,
    dailySalesCount: 0,
    locations: [],
    catalogObjects: [],
    orders: [],
    dailySales: [],
    syncJobs: [],
    webhookEvents: [],
  };
}

function createConnectedConnection(): PilotSquareConnectionSummary {
  return {
    id: 1,
    organizationId: 42,
    organization: { id: 42, name: "Pilot Cafe" },
    environment: "sandbox",
    squareMerchantId: "merchant-42",
    status: "connected",
    tokenExpiresAt: "2026-08-29T22:00:00.000Z",
    revokedAt: null,
    lastSyncAt: "2026-08-29T21:30:00.000Z",
    syncStatus: "idle",
    syncError: "",
    catalogCount: 1,
    orderCount: 4,
    locationCount: 1,
    dailySalesCount: 1,
    locations: [
      {
        id: 10,
        squareLocationId: "SQ-10",
        name: "Main Bar",
        status: "active",
        rawPayload: {},
        mappings: [],
      },
    ],
    catalogObjects: [
      {
        id: 55,
        squareObjectId: "ITEM-55",
        objectType: "ITEM_VARIATION",
        version: 1,
        isDeleted: false,
        rawPayload: {},
        mappings: [
          {
            id: 91,
            squareCatalogObjectId: 55,
            mappingType: "menu_item",
            flowtallyEntityType: "",
            flowtallyEntityId: "",
            status: "unmapped",
          },
        ],
      },
    ],
    orders: [],
    dailySales: [
      {
        id: 301,
        squareLocationId: "SQ-10",
        restaurantLocationId: 7,
        saleDate: "2026-08-29",
        currency: "CAD",
        grossAmount: 1500,
        discountAmount: 50,
        taxAmount: 100,
        tipAmount: 75,
        refundAmount: 25,
        netAmount: 1600,
        orderCount: 4,
        cancelledOrderCount: 0,
        rawPayload: {},
      },
    ],
    syncJobs: [
      {
        id: 401,
        jobType: "orders",
        status: "completed",
        requestedAt: "2026-08-29T21:15:00.000Z",
        startedAt: "2026-08-29T21:16:00.000Z",
        completedAt: "2026-08-29T21:18:00.000Z",
        errorMessage: "",
        cursorJson: {},
      },
    ],
    webhookEvents: [],
  };
}

function createMenuCosting(): PilotMenuCostingResponse {
  return {
    organizationId: 42,
    locationId: 7,
    recipes: [],
    menuItems: [
      {
        id: 901,
        organizationId: 42,
        locationId: 7,
        recipeId: 1,
        name: "Classic Milk Tea",
        normalizedName: "classic milk tea",
        category: "Tea",
        sellingPrice: 7.5,
        active: true,
        notes: "",
        recipe: null,
        recipeCostPerYield: 2.1,
        grossProfit: 5.4,
        foodCostPercent: 28,
        grossMarginPercent: 72,
        costAvailable: true,
        warnings: [],
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: null,
        updatedAt: null,
      },
    ],
  };
}

describe("PilotSquarePage", () => {
  beforeEach(() => {
    mockApi.fetchPilotSquareStatus.mockReset();
    mockApi.fetchPilotMenuCosting.mockReset();
    mockApi.syncPilotSquareLocations.mockReset();
    mockApi.syncPilotSquareCatalog.mockReset();
    mockApi.syncPilotSquareOrders.mockReset();
    mockApi.updatePilotSquareLocationMapping.mockReset();
    mockApi.updatePilotSquareCatalogMapping.mockReset();
    mockApi.disconnectPilotSquare.mockReset();
    mockApi.beginPilotSquareConnection.mockReset();
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection: createDisconnectedConnection() });
    mockApi.fetchPilotMenuCosting.mockResolvedValue(createMenuCosting());
    mockApi.syncPilotSquareLocations.mockResolvedValue({ connection: createConnectedConnection(), job: { id: 1, jobType: "locations", status: "completed", cursorJson: {} } });
    mockApi.syncPilotSquareCatalog.mockResolvedValue({ connection: createConnectedConnection(), job: { id: 2, jobType: "catalog", status: "completed", cursorJson: {} } });
    mockApi.syncPilotSquareOrders.mockResolvedValue({ connection: createConnectedConnection(), job: { id: 3, jobType: "orders", status: "completed", cursorJson: {} } });
    mockApi.updatePilotSquareLocationMapping.mockResolvedValue({ connection: createConnectedConnection() });
    mockApi.updatePilotSquareCatalogMapping.mockResolvedValue({ connection: createConnectedConnection() });
    mockApi.disconnectPilotSquare.mockResolvedValue({ connection: createDisconnectedConnection() });
  });

  it("shows the disconnected controls and keeps sync actions disabled", async () => {
    render(<PilotSquarePage />);

    expect(await screen.findByRole("heading", { name: "Connection and sync" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Square" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync locations" })).toBeDisabled();
    expect(screen.getByText("Location mapping")).toBeVisible();
    expect(screen.getByText("Menu mapping")).toBeVisible();
    expect(screen.getByText("disconnected")).toBeVisible();
  });

  it("supports connected status, sync, and menu/location mapping updates", async () => {
    mockApi.fetchPilotSquareStatus.mockResolvedValueOnce({ connection: createConnectedConnection() });

    const { container } = render(<PilotSquarePage />);

    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync locations" })).toBeEnabled();
    expect(screen.getByText("Main Bar")).toBeVisible();
    expect(screen.getByText("Classic Milk Tea")).toBeVisible();

    const locationSelect = container.querySelector<HTMLSelectElement>("#pilot-square-location-10");
    expect(locationSelect).not.toBeNull();
    fireEvent.change(locationSelect!, { target: { value: "8" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save mapping" })[0]);

    await waitFor(() =>
      expect(mockApi.updatePilotSquareLocationMapping).toHaveBeenCalledWith({
        organizationId: 42,
        squareLocationId: 10,
        restaurantLocationId: 8,
      }),
    );

    const menuSelect = container.querySelector<HTMLSelectElement>("#pilot-square-menu-item-55");
    expect(menuSelect).not.toBeNull();
    fireEvent.change(menuSelect!, { target: { value: "901" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save mapping" })[1]);

    await waitFor(() =>
      expect(mockApi.updatePilotSquareCatalogMapping).toHaveBeenCalledWith({
        organizationId: 42,
        squareCatalogObjectId: 55,
        mappingType: "menu_item",
        flowtallyEntityType: "menu_item",
        flowtallyEntityId: "901",
        status: "mapped",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync locations" }));
    await waitFor(() => expect(mockApi.syncPilotSquareLocations).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("locations-sync completed.")).toBeVisible();
  });
});
