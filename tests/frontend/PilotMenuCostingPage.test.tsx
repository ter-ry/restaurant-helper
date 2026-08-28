import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotMenuCostingPage } from "../../src/pilot/PilotMenuCostingPage";

const mockApi = vi.hoisted(() => ({
  fetchPilotMenuCosting: vi.fn(),
  fetchPilotInventory: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    currentLocation: { id: 7, name: "Line Kitchen" },
    organization: { id: 42, name: "Menu Costing Cafe" },
  }),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual("../../src/pilot/pilotApi");
  return {
    ...actual,
    fetchPilotMenuCosting: mockApi.fetchPilotMenuCosting,
    fetchPilotInventory: mockApi.fetchPilotInventory,
    createPilotMenuCostingRecipe: vi.fn(),
    updatePilotMenuCostingRecipe: vi.fn(),
    deletePilotMenuCostingRecipe: vi.fn(),
    createPilotMenuCostingRecipeIngredient: vi.fn(),
    updatePilotMenuCostingRecipeIngredient: vi.fn(),
    deletePilotMenuCostingRecipeIngredient: vi.fn(),
    createPilotMenuCostingMenuItem: vi.fn(),
    updatePilotMenuCostingMenuItem: vi.fn(),
    deletePilotMenuCostingMenuItem: vi.fn(),
  };
});

describe("PilotMenuCostingPage", () => {
  beforeEach(() => {
    mockApi.fetchPilotMenuCosting.mockResolvedValue({
      organizationId: 42,
      locationId: 7,
      recipes: [
        {
          id: 1,
          organizationId: 42,
          locationId: 7,
          name: "Cheesy Toast",
          normalizedName: "cheesy toast",
          description: "Toasted bread with cheese",
          yieldQuantity: 2,
          yieldUnit: "servings",
          active: true,
          notes: "Pilot recipe",
          ingredientCount: 1,
          ingredients: [
            {
              id: 11,
              organizationId: 42,
              recipeId: 1,
              inventoryItemId: 101,
              quantityRequired: 2,
              unit: "each",
              notes: "Two portions of cheese",
              sortOrder: 1,
              inventoryItem: {
                id: 101,
                organizationId: 42,
                locationId: 7,
                supplierId: null,
                name: "Cheese",
                normalizedName: "cheese",
                category: "Dairy",
                stockUnit: "each",
                currentOnHand: 0,
                minQuantity: 0,
                parLevel: 0,
                preferredSupplierName: "",
                latestPurchasePrice: 4,
                averageUnitCost: 3.5,
                lastPurchaseUnit: "each",
                lastPurchaseConversionFactor: 2,
                lastReceivedAt: null,
                lastCountedAt: null,
                averageDailyUsage: null,
                estimatedCostMethod: "latest_purchase_price",
                active: true,
                notes: "",
                createdByUserId: null,
                updatedByUserId: null,
                createdAt: null,
                updatedAt: null,
              },
              inventoryItemCostPerStockUnit: 2,
              lineCost: 7,
              warnings: [],
              createdAt: null,
              updatedAt: null,
            },
          ],
          totalCost: 7,
          costPerYield: 3.5,
          costAvailable: true,
          warnings: [],
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      menuItems: [
        {
          id: 21,
          organizationId: 42,
          locationId: 7,
          recipeId: 1,
          name: "Cheesy Toast",
          normalizedName: "cheesy toast",
          category: "Breakfast",
          sellingPrice: 12,
          active: true,
          notes: "Pilot menu item",
          recipe: null,
          recipeCostPerYield: 3.5,
          grossProfit: 8.5,
          foodCostPercent: 29.2,
          grossMarginPercent: 70.8,
          costAvailable: true,
          warnings: [],
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
    });
    mockApi.fetchPilotInventory.mockResolvedValue({
      items: [
        {
          id: 101,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Cheese",
          normalizedName: "cheese",
          category: "Dairy",
          stockUnit: "each",
          currentOnHand: 0,
          minQuantity: 0,
          parLevel: 0,
          preferredSupplierName: "",
          latestPurchasePrice: 4,
          averageUnitCost: 3.5,
          lastPurchaseUnit: "each",
          lastPurchaseConversionFactor: 2,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: null,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      movements: [],
      countSessions: [],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {},
    });
  });

  it("renders live costing data from the API", async () => {
    render(<PilotMenuCostingPage />);

    expect(await screen.findByText("Menu costing")).toBeVisible();
    expect(screen.getAllByText("Cheesy Toast").length).toBeGreaterThan(0);
    expect(screen.getByText("Recipe and menu pricing")).toBeVisible();
    expect(screen.getByText("Live menu costing reads average inventory cost for each ingredient, so recipe and menu margins stay aligned with inventory valuation while latest purchase prices remain visible for supplier comparisons.")).toBeVisible();
    expect(screen.getAllByText("Cost $3.50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Food cost 29.2%").length).toBeGreaterThan(0);
    expect(screen.getByText("Line Kitchen")).toBeVisible();
  });

  it("starts in browse mode and opens deliberate recipe and menu-item editors", async () => {
    render(<PilotMenuCostingPage />);

    await screen.findByText("Menu costing");
    expect(screen.getByText("Start a new recipe or select one from the catalog to edit its ingredients and live costing.")).toBeVisible();
    expect(screen.getByText("Each line uses average inventory cost as the recipe basis. Latest purchase price stays visible for comparison when supplier costs change.")).toBeVisible();
    expect(screen.getByText("Start a new menu item or select one from the catalog to edit price, recipe linkage, and margin details.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
    expect(screen.getByRole("heading", { name: "New recipe" })).toBeVisible();
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("");

    fireEvent.click(screen.getAllByText("Cheesy Toast")[0]);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Edit recipe" })).toBeVisible());
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Cheesy Toast");
    expect(screen.getByText(/Cost basis:/)).toBeVisible();
    expect(screen.getByText(/Average inventory cost/)).toBeVisible();
    expect(screen.getByText(/Latest purchase price stays visible for comparison/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "New menu item" }));
    expect(screen.getByRole("heading", { name: "New menu item" })).toBeVisible();
    expect(screen.getAllByLabelText("Name").at(-1)).toHaveValue("");
  });
});
