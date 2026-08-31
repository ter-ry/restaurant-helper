import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotSquareUsagePage } from "../../src/pilot/PilotSquareUsagePage";

const mockApi = vi.hoisted(() => ({
  fetchSquareCatalogMappings: vi.fn(),
  fetchSquareUsage: vi.fn(),
  updateSquareCatalogMapping: vi.fn(),
  deleteSquareCatalogMapping: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    organization: { id: 42, name: "Variance Cafe" },
    currentLocation: { id: 7, name: "Line Kitchen" },
    locations: [{ id: 7, name: "Line Kitchen" }],
  }),
}));

vi.mock("../../src/lib/squareIntegration", async () => {
  const actual = (await vi.importActual("../../src/lib/squareIntegration")) as any;
  return {
    ...actual,
    fetchSquareCatalogMappings: mockApi.fetchSquareCatalogMappings,
    fetchSquareUsage: mockApi.fetchSquareUsage,
    updateSquareCatalogMapping: mockApi.updateSquareCatalogMapping,
    deleteSquareCatalogMapping: mockApi.deleteSquareCatalogMapping,
  };
});

describe("PilotSquareUsagePage", () => {
  beforeEach(() => {
    mockApi.fetchSquareCatalogMappings.mockResolvedValue({
      connection: {
        id: 1,
        organizationId: 42,
        organization: { id: 42, name: "Variance Cafe" },
        environment: "sandbox",
        squareMerchantId: "merchant-1",
        status: "connected",
        tokenExpiresAt: null,
        revokedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        syncError: "",
        catalogCount: 1,
        orderCount: 1,
        locationCount: 1,
        dailySalesCount: 1,
        locations: [],
        catalogObjects: [],
        orders: [],
        dailySales: [],
        syncJobs: [],
        webhookEvents: [],
      },
      menuItems: [{ id: 11, organizationId: 42, locationId: 7, recipeId: 21, name: "Classic Cheeseburger", normalizedName: "classic cheeseburger", category: "Burgers", sellingPrice: 18, active: true, notes: "", createdAt: null, updatedAt: null }],
      mappings: [],
      unmappedVariations: [
        {
          id: 1,
          squareCatalogObjectId: 501,
          squareObjectId: "VAR-1",
          squareObjectType: "ITEM_VARIATION",
          squareObjectName: "Classic Cheeseburger - Regular",
          squareItemName: "Classic Cheeseburger",
          isDeleted: false,
          soldUnits: 10,
          suggestedMenuItemId: 11,
          suggestedMenuItemName: "Classic Cheeseburger",
          mapping: null,
        },
      ],
      mappingCoverage: { mappedVariationCount: 0, totalVariationCount: 1, mappedPercent: 0 },
    });
    mockApi.fetchSquareUsage.mockResolvedValue({
      connection: {
        id: 1,
        organizationId: 42,
        organization: { id: 42, name: "Variance Cafe" },
        environment: "sandbox",
        squareMerchantId: "merchant-1",
        status: "connected",
        tokenExpiresAt: null,
        revokedAt: null,
        lastSyncAt: null,
        syncStatus: "idle",
        syncError: "",
        catalogCount: 1,
        orderCount: 1,
        locationCount: 1,
        dailySalesCount: 1,
        locations: [],
        catalogObjects: [],
        orders: [],
        dailySales: [],
        syncJobs: [],
        webhookEvents: [],
      },
      menuItems: [{ id: 11, organizationId: 42, locationId: 7, recipeId: 21, name: "Classic Cheeseburger", normalizedName: "classic cheeseburger", category: "Burgers", sellingPrice: 18, active: true, notes: "", createdAt: null, updatedAt: null }],
      mappings: [
        {
          id: 1,
          squareCatalogObjectId: 501,
          squareObjectId: "VAR-1",
          squareObjectType: "ITEM_VARIATION",
          squareObjectName: "Classic Cheeseburger - Regular",
          squareItemName: "Classic Cheeseburger",
          isDeleted: false,
          soldUnits: 10,
          suggestedMenuItemId: 11,
          suggestedMenuItemName: "Classic Cheeseburger",
          mapping: {
            id: 1,
            squareCatalogObjectId: 501,
            squareObjectId: "VAR-1",
            squareObjectType: "ITEM_VARIATION",
            squareObjectName: "Classic Cheeseburger - Regular",
            squareItemName: "Classic Cheeseburger",
            mappingType: "menu_item",
            flowtallyEntityType: "menu_item",
            flowtallyEntityId: "11",
            status: "mapped",
            mappedByUserId: 1,
            createdAt: null,
            updatedAt: null,
          },
        },
      ],
      unmappedVariations: [],
      mappingCoverage: { mappedVariationCount: 1, totalVariationCount: 1, mappedPercent: 100 },
      usage: {
        organizationId: 42,
        locationId: 7,
        period: { startAt: "2026-08-04T00:00", endAt: "2026-08-11T00:00" },
        coverage: {
          totalSoldUnits: 10,
          mappedSoldUnits: 10,
          calculableSoldUnits: 10,
          excludedUnmappedUnits: 0,
          excludedIncompleteUnits: 0,
          excludedCancelledUnits: 0,
          mappedSalesCoveragePercent: 100,
          calculableSalesCoveragePercent: 100,
          mappedVariationCount: 1,
          unmappedVariationCount: 0,
        },
        ingredientUsage: [
          {
            inventoryItemId: 201,
            inventoryItemName: "Beef",
            unit: "kg",
            currentOnHand: 20,
            theoreticalUsage: 1.8,
            soldMenuUnits: 10,
            contributingMenuItems: [
              { menuItemId: 11, menuItemName: "Classic Cheeseburger", soldUnits: 10, theoreticalUsage: 1.8, recipeId: 21, recipeYield: 1 },
            ],
            mappingStatus: "complete",
            actualUsage: 2.1,
            actualUsageBasis: {
              available: true,
              warnings: [],
              openingQuantity: 21.6,
              openingCountSessionId: 1,
              openingCountCompletedAt: "2026-08-04T00:00:00.000Z",
              closingQuantity: 19.5,
              closingCountSessionId: 2,
              closingCountCompletedAt: "2026-08-11T00:00:00.000Z",
              movementNet: 0,
              actualUsage: 2.1,
            },
            discrepancy: 0.3,
            discrepancyPercent: 16.7,
            warnings: [],
          },
        ],
        totals: { theoreticalUsage: 1.8, actualUsage: 2.1, discrepancy: 0.3, discrepancyPercent: 16.7 },
        contributingMenuItems: [{ menuItemId: 11, menuItemName: "Classic Cheeseburger", soldUnits: 10, recipeYield: 1, recipeYieldUnit: "servings", warnings: [] }],
        unmappedVariations: [],
        warnings: [],
      },
    });
  });

  it("shows usage variance and lets the owner map an unmapped variation", async () => {
    render(
      <MemoryRouter>
        <PilotSquareUsagePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Inventory usage and variance" })).toBeVisible();
    expect(screen.getByText("Sales coverage")).toBeVisible();
    expect(screen.getByText("Classic Cheeseburger - Regular")).toBeVisible();
    expect(screen.getByText("Beef")).toBeVisible();
    expect(screen.getAllByText("16.7%").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(mockApi.updateSquareCatalogMapping).toHaveBeenCalledTimes(1));
    expect(mockApi.updateSquareCatalogMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 42,
        squareCatalogObjectId: 501,
        flowtallyEntityId: "11",
        flowtallyEntityType: "menu_item",
        mappingType: "menu_item",
        status: "mapped",
      }),
    );
  });
});
