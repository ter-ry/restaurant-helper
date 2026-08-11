import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import {
  createPilotMenuCostingMenuItem,
  createPilotMenuCostingRecipe,
  createPilotMenuCostingRecipeIngredient,
  deletePilotMenuCostingMenuItem,
  deletePilotMenuCostingRecipe,
  deletePilotMenuCostingRecipeIngredient,
  fetchPilotInventory,
  fetchPilotMenuCosting,
  updatePilotMenuCostingMenuItem,
  updatePilotMenuCostingRecipe,
  updatePilotMenuCostingRecipeIngredient,
  type PilotInventoryItem,
  type PilotMenuCostingMenuItem,
  type PilotMenuCostingRecipe,
  type PilotMenuCostingRecipeIngredient,
  type PilotMenuCostingResponse,
} from "./pilotApi";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { usePilotSession } from "./PilotSessionProvider";
import { formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

interface RecipeDraft {
  id: number | null;
  name: string;
  description: string;
  yieldQuantity: number;
  yieldUnit: string;
  active: boolean;
  notes: string;
}

interface IngredientDraft {
  id: number | null;
  inventoryItemId: number | "";
  quantityRequired: number;
  unit: string;
  sortOrder: number;
  notes: string;
}

interface MenuItemDraft {
  id: number | null;
  name: string;
  category: string;
  recipeId: number | "";
  sellingPrice: number;
  active: boolean;
  notes: string;
}

const blankRecipeDraft = (): RecipeDraft => ({
  id: null,
  name: "",
  description: "",
  yieldQuantity: 1,
  yieldUnit: "servings",
  active: true,
  notes: "",
});

const blankIngredientDraft = (): IngredientDraft => ({
  id: null,
  inventoryItemId: "",
  quantityRequired: 1,
  unit: "each",
  sortOrder: 0,
  notes: "",
});

const blankMenuItemDraft = (): MenuItemDraft => ({
  id: null,
  name: "",
  category: "Other",
  recipeId: "",
  sellingPrice: 0,
  active: true,
  notes: "",
});

function draftFromRecipe(recipe: PilotMenuCostingRecipe): RecipeDraft {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    yieldQuantity: recipe.yieldQuantity,
    yieldUnit: recipe.yieldUnit,
    active: recipe.active,
    notes: recipe.notes,
  };
}

function draftFromIngredient(ingredient: PilotMenuCostingRecipeIngredient): IngredientDraft {
  return {
    id: ingredient.id,
    inventoryItemId: ingredient.inventoryItemId,
    quantityRequired: ingredient.quantityRequired,
    unit: ingredient.unit,
    sortOrder: ingredient.sortOrder,
    notes: ingredient.notes,
  };
}

function draftFromMenuItem(menuItem: PilotMenuCostingMenuItem): MenuItemDraft {
  return {
    id: menuItem.id,
    name: menuItem.name,
    category: menuItem.category,
    recipeId: menuItem.recipeId,
    sellingPrice: menuItem.sellingPrice,
    active: menuItem.active,
    notes: menuItem.notes,
  };
}

export function PilotMenuCostingPage() {
  const { currentLocation, organization } = usePilotSession();
  const [data, setData] = useState<PilotMenuCostingResponse | null>(null);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const [selectedIngredientId, setSelectedIngredientId] = useState<number | null>(null);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<number | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft>(blankRecipeDraft());
  const [ingredientDraft, setIngredientDraft] = useState<IngredientDraft>(blankIngredientDraft());
  const [menuItemDraft, setMenuItemDraft] = useState<MenuItemDraft>(blankMenuItemDraft());
  const [loading, setLoading] = useState(true);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [savingIngredient, setSavingIngredient] = useState(false);
  const [savingMenuItem, setSavingMenuItem] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [menuCosting, inventory] = await Promise.all([fetchPilotMenuCosting(), fetchPilotInventory()]);
      setData(menuCosting);
      setInventoryItems(inventory.items);
      if (selectedRecipeId === null && menuCosting.recipes[0]) {
        setSelectedRecipeId(menuCosting.recipes[0].id);
      }
      if (selectedMenuItemId === null && menuCosting.menuItems[0]) {
        setSelectedMenuItemId(menuCosting.menuItems[0].id);
      }
      if (!menuCosting.recipes.length) {
        setSelectedRecipeId(null);
        setSelectedIngredientId(null);
        setRecipeDraft(blankRecipeDraft());
      }
      if (!menuCosting.menuItems.length) {
        setSelectedMenuItemId(null);
        setMenuItemDraft(blankMenuItemDraft());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load menu costing.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recipes = useMemo(() => data?.recipes ?? [], [data?.recipes]);
  const menuItems = useMemo(() => data?.menuItems ?? [], [data?.menuItems]);
  const activeInventoryItems = inventoryItems.filter((item) => item.active);
  const selectedRecipe = useMemo(() => recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null, [recipes, selectedRecipeId]);
  const selectedMenuItem = useMemo(() => menuItems.find((menuItem) => menuItem.id === selectedMenuItemId) ?? null, [menuItems, selectedMenuItemId]);
  const selectedIngredient = useMemo(
    () => selectedRecipe?.ingredients.find((ingredient) => ingredient.id === selectedIngredientId) ?? null,
    [selectedIngredientId, selectedRecipe],
  );

  useEffect(() => {
    if (selectedRecipe) {
      setRecipeDraft(draftFromRecipe(selectedRecipe));
      setSelectedIngredientId(null);
      setIngredientDraft(blankIngredientDraft());
    }
  }, [selectedRecipe]);

  useEffect(() => {
    if (selectedIngredient) {
      setIngredientDraft(draftFromIngredient(selectedIngredient));
    } else if (selectedRecipe) {
      setIngredientDraft(blankIngredientDraft());
    }
  }, [selectedIngredient, selectedRecipe]);

  useEffect(() => {
    if (selectedMenuItem) {
      setMenuItemDraft(draftFromMenuItem(selectedMenuItem));
    } else {
      setMenuItemDraft(blankMenuItemDraft());
    }
  }, [selectedMenuItem]);

  const filteredRecipes = useMemo(
    () => recipes.filter((recipe) => `${recipe.name} ${recipe.description} ${recipe.yieldUnit}`.toLowerCase().includes(search.toLowerCase())),
    [recipes, search],
  );
  const filteredMenuItems = useMemo(
    () => menuItems.filter((menuItem) => `${menuItem.name} ${menuItem.category} ${menuItem.notes}`.toLowerCase().includes(search.toLowerCase())),
    [menuItems, search],
  );

  const saveRecipe = async () => {
    setSavingRecipe(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: recipeDraft.name,
        description: recipeDraft.description,
        yieldQuantity: recipeDraft.yieldQuantity,
        yieldUnit: recipeDraft.yieldUnit,
        active: recipeDraft.active,
        notes: recipeDraft.notes,
      };
      const saved = recipeDraft.id ? await updatePilotMenuCostingRecipe(recipeDraft.id, payload) : await createPilotMenuCostingRecipe(payload);
      setSelectedRecipeId(saved.id);
      setMessage(`Recipe ${saved.name} saved.`);
      await load();
      setSelectedRecipeId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recipe.");
    } finally {
      setSavingRecipe(false);
    }
  };

  const saveIngredient = async () => {
    if (!selectedRecipe) {
      return;
    }
    if (ingredientDraft.inventoryItemId === "") {
      setError("Choose an inventory item for the ingredient.");
      return;
    }

    setSavingIngredient(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        inventoryItemId: ingredientDraft.inventoryItemId,
        quantityRequired: ingredientDraft.quantityRequired,
        unit: ingredientDraft.unit,
        sortOrder: ingredientDraft.sortOrder,
        notes: ingredientDraft.notes,
      };
      const saved = selectedIngredientId
        ? await updatePilotMenuCostingRecipeIngredient(selectedRecipe.id, selectedIngredientId, payload)
        : await createPilotMenuCostingRecipeIngredient(selectedRecipe.id, payload);
      setMessage(`Recipe ingredients for ${saved.name} updated.`);
      setSelectedIngredientId(null);
      await load();
      setSelectedRecipeId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the ingredient.");
    } finally {
      setSavingIngredient(false);
    }
  };

  const saveMenuItem = async () => {
    if (menuItemDraft.recipeId === "") {
      setError("Choose a recipe for the menu item.");
      return;
    }

    setSavingMenuItem(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: menuItemDraft.name,
        category: menuItemDraft.category,
        recipeId: menuItemDraft.recipeId,
        sellingPrice: menuItemDraft.sellingPrice,
        active: menuItemDraft.active,
        notes: menuItemDraft.notes,
      };
      const saved = menuItemDraft.id ? await updatePilotMenuCostingMenuItem(menuItemDraft.id, payload) : await createPilotMenuCostingMenuItem(payload);
      setSelectedMenuItemId(saved.id);
      setMessage(`Menu item ${saved.name} saved.`);
      await load();
      setSelectedMenuItemId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the menu item.");
    } finally {
      setSavingMenuItem(false);
    }
  };

  const removeRecipe = async (recipe: PilotMenuCostingRecipe) => {
    if (!window.confirm(`Delete ${recipe.name}?`)) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await deletePilotMenuCostingRecipe(recipe.id);
      setMessage(`Recipe ${recipe.name} deleted.`);
      await load();
      setSelectedRecipeId(null);
      setRecipeDraft(blankRecipeDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the recipe.");
    }
  };

  const removeIngredient = async (ingredient: PilotMenuCostingRecipeIngredient) => {
    if (!selectedRecipe || !window.confirm("Delete this ingredient?")) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const saved = await deletePilotMenuCostingRecipeIngredient(selectedRecipe.id, ingredient.id);
      setMessage(`Ingredient removed from ${saved.name}.`);
      setSelectedIngredientId(null);
      await load();
      setSelectedRecipeId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the ingredient.");
    }
  };

  const removeMenuItem = async (menuItem: PilotMenuCostingMenuItem) => {
    if (!window.confirm(`Delete ${menuItem.name}?`)) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await deletePilotMenuCostingMenuItem(menuItem.id);
      setMessage(`Menu item ${menuItem.name} deleted.`);
      await load();
      setSelectedMenuItemId(null);
      setMenuItemDraft(blankMenuItemDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the menu item.");
    }
  };

  if (!currentLocation || !organization) {
    return (
      <div className="space-y-6">
        <Card className="p-6">
          <p className="text-sm text-muted">Menu costing needs an active organization and location before it can load.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Menu costing</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Recipe and menu pricing</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Live menu costing reads the current inventory price for each ingredient, so recipe and menu margins stay current as purchase prices change.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-muted shadow-soft">
          <div><span className="font-semibold text-ink">Organization:</span> {organization.name}</div>
          <div><span className="font-semibold text-ink">Location:</span> {currentLocation.name}</div>
        </div>
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted">Loading menu costing…</Card>
      ) : null}
      {error ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        </Card>
      ) : null}
      {message ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Recipes</p>
          <p className="mt-2 text-2xl font-bold text-ink">{recipes.length}</p>
          <p className="text-sm text-muted">{recipes.filter((recipe) => recipe.active).length} active recipes</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Menu items</p>
          <p className="mt-2 text-2xl font-bold text-ink">{menuItems.length}</p>
          <p className="text-sm text-muted">{menuItems.filter((item) => item.active).length} active menu items</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Inventory items</p>
          <p className="mt-2 text-2xl font-bold text-ink">{inventoryItems.length}</p>
          <p className="text-sm text-muted">{activeInventoryItems.length} active cost sources</p>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft">
          <Search className="h-4 w-4 text-muted" />
          <input
            className="w-full border-0 bg-transparent p-0 text-sm outline-none placeholder:text-slate-400"
            placeholder="Search recipes or menu items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} onClick={() => void load()} type="button">
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.25fr]">
        <Card className="p-5">
          <SectionHeader title="Recipes" description="Create a recipe, then attach the ingredient lines that drive its live cost." />
          {filteredRecipes.length ? (
            <div className="space-y-3">
              {filteredRecipes.map((recipe) => {
                const active = recipe.id === selectedRecipeId;
                return (
                  <button
                    key={recipe.id}
                    className={`w-full rounded-2xl border p-4 text-left transition ${active ? "border-brand-200 bg-brand-50" : "border-line bg-white hover:border-brand-100 hover:bg-brand-25"}`}
                    type="button"
                    onClick={() => setSelectedRecipeId(recipe.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{recipe.name}</p>
                        <p className="mt-1 text-sm text-muted">{recipe.description || "No description yet."}</p>
                      </div>
                      <Badge tone={recipe.active ? "success" : "neutral"}>{recipe.active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
                      <span>Yield {formatNumber(recipe.yieldQuantity)} {recipe.yieldUnit}</span>
                      <span>Cost {formatMoney(recipe.costPerYield)}</span>
                      <span>{recipe.ingredientCount} ingredients</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">No recipes yet. Add the first one on the right.</div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader
            title={recipeDraft.id ? "Edit recipe" : "New recipe"}
            description="Recipes stay linked to the current location and inherit live inventory costs."
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => { setSelectedRecipeId(null); setSelectedIngredientId(null); setRecipeDraft(blankRecipeDraft()); }} type="button" variant="secondary">New recipe</Button>}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink">Name</span>
              <input className="input mt-1" value={recipeDraft.name} onChange={(event) => setRecipeDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Yield unit</span>
              <input className="input mt-1" value={recipeDraft.yieldUnit} onChange={(event) => setRecipeDraft((current) => ({ ...current, yieldUnit: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Yield quantity</span>
              <input className="input mt-1" type="number" step="0.0001" value={recipeDraft.yieldQuantity} onChange={(event) => setRecipeDraft((current) => ({ ...current, yieldQuantity: Number(event.target.value || 0) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Active</span>
              <select className="input mt-1" value={recipeDraft.active ? "true" : "false"} onChange={(event) => setRecipeDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink">Description</span>
            <textarea className="input mt-1 min-h-24" value={recipeDraft.description} onChange={(event) => setRecipeDraft((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink">Notes</span>
            <textarea className="input mt-1 min-h-20" value={recipeDraft.notes} onChange={(event) => setRecipeDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => void saveRecipe()} type="button" disabled={savingRecipe}>
              {savingRecipe ? "Saving…" : recipeDraft.id ? "Update recipe" : "Create recipe"}
            </Button>
            {recipeDraft.id ? (
              <Button
                icon={<Trash2 className="h-4 w-4" />}
                type="button"
                variant="secondary"
                onClick={() => {
                  const recipe = recipes.find((candidate) => candidate.id === recipeDraft.id);
                  if (recipe) {
                    void removeRecipe(recipe);
                  }
                }}
              >
                Delete recipe
              </Button>
            ) : null}
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink">Ingredients</h3>
                <p className="mt-1 text-sm text-muted">Each line uses the current inventory price, so the recipe total stays current when supplier prices change.</p>
              </div>
              <Badge tone={selectedRecipe?.costAvailable ? "success" : "warning"}>{selectedRecipe?.costAvailable ? "Cost available" : "Cost needs review"}</Badge>
            </div>

            {selectedRecipe ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-ink">Inventory item</span>
                    <select className="input mt-1" value={ingredientDraft.inventoryItemId} onChange={(event) => setIngredientDraft((current) => ({ ...current, inventoryItemId: event.target.value ? Number(event.target.value) : "" }))}>
                      <option value="">Choose an inventory item</option>
                      {activeInventoryItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {item.stockUnit} @ {formatMoney(item.latestPurchasePrice)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-ink">Quantity required</span>
                    <input className="input mt-1" type="number" step="0.0001" value={ingredientDraft.quantityRequired} onChange={(event) => setIngredientDraft((current) => ({ ...current, quantityRequired: Number(event.target.value || 0) }))} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-ink">Unit</span>
                    <input className="input mt-1" value={ingredientDraft.unit} onChange={(event) => setIngredientDraft((current) => ({ ...current, unit: event.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-ink">Sort order</span>
                    <input className="input mt-1" type="number" value={ingredientDraft.sortOrder} onChange={(event) => setIngredientDraft((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-ink">Notes</span>
                  <textarea className="input mt-1 min-h-20" value={ingredientDraft.notes} onChange={(event) => setIngredientDraft((current) => ({ ...current, notes: event.target.value }))} />
                </label>
                <div className="flex flex-wrap gap-3">
                  <Button icon={<Plus className="h-4 w-4" />} onClick={() => void saveIngredient()} type="button" disabled={savingIngredient}>
                    {savingIngredient ? "Saving…" : selectedIngredientId ? "Update ingredient" : "Add ingredient"}
                  </Button>
                  {selectedIngredientId ? (
                    <Button variant="secondary" type="button" onClick={() => { setSelectedIngredientId(null); setIngredientDraft(blankIngredientDraft()); }}>
                      Cancel edit
                    </Button>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap gap-4">
                    <span>Recipe cost: <strong>{formatMoney(selectedRecipe.totalCost)}</strong></span>
                    <span>Per yield: <strong>{formatMoney(selectedRecipe.costPerYield)}</strong></span>
                    <span>Yield: <strong>{formatNumber(selectedRecipe.yieldQuantity)}</strong> {selectedRecipe.yieldUnit}</span>
                  </div>
                  {selectedRecipe.warnings.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900">
                      {selectedRecipe.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {selectedRecipe.ingredients.length ? (
                  <div className="space-y-2">
                    {selectedRecipe.ingredients.map((ingredient) => (
                      <div key={ingredient.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink">{ingredient.inventoryItem?.name ?? "Unknown item"}</p>
                            <p className="mt-1 text-sm text-muted">
                              {formatNumber(ingredient.quantityRequired)} {ingredient.unit} · {formatMoney(ingredient.lineCost)} line cost
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button variant="secondary" type="button" onClick={() => { setSelectedIngredientId(ingredient.id); setIngredientDraft(draftFromIngredient(ingredient)); }}>
                              Edit
                            </Button>
                            <Button variant="secondary" type="button" onClick={() => void removeIngredient(ingredient)} icon={<Trash2 className="h-4 w-4" />}>
                              Delete
                            </Button>
                          </div>
                        </div>
                        {ingredient.warnings.length ? (
                          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                            {ingredient.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Add the first ingredient to calculate the recipe cost.</div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Select a recipe to manage its ingredients.</div>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="Menu items" description="Link a menu item to a recipe so price and margin stay visible together." action={<Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => { setSelectedMenuItemId(null); setMenuItemDraft(blankMenuItemDraft()); }} type="button">New menu item</Button>} />
        <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
          <div className="space-y-3">
            {filteredMenuItems.length ? (
              filteredMenuItems.map((menuItem) => (
                <button
                  key={menuItem.id}
                  type="button"
                  className={`w-full rounded-2xl border p-4 text-left transition ${menuItem.id === selectedMenuItemId ? "border-brand-200 bg-brand-50" : "border-line bg-white hover:border-brand-100 hover:bg-brand-25"}`}
                  onClick={() => setSelectedMenuItemId(menuItem.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{menuItem.name}</p>
                      <p className="mt-1 text-sm text-muted">{menuItem.category}</p>
                    </div>
                    <Badge tone={statusTone(menuItem.costAvailable ? "complete" : "needs review")}>{menuItem.costAvailable ? "Cost ready" : "Needs review"}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
                    <span>Price {formatMoney(menuItem.sellingPrice)}</span>
                    <span>Cost {formatMoney(menuItem.recipeCostPerYield)}</span>
                    <span>Food cost {formatNumber(menuItem.foodCostPercent)}%</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No menu items yet.</div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-white p-4">
            <h3 className="text-base font-semibold text-ink">{menuItemDraft.id ? "Edit menu item" : "New menu item"}</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Name</span>
                <input className="input mt-1" value={menuItemDraft.name} onChange={(event) => setMenuItemDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Category</span>
                <input className="input mt-1" value={menuItemDraft.category} onChange={(event) => setMenuItemDraft((current) => ({ ...current, category: event.target.value }))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Recipe</span>
                <select className="input mt-1" value={menuItemDraft.recipeId} onChange={(event) => setMenuItemDraft((current) => ({ ...current, recipeId: event.target.value ? Number(event.target.value) : "" }))}>
                  <option value="">Choose a recipe</option>
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Selling price</span>
                <input className="input mt-1" type="number" step="0.01" value={menuItemDraft.sellingPrice} onChange={(event) => setMenuItemDraft((current) => ({ ...current, sellingPrice: Number(event.target.value || 0) }))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Active</span>
                <select className="input mt-1" value={menuItemDraft.active ? "true" : "false"} onChange={(event) => setMenuItemDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-ink">Notes</span>
              <textarea className="input mt-1 min-h-20" value={menuItemDraft.notes} onChange={(event) => setMenuItemDraft((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => void saveMenuItem()} type="button" disabled={savingMenuItem}>
                {savingMenuItem ? "Saving…" : menuItemDraft.id ? "Update menu item" : "Create menu item"}
              </Button>
              {menuItemDraft.id ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    const item = menuItems.find((candidate) => candidate.id === menuItemDraft.id);
                    if (item) {
                      void removeMenuItem(item);
                    }
                  }}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Delete menu item
                </Button>
              ) : null}
            </div>
            {selectedMenuItem ? (
              <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-700">
                <div className="flex flex-wrap gap-4">
                  <span>Recipe cost: <strong>{formatMoney(selectedMenuItem.recipeCostPerYield)}</strong></span>
                  <span>Food cost: <strong>{formatNumber(selectedMenuItem.foodCostPercent)}%</strong></span>
                  <span>Gross profit: <strong>{formatMoney(selectedMenuItem.grossProfit)}</strong></span>
                  <span>Margin: <strong>{formatNumber(selectedMenuItem.grossMarginPercent)}%</strong></span>
                </div>
                {selectedMenuItem.warnings.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900">
                    {selectedMenuItem.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
