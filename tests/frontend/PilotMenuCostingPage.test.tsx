import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMenuCostingQuantity, PilotMenuCostingPage } from "../../src/pilot/PilotMenuCostingPage";

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
  it("preserves supported recipe quantity precision without trailing zeros", () => {
    expect([0.25, 0.125, 0.025, 0.001, 1, 4].map(formatMenuCostingQuantity)).toEqual(["0.25", "0.125", "0.025", "0.001", "1", "4"]);
  });

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
              unit: "kg",
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
                stockUnit: "kg",
                currentOnHand: 0,
                minQuantity: 0,
                parLevel: 0,
                preferredSupplierName: "",
                latestPurchasePrice: 4,
                averageUnitCost: 3.5,
                lastPurchaseUnit: "kg",
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
              inventoryItemCostPerStockUnit: 3.5,
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
        {
          id: 22,
          organizationId: 42,
          locationId: 7,
          recipeId: null,
          name: "Recipe Needed Item",
          normalizedName: "recipe needed item",
          category: "Breakfast",
          sellingPrice: 10,
          active: true,
          notes: "No recipe yet",
          recipe: null,
          recipeCostPerYield: null,
          grossProfit: null,
          foodCostPercent: 100,
          grossMarginPercent: null,
          costAvailable: false,
          warnings: ["Recipe needed"],
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
          stockUnit: "kg",
          currentOnHand: 0,
          minQuantity: 0,
          parLevel: 0,
          preferredSupplierName: "",
          latestPurchasePrice: 4,
          averageUnitCost: 3.5,
          lastPurchaseUnit: "kg",
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
    expect(screen.getByRole("heading", { name: "Menu Costing" })).toBeVisible();
    expect(screen.getAllByText("Cost $3.50").length).toBeGreaterThan(0);
    expect(screen.getByText("29.2%")).toBeVisible();
    expect(screen.queryByText("High cost")).not.toBeInTheDocument();
    expect(screen.getAllByText("Food cost 29.2%").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Item",
      "Category",
      "Price",
      "Cost",
      "Food cost",
      "Contribution",
      "Status",
    ]);
  });

  it("starts in browse mode and opens deliberate recipe and menu-item editors", async () => {
    render(<PilotMenuCostingPage />);

    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    expect(screen.getByText("Cheesy Toast")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
    expect(screen.getByRole("heading", { name: "New recipe" })).toBeVisible();
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Close New recipe" }));

    fireEvent.click(screen.getAllByText("Cheesy Toast")[0]);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Edit recipe" })).toBeVisible());
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Cheesy Toast");
    fireEvent.change(screen.getByRole("combobox", { name: "Inventory item" }), { target: { value: "101" } });
    expect(screen.getByDisplayValue("kg")).toBeVisible();
    expect(screen.getByText(/Cost basis:/)).toBeVisible();
    expect(screen.getByText(/Current inventory valuation/)).toBeVisible();
    expect(screen.getByText(/latest purchase cost is shown as a labeled estimate/)).toBeVisible();
    expect(
      screen.getByText((content) => content.includes("2 kg") && content.includes("$3.50/kg") && content.includes("ingredient cost")),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close Edit recipe" }));

    fireEvent.click(screen.getByRole("tab", { name: "Menu items" }));
    fireEvent.click(screen.getByRole("button", { name: "New menu item" }));
    expect(screen.getByRole("heading", { name: "New menu item" })).toBeVisible();
    expect(screen.getAllByLabelText("Name").at(-1)).toHaveValue("");
  });

  it("shows a non-persistent selling-price scenario and uses an accessible delete confirmation", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    expect(screen.getAllByText(/Cost unavailable/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Cost $0.00")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(-1)!);
    expect(await screen.findByRole("heading", { name: "Edit menu item" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Scenario selling price"), { target: { value: "15" } });
    expect(screen.getByText(/Food cost 23.3%/)).toBeVisible();
    expect(screen.getByText(/Contribution \$11.50/)).toBeVisible();
    expect(screen.getByText(/Scenario only/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete menu item" }));
    expect(screen.getByRole("heading", { name: "Confirm deletion" })).toBeVisible();
    expect(screen.getByText(/This cannot be undone/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Confirm deletion" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Edit menu item" }));
    fireEvent.click(screen.getByText("Recipe Needed Item"));
    expect(await screen.findByRole("heading", { name: "Edit menu item" })).toBeVisible();
    expect(screen.getByLabelText("Scenario selling price")).toHaveValue(null);
  });

  it("protects unsaved recipe edits when the editor is closed", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeVisible();
    fireEvent.change(screen.getAllByLabelText("Name")[0], { target: { value: "Changed locally" } });
    fireEvent.click(screen.getByRole("button", { name: "Close Edit recipe" }));
    expect(screen.getByRole("heading", { name: "Discard recipe changes?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByDisplayValue("Changed locally")).toBeVisible();
  });
});
