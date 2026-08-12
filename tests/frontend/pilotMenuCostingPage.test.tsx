import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PilotMenuCostingPage } from "../../src/pilot/PilotMenuCostingPage";

const menuMocks = vi.hoisted(() => ({
  fetchPilotMenuCosting: vi.fn(),
  fetchPilotInventory: vi.fn(),
  createPilotMenuItem: vi.fn(),
  updatePilotMenuItem: vi.fn(),
  deletePilotMenuItem: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", () => ({
  fetchPilotMenuCosting: menuMocks.fetchPilotMenuCosting,
  fetchPilotInventory: menuMocks.fetchPilotInventory,
  createPilotMenuItem: menuMocks.createPilotMenuItem,
  updatePilotMenuItem: menuMocks.updatePilotMenuItem,
  deletePilotMenuItem: menuMocks.deletePilotMenuItem,
}));

describe("PilotMenuCostingPage", () => {
  it("renders loaded menu costing data, incomplete warnings, and usage rows", async () => {
    menuMocks.fetchPilotInventory.mockResolvedValueOnce({
      items: [
        { id: 1, name: "Burger Beef", stockUnit: "kg" },
        { id: 2, name: "Burger Bun", stockUnit: "each" },
        { id: 3, name: "Burger Sauce", stockUnit: "each" },
      ],
    });
    menuMocks.fetchPilotMenuCosting.mockResolvedValueOnce({
      summary: {
        menuItemCount: 2,
        recipeCount: 1,
        mappedMenuItemCount: 1,
        salesUnits: 10,
        salesNetAmount: 150,
        recipeCost: 2.75,
        grossProfit: 12.25,
        inventoryVarianceCount: 1,
        estimatedCostVariance: -2.3,
        receivedPurchasesCount: 1,
        incompleteCostingCount: 1,
        incompleteUsageCount: 1,
        unmappedSalesCount: 1,
        openingCountSessionId: 11,
        latestCountSessionId: 12,
      },
      menuItems: [
        {
          id: 501,
          organizationId: 42,
          locationId: 7,
          name: "Burger",
          normalizedName: "burger",
          category: "Burgers",
          sellingPrice: 15,
          active: true,
          notes: "",
          recipe: {
            id: 601,
            organizationId: 42,
            locationId: 7,
            menuItemId: 501,
            notes: "",
            lineCount: 3,
            lines: [
              { id: 701, organizationId: 42, locationId: 7, recipeId: 601, inventoryItemId: 1, inventoryItemName: "Burger Beef", lineIndex: 0, ingredientName: "Burger Beef", quantity: 180, unit: "g", inventoryUnit: "kg", purchaseUnit: "kg", conversionFactor: 1, unitCost: 11.11, lineCost: 2, notes: "", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" },
              { id: 702, organizationId: 42, locationId: 7, recipeId: 601, inventoryItemId: 2, inventoryItemName: "Burger Bun", lineIndex: 1, ingredientName: "Burger Bun", quantity: 1, unit: "each", inventoryUnit: "each", purchaseUnit: "each", conversionFactor: 1, unitCost: 0.5, lineCost: 0.5, notes: "", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" },
              { id: 703, organizationId: 42, locationId: 7, recipeId: 601, inventoryItemId: 3, inventoryItemName: "Burger Sauce", lineIndex: 2, ingredientName: "Burger Sauce", quantity: 1, unit: "each", inventoryUnit: "each", purchaseUnit: "each", conversionFactor: 1, unitCost: 0.25, lineCost: 0.25, notes: "", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" },
            ],
            createdAt: "2026-08-12T00:00:00Z",
            updatedAt: "2026-08-12T00:00:00Z",
          },
          salesUnits: 10,
          salesNetAmount: 150,
          recipeCost: 2.75,
          grossProfit: 12.25,
          marginPercent: 81.7,
          foodCostPercent: 18.3,
          costingComplete: true,
          usageComplete: true,
          mappingStatus: "Mapped",
          squareCatalogObjectId: 9001,
          dataIssues: [],
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: "2026-08-12T00:00:00Z",
          updatedAt: "2026-08-12T00:00:00Z",
        },
        {
          id: 502,
          organizationId: 42,
          locationId: 7,
          name: "Plain Coffee",
          normalizedName: "plain coffee",
          category: "Drinks",
          sellingPrice: 3,
          active: true,
          notes: "",
          recipe: null,
          salesUnits: 0,
          salesNetAmount: 0,
          recipeCost: null,
          grossProfit: null,
          marginPercent: null,
          foodCostPercent: null,
          costingComplete: false,
          usageComplete: false,
          mappingStatus: "Unmapped",
          squareCatalogObjectId: null,
          dataIssues: ["Recipe missing", "Untracked ingredients", "Incomplete costing"],
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: "2026-08-12T00:00:00Z",
          updatedAt: "2026-08-12T00:00:00Z",
        },
      ],
      inventoryUsage: [
        {
          inventoryItemId: 1,
          inventoryItemName: "Burger Beef",
          stockUnit: "kg",
          referenceInventory: 10,
          referenceInventorySessionId: 11,
          referenceInventoryCompletedAt: "2026-07-10T08:00:00Z",
          receivedPurchases: 5,
          theoreticalUsage: 1.8,
          expectedInventory: 13.2,
          actualStockCount: 5.5,
          variance: -7.7,
          estimatedCostVariance: -85.46,
          latestCountSessionId: 12,
          latestCountCompletedAt: "2026-08-11T22:00:00Z",
          calculationComplete: true,
        },
      ],
      unmappedSales: [{ squareOrderId: "ORDER-UNMAPPED-1", squareItemVariationId: "VAR-FRIES", name: "Fries", quantity: 1, netAmount: 5 }],
      openingCountSession: { id: 11, organizationId: 42, locationId: 7, status: "Completed", countedBy: "Opening cashier", itemCount: 3, varianceTotal: 0, completedAt: "2026-07-10T08:00:00Z", updatedAt: "2026-07-10T08:00:00Z" },
      latestCountSession: { id: 12, organizationId: 42, locationId: 7, status: "Completed", countedBy: "Closing cashier", itemCount: 3, varianceTotal: -7.7, completedAt: "2026-08-11T22:00:00Z", updatedAt: "2026-08-11T22:00:00Z" },
      salesStartDate: "2026-07-13",
      salesEndDate: "2026-08-12",
    });

    render(<PilotMenuCostingPage />);

    expect(await screen.findByRole("heading", { name: "Sales, recipes, usage, and stock variance." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Burger" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Plain Coffee/ })).toBeVisible();
    expect(screen.getByText("Unmapped Square sales")).toBeVisible();
    expect(screen.getByText("Fries")).toBeVisible();
    expect(screen.getByText("1.8 kg")).toBeVisible();
    expect(screen.getByText("13.2 kg")).toBeVisible();
    expect(screen.getByText("5.5 kg")).toBeVisible();
    expect(screen.getByText("-7.7")).toBeVisible();
    expect(screen.getAllByText("18.3%")[0]).toBeVisible();
    expect(screen.getAllByText("81.7%")[0]).toBeVisible();

    expect(screen.getByRole("button", { name: /Plain Coffee.*Recipe missing - Untracked ingredients - Incomplete costing/ })).toBeVisible();
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });
});
