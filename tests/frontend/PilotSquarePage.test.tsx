import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotSquarePage, squareConnectionDetail } from "../../src/pilot/PilotSquarePage";
import type { PilotMenuCostingResponse, PilotSquareConnectionSummary } from "../../src/pilot/pilotApi";

const mockApi = vi.hoisted(() => ({
  fetchPilotSquareStatus: vi.fn(),
  fetchPilotSquareCatalogMappings: vi.fn(),
  fetchPilotMenuCosting: vi.fn(),
  syncPilotSquareLocations: vi.fn(),
  syncPilotSquareCatalog: vi.fn(),
  syncPilotSquareOrders: vi.fn(),
  updatePilotSquareLocationMapping: vi.fn(),
  updatePilotSquareCatalogMapping: vi.fn(),
  disconnectPilotSquare: vi.fn(),
  beginPilotSquareConnection: vi.fn(),
  previewPilotSquareMenuImport: vi.fn(),
  importPilotSquareMenu: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({ demoReadOnly: false }));

vi.mock("../../src/pilot/pilotConfig", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotConfig")>("../../src/pilot/pilotConfig");
  return { ...actual, get demoReadOnly() { return configMocks.demoReadOnly; } };
});

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
    fetchPilotSquareCatalogMappings: mockApi.fetchPilotSquareCatalogMappings,
    fetchPilotMenuCosting: mockApi.fetchPilotMenuCosting,
    syncPilotSquareLocations: mockApi.syncPilotSquareLocations,
    syncPilotSquareCatalog: mockApi.syncPilotSquareCatalog,
    syncPilotSquareOrders: mockApi.syncPilotSquareOrders,
    updatePilotSquareLocationMapping: mockApi.updatePilotSquareLocationMapping,
    updatePilotSquareCatalogMapping: mockApi.updatePilotSquareCatalogMapping,
    disconnectPilotSquare: mockApi.disconnectPilotSquare,
    beginPilotSquareConnection: mockApi.beginPilotSquareConnection,
    previewPilotSquareMenuImport: mockApi.previewPilotSquareMenuImport,
    importPilotSquareMenu: mockApi.importPilotSquareMenu,
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

function createCatalogMappingResponse() {
  const mapping = {
    id: 55,
    squareCatalogObjectId: 55,
    squareObjectId: "VAR-TEST-BURGER-REGULAR",
    squareObjectType: "ITEM_VARIATION",
    squareObjectName: "Test Burger · Regular",
    squareItemName: "Test Burger",
    mappingType: "menu_item",
    flowtallyEntityType: "",
    flowtallyEntityId: "",
    status: "unmapped",
    mappedByUserId: null,
    createdAt: null,
    updatedAt: null,
  };
  return {
    connection: createConnectedConnection(),
    menuItems: [],
    mappings: [{ ...mapping, mapping: null, isDeleted: false, soldUnits: 0, suggestedMenuItemId: null, suggestedMenuItemName: "" }],
    unmappedVariations: [{ ...mapping, mapping: null, isDeleted: false, soldUnits: 0, suggestedMenuItemId: null, suggestedMenuItemName: "" }],
    mappingCoverage: { mappedVariationCount: 0, totalVariationCount: 1, mappedPercent: 0 },
  };
}

describe("PilotSquarePage", () => {
  beforeEach(() => {
    configMocks.demoReadOnly = false;
    mockApi.fetchPilotSquareStatus.mockReset();
    mockApi.fetchPilotSquareCatalogMappings.mockReset();
    mockApi.fetchPilotMenuCosting.mockReset();
    mockApi.syncPilotSquareLocations.mockReset();
    mockApi.syncPilotSquareCatalog.mockReset();
    mockApi.syncPilotSquareOrders.mockReset();
    mockApi.updatePilotSquareLocationMapping.mockReset();
    mockApi.updatePilotSquareCatalogMapping.mockReset();
    mockApi.disconnectPilotSquare.mockReset();
    mockApi.beginPilotSquareConnection.mockReset();
    mockApi.previewPilotSquareMenuImport.mockReset();
    mockApi.importPilotSquareMenu.mockReset();
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection: createDisconnectedConnection() });
    mockApi.fetchPilotSquareCatalogMappings.mockResolvedValue(createCatalogMappingResponse());
    mockApi.fetchPilotMenuCosting.mockResolvedValue(createMenuCosting());
    mockApi.syncPilotSquareLocations.mockResolvedValue({ connection: createConnectedConnection(), job: { id: 1, jobType: "locations", status: "completed", cursorJson: {} } });
    mockApi.syncPilotSquareCatalog.mockResolvedValue({ connection: createConnectedConnection(), job: { id: 2, jobType: "catalog", status: "completed", cursorJson: {} } });
    mockApi.syncPilotSquareOrders.mockResolvedValue({ connection: createConnectedConnection(), job: { id: 3, jobType: "orders", status: "completed", cursorJson: {} } });
    mockApi.updatePilotSquareLocationMapping.mockResolvedValue({ connection: createConnectedConnection() });
    mockApi.updatePilotSquareCatalogMapping.mockResolvedValue({ connection: createConnectedConnection() });
    mockApi.disconnectPilotSquare.mockResolvedValue({ connection: createDisconnectedConnection() });
    mockApi.previewPilotSquareMenuImport.mockResolvedValue({ locationId: 7, summary: { new: 1, mapped: 0, recipe_needed: 1, inactive: 0, conflict: 0 }, entries: [{ squareCatalogObjectId: 55, squareObjectId: "VAR-1", name: "Regular", parentName: "Test Burger", category: "Food", sellingPrice: 12, state: "recipe_needed", menuItemId: 901, isDeleted: false }] });
    mockApi.importPilotSquareMenu.mockResolvedValue({ locationId: 7, summary: { new: 0, mapped: 0, recipe_needed: 1, inactive: 0, conflict: 0 }, entries: [{ squareCatalogObjectId: 55, squareObjectId: "VAR-1", name: "Regular", parentName: "Test Burger", category: "Food", sellingPrice: 12, state: "recipe_needed", menuItemId: 901, isDeleted: false }], result: { imported: 1 } });
  });

  it("shows the disconnected controls and keeps sync actions disabled", async () => {
    render(
      <MemoryRouter>
        <PilotSquarePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Connection and sync" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect Square" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync locations" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Usage & Variance" })).toHaveAttribute("href", "/app/square-usage");
    expect(screen.getByText("Location mapping")).toBeVisible();
    expect(screen.getByText("Menu mapping")).toBeVisible();
    expect(screen.getByText("disconnected")).toBeVisible();
    expect(screen.getAllByText("Connection").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".square-status-card")).toHaveLength(5);
    expect(screen.queryByText("Private workspace for Square connection")).not.toBeInTheDocument();
    expect(screen.queryByText("pilot shell")).not.toBeInTheDocument();
  });

  it("keeps simulated wording and controls limited to read-only demo mode", async () => {
    configMocks.demoReadOnly = true;
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection: createConnectedConnection() });

    render(<MemoryRouter><PilotSquarePage /></MemoryRouter>);

    expect(await screen.findByText("Simulated Square connection for this public demo; no merchant account is connected.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect again" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Save mapping" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Save mapping" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Save mapping" })[1]).toBeDisabled();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getAllByRole("combobox")[0]).toBeDisabled();
    expect(screen.getAllByRole("combobox")[1]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review import" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByRole("button", { name: "Import menu" })).toBeDisabled();
  });

  it("uses connected-merchant wording outside demo mode", async () => {
    expect(squareConnectionDetail(true, false)).toBe("Connected Square merchant; imported sales are available.");
    expect(squareConnectionDetail(true, true)).toContain("Simulated Square connection");
  });

  it("supports connected status, sync, and menu/location mapping updates", async () => {
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection: createConnectedConnection() });

    const { container } = render(
      <MemoryRouter>
        <PilotSquarePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(screen.getByText("Connected Square merchant; imported sales are available.")).toBeVisible();
    expect(screen.queryByText("Simulated Square connection for this public demo; no merchant account is connected.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sync locations" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Save mapping" })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Save mapping" })[1]).toBeEnabled();
    expect(screen.getAllByRole("combobox")[0]).toBeEnabled();
    expect(screen.getAllByRole("combobox")[1]).toBeEnabled();
    expect(screen.getByRole("link", { name: "Usage & Variance" })).toHaveAttribute("href", "/app/square-usage");
    expect(screen.getByText("Main Bar")).toBeVisible();
    expect(screen.getByText("Classic Milk Tea")).toBeVisible();
    expect(screen.getByText("Test Burger · Regular")).toBeVisible();
    expect(document.querySelectorAll(".square-status-card")).toHaveLength(5);
    expect(screen.queryByText("ITEM · ITEM-55")).not.toBeInTheDocument();

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

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(mockApi.syncPilotSquareLocations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockApi.syncPilotSquareCatalog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockApi.syncPilotSquareOrders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockApi.fetchPilotSquareStatus).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Sync now completed.")).toBeVisible();
  });

  it("clears a stale connection error after a successful sync", async () => {
    const failedConnection = { ...createConnectedConnection(), syncError: "Square request failed (500)" };
    mockApi.fetchPilotSquareStatus
      .mockResolvedValueOnce({ connection: failedConnection })
      .mockResolvedValue({ connection: createConnectedConnection() });

    render(
      <MemoryRouter>
        <PilotSquarePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Square request failed (500)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("Sync now completed.")).toBeVisible();
    await waitFor(() => expect(screen.queryByText("Square request failed (500)")).not.toBeInTheDocument());
  });

  it("reviews and imports the Square menu without treating recipes as mapping targets", async () => {
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection: createConnectedConnection() });
    render(<MemoryRouter><PilotSquarePage /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Review import" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Review import" }));
    expect(await screen.findByText("Already imported / existing")).toBeVisible();
    expect(screen.getAllByText("Test Burger · Regular").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recipe needed").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Assign recipes in Menu Costing" })).toHaveAttribute("href", "/app/menu-costing");
    fireEvent.click(screen.getByRole("button", { name: "Import menu" }));
    await waitFor(() => expect(mockApi.importPilotSquareMenu).toHaveBeenCalledWith(42, 7));
  });

  it("renders imported transactions and keeps a resolved catalog mapping selected", async () => {
    const connection = createConnectedConnection();
    connection.orders = [{
      id: 701, squareOrderId: "ORDER-RECENT", squareLocationId: "SQ-10", restaurantLocationId: 7,
      orderState: "COMPLETED", currency: "CAD", grossAmount: 18, discountAmount: 0, taxAmount: 2,
      tipAmount: 0, refundAmount: 0, netAmount: 18, itemQuantity: 1, lineCount: 1,
      orderedAt: "2026-08-29T22:00:00.000Z", closedAt: "2026-08-29T22:05:00.000Z", cancelledAt: null,
      refundedAt: null, isDeleted: false, rawPayload: {},
      lines: [{ id: 1, lineUid: "line-1", lineIndex: 0, squareItemVariationId: "VAR-1", name: "Test Burger", quantity: 1, grossAmount: 18, discountAmount: 0, taxAmount: 2, tipAmount: 0, netAmount: 18, rawPayload: {} }],
    }];
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection });
    const response = createCatalogMappingResponse();
    const mappedRow = { ...response.mappings[0], mapping: { ...response.mappings[0], flowtallyEntityId: "901" } };
    mockApi.fetchPilotSquareCatalogMappings.mockResolvedValue({ ...response, mappings: [mappedRow], unmappedVariations: [mappedRow] });

    render(<MemoryRouter><PilotSquarePage /></MemoryRouter>);

    expect(await screen.findByText("Recent transactions")).toBeVisible();
    expect(screen.getByText(/Test Burger ×1/)).toBeVisible();
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("901");
  });

  it("shows only finalized Square orders in newest-first transaction history", async () => {
    const connection = createConnectedConnection();
    const order = (id: string, state: string, orderedAt: string, refundedAt: string | null = null) => ({
      id: Number(id.replace(/\D/g, "")) || 1, squareOrderId: id, squareLocationId: "SQ-10", restaurantLocationId: 7,
      orderState: state, currency: "CAD", grossAmount: 18, discountAmount: 0, taxAmount: 2, tipAmount: 0,
      refundAmount: refundedAt ? 18 : 0, netAmount: refundedAt ? 0 : 18, itemQuantity: 1, lineCount: 1,
      orderedAt, closedAt: orderedAt, cancelledAt: state === "CANCELED" ? orderedAt : null, refundedAt,
      isDeleted: false, rawPayload: {}, lines: [],
    });
    connection.orders = [
      order("ORDER-OPEN", "OPEN", "2026-08-29T23:00:00.000Z"),
      order("ORDER-DRAFT", "DRAFT", "2026-08-29T22:50:00.000Z"),
      order("ORDER-CANCELED", "CANCELED", "2026-08-29T22:30:00.000Z"),
      order("ORDER-REFUNDED", "COMPLETED", "2026-08-29T22:20:00.000Z", "2026-08-29T22:40:00.000Z"),
      order("ORDER-COMPLETED", "COMPLETED", "2026-08-29T22:10:00.000Z"),
    ];
    mockApi.fetchPilotSquareStatus.mockResolvedValue({ connection });

    const { container } = render(<MemoryRouter><PilotSquarePage /></MemoryRouter>);

    expect(await screen.findByText(/ORDER-CANCELED/)).toBeVisible();
    expect(screen.getByText(/ORDER-REFUNDED/)).toBeVisible();
    expect(screen.getByText(/ORDER-COMPLETED/)).toBeVisible();
    expect(screen.queryByText(/ORDER-OPEN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ORDER-DRAFT/)).not.toBeInTheDocument();
    const finalized = [...container.querySelectorAll("p")].filter((node) => /ORDER-(CANCELED|REFUNDED|COMPLETED)/.test(node.textContent || ""));
    expect(finalized.map((node) => node.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("ORDER-CANCELED"), expect.stringContaining("ORDER-REFUNDED"), expect.stringContaining("ORDER-COMPLETED")]));
    expect(finalized.findIndex((node) => node.textContent?.includes("ORDER-CANCELED"))).toBeLessThan(finalized.findIndex((node) => node.textContent?.includes("ORDER-REFUNDED")));
  });
});
