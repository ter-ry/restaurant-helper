import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMenuCostingQuantity, formatMenuCostingUnitCost, PilotMenuCostingPage } from "../../src/pilot/PilotMenuCostingPage";

const mockApi = vi.hoisted(() => ({
  fetchPilotMenuCosting: vi.fn(),
  fetchPilotInventory: vi.fn(),
  savePilotMenuCostingRecipe: vi.fn(),
  deletePilotMenuCostingRecipe: vi.fn(),
  updatePilotMenuCostingRecipeIngredient: vi.fn(),
  createPilotMenuCostingMenuItem: vi.fn(),
  updatePilotMenuCostingMenuItem: vi.fn(),
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
    savePilotMenuCostingRecipe: mockApi.savePilotMenuCostingRecipe,
    deletePilotMenuCostingRecipe: mockApi.deletePilotMenuCostingRecipe,
    createPilotMenuCostingRecipeIngredient: vi.fn(),
    updatePilotMenuCostingRecipeIngredient: mockApi.updatePilotMenuCostingRecipeIngredient,
    deletePilotMenuCostingRecipeIngredient: vi.fn(),
    createPilotMenuCostingMenuItem: mockApi.createPilotMenuCostingMenuItem,
    updatePilotMenuCostingMenuItem: mockApi.updatePilotMenuCostingMenuItem,
    deletePilotMenuCostingMenuItem: vi.fn(),
  };
});

describe("PilotMenuCostingPage", () => {
  it("preserves supported recipe quantity precision without trailing zeros", () => {
    expect([0.25, 0.125, 0.025, 0.001, 1, 4].map(formatMenuCostingQuantity)).toEqual(["0.25", "0.125", "0.025", "0.001", "1", "4"]);
  });

  it("keeps unit-cost precision without changing normal money formatting", () => {
    expect(formatMenuCostingUnitCost(12)).toBe("$12.00");
    expect(formatMenuCostingUnitCost(0.25)).toBe("$0.25");
    expect(formatMenuCostingUnitCost(0.0025)).toBe("$0.0025");
    expect(formatMenuCostingUnitCost(0)).toBe("$0.00");
    expect(formatMenuCostingUnitCost(null)).toBe("Cost unavailable");
  });

  beforeEach(() => {
    mockApi.savePilotMenuCostingRecipe.mockReset();
    mockApi.deletePilotMenuCostingRecipe.mockReset();
    mockApi.updatePilotMenuCostingRecipeIngredient.mockReset();
    mockApi.createPilotMenuCostingMenuItem.mockReset();
    mockApi.updatePilotMenuCostingMenuItem.mockReset();
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
        {
          id: 102,
          organizationId: 42,
          locationId: 7,
          supplierId: null,
          name: "Legacy Spice",
          normalizedName: "legacy spice",
          category: "Dry goods",
          stockUnit: "kg",
          currentOnHand: 0,
          minQuantity: 0,
          parLevel: 0,
          preferredSupplierName: "",
          latestPurchasePrice: 6,
          averageUnitCost: 5,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: null,
          estimatedCostMethod: "latest_purchase_price",
          active: false,
          notes: "Retired ingredient",
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
    expect(screen.getByRole("cell", { name: "Cost $3.50" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "Food cost 29.2%" })).toBeVisible();
    expect(screen.queryByText("High cost")).not.toBeInTheDocument();
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
    expect(screen.getByRole("combobox", { name: "Inventory item" })).toHaveValue("Cheese");
    expect(screen.getByLabelText("Quantity for ingredient 1")).toHaveValue("2");
    expect(screen.getByText(/Cost basis:/)).toBeVisible();
    expect(screen.getByText(/Current inventory valuation/)).toBeVisible();
    expect(screen.getByText(/latest purchase cost is shown as a labeled estimate/)).toBeVisible();
    expect(screen.getAllByText(/\$7\.00/).length).toBeGreaterThanOrEqual(1);

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
    expect(screen.queryByRole("cell", { name: /Cost Cost unavailable|Contribution Cost unavailable/ })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText("Scenario selling price")).toHaveValue("");
  });

  it("blocks unfinished menu-item recipe search but allows explicit no selection", async () => {
    const server = await mockApi.fetchPilotMenuCosting.mock.results[0].value;
    mockApi.updatePilotMenuCostingMenuItem.mockResolvedValue(server.menuItems[0]);
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(-1)!);
    expect(await screen.findByRole("heading", { name: "Edit menu item" })).toBeVisible();

    const recipe = screen.getByRole("combobox", { name: "Recipe" });
    fireEvent.change(recipe, { target: { value: "Che" } });
    fireEvent.change(screen.getByLabelText("Selling price"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Update menu item" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a recipe or select No selection");
    expect(mockApi.updatePilotMenuCostingMenuItem).not.toHaveBeenCalled();

    fireEvent.focus(recipe);
    fireEvent.click(screen.getByRole("option", { name: "No selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Update menu item" }));
    await waitFor(() => expect(mockApi.updatePilotMenuCostingMenuItem).toHaveBeenCalledWith(21, expect.objectContaining({ recipeId: null, sellingPrice: 13 })));
  });

  it("keeps ingredient drafts local, supports natural numeric typing, and searches inventory by keyboard", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    await screen.findByRole("heading", { name: "Edit recipe" });

    const quantity = screen.getByLabelText("Quantity for ingredient 1");
    fireEvent.change(quantity, { target: { value: "" } });
    expect(quantity).toHaveValue("");
    fireEvent.change(quantity, { target: { value: "0.25" } });
    expect(quantity).toHaveValue("0.25");

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    expect(screen.getAllByRole("combobox", { name: "Inventory item" })).toHaveLength(3);
    const newItem = screen.getAllByRole("combobox", { name: "Inventory item" })[1];
    fireEvent.focus(newItem);
    fireEvent.keyDown(newItem, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeVisible();
    fireEvent.keyDown(newItem, { key: "Enter" });
    expect(screen.getAllByLabelText("Unit")[1]).toHaveValue("kg");
  });

  it("does not save an old ingredient id when search text is not committed", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    await screen.findByRole("heading", { name: "Edit recipe" });

    const inventory = screen.getAllByRole("combobox", { name: "Inventory item" })[0];
    fireEvent.change(inventory, { target: { value: "Che" } });
    fireEvent.blur(inventory);
    expect(inventory).toHaveValue("Che");

    fireEvent.click(screen.getByRole("button", { name: "Save recipe and ingredients" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose an inventory item for each ingredient");
    expect(mockApi.savePilotMenuCostingRecipe).not.toHaveBeenCalled();
  });

  it("refreshes linked menu-item costing after deleting a recipe", async () => {
    const server = await mockApi.fetchPilotMenuCosting.mock.results[0].value;
    const reconciled = structuredClone(server);
    reconciled.recipes = [];
    reconciled.menuItems[0] = {
      ...reconciled.menuItems[0],
      recipeId: null,
      recipeCostPerYield: null,
      grossProfit: null,
      foodCostPercent: 100,
      grossMarginPercent: null,
      costAvailable: false,
      warnings: ["Recipe needed"],
    };
    mockApi.deletePilotMenuCostingRecipe.mockResolvedValue({ ok: true });
    mockApi.fetchPilotMenuCosting.mockReset();
    mockApi.fetchPilotMenuCosting.mockResolvedValueOnce(server).mockResolvedValueOnce(reconciled);

    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText("Recipe Cheesy Toast deleted.")).toBeVisible());
    expect(mockApi.fetchPilotMenuCosting).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("tab", { name: "Menu items" }));
    expect((await screen.findAllByText("Recipe needed")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Cost $3.50")).not.toBeInTheDocument();
  });

  it("resets the ingredient draft and baseline when closing an unchanged recipe editor", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close Edit recipe" }));
    expect(screen.queryByRole("heading", { name: "Discard recipe changes?" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
    expect(screen.getByRole("heading", { name: "New recipe" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Discard recipe changes?" })).not.toBeInTheDocument();
  });

  it("shows deleting progress and ignores a second click while a delete is in flight", async () => {
    const api = await import("../../src/pilot/pilotApi");
    let release: () => void = () => undefined;
    vi.mocked(api.deletePilotMenuCostingMenuItem).mockImplementation(() => new Promise((resolve) => { release = () => resolve(undefined as never); }));
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(-1)!);
    fireEvent.click(await screen.findByRole("button", { name: "Delete menu item" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const busy = await screen.findByRole("button", { name: "Deleting…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(api.deletePilotMenuCostingMenuItem).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm deletion" })).not.toBeInTheDocument());
    expect(api.deletePilotMenuCostingMenuItem).toHaveBeenCalledTimes(1);
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

  it("edits ingredient rows locally and saves them with the recipe", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeVisible();
    fireEvent.change(screen.getAllByLabelText("Name")[0], { target: { value: "Changed locally" } });

    const server = await mockApi.fetchPilotMenuCosting.mock.results[0].value;
    const updated = structuredClone(server);
    updated.recipes[0].ingredients[0].quantityRequired = 3;
    const savedRecipe = { ...updated.recipes[0], name: "Changed locally" };
    mockApi.savePilotMenuCostingRecipe.mockResolvedValue(savedRecipe);
    mockApi.fetchPilotMenuCosting.mockResolvedValue(updated);

    fireEvent.change(screen.getByLabelText("Quantity for ingredient 1"), { target: { value: "3" } });
    mockApi.fetchPilotMenuCosting.mockResolvedValue({ ...updated, recipes: [savedRecipe] });
    fireEvent.click(screen.getByRole("button", { name: "Save recipe and ingredients" }));
    await waitFor(() => expect(screen.getByText("Recipe Changed locally saved.")).toBeVisible());
    expect(mockApi.savePilotMenuCostingRecipe).toHaveBeenCalledWith(1, expect.objectContaining({ ingredients: expect.any(Array) }));
    expect(screen.getByDisplayValue("Changed locally")).toBeVisible();
  });

  it("locks ingredient controls while a save is pending", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast")[0]);
    expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Quantity for ingredient 1"), { target: { value: "3" } });

    const server = await mockApi.fetchPilotMenuCosting.mock.results.at(-1)!.value;
    const savedRecipe = structuredClone(server.recipes[0]);
    savedRecipe.ingredients[0].quantityRequired = 3;
    let resolveSave: (recipe: typeof savedRecipe) => void = () => undefined;
    mockApi.savePilotMenuCostingRecipe.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    mockApi.fetchPilotMenuCosting.mockResolvedValue({ ...server, recipes: [savedRecipe] });

    fireEvent.click(screen.getByRole("button", { name: "Save recipe and ingredients" }));
    expect(await screen.findByRole("button", { name: "Saving recipe…" })).toBeDisabled();
    expect(screen.getByLabelText("Quantity for ingredient 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add ingredient" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove ingredient 1" })).toBeDisabled();
    expect(screen.getByLabelText("Quantity for ingredient 1")).toHaveValue("3");

    resolveSave(savedRecipe);
    await waitFor(() => expect(screen.getByText("Recipe Cheesy Toast saved.")).toBeVisible());
    expect(screen.getByLabelText("Quantity for ingredient 1")).toHaveValue("3");
  });

  it("keeps a failed recipe-editor save editable", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    fireEvent.click(screen.getAllByText("Cheesy Toast").at(0)!);
    expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeVisible();
    fireEvent.change(screen.getAllByLabelText("Name")[0], { target: { value: "Recipe renamed" } });
    mockApi.savePilotMenuCostingRecipe.mockRejectedValue(new Error("Recipe save failed"));
    fireEvent.click(screen.getByRole("button", { name: "Save recipe and ingredients" }));
    await waitFor(() => expect(screen.getByText("Recipe save failed")).toBeVisible());
    expect(screen.getByDisplayValue("Recipe renamed")).toBeVisible();
  });

  it("labels a new menu item save as Create (not Assign recipe) and reports a failed save inside the open dialog", async () => {
    render(<PilotMenuCostingPage />);
    await screen.findByText("Menu costing");
    fireEvent.click(screen.getAllByRole("button", { name: /new menu item/i }).at(0)!);
    const dialog = await screen.findByRole("dialog");
    // With no recipe chosen the button still creates the menu item; it must not claim to assign a recipe.
    expect(within(dialog).queryByRole("button", { name: "Assign recipe" })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Selling price"), { target: { value: "0" } });
    mockApi.createPilotMenuCostingMenuItem.mockRejectedValue(new Error("Menu item save failed"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create menu item" }));
    // The page-level banner sits behind the dialog overlay, so the error must be announced inside it.
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Menu item save failed");
    expect(within(dialog).getByRole("button", { name: "Create menu item" })).toBeEnabled();
    expect(mockApi.createPilotMenuCostingMenuItem).toHaveBeenCalledTimes(1);
  });
});
