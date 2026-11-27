import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import {
  createPilotMenuCostingMenuItem,
  createPilotMenuCostingRecipeIngredient,
  deletePilotMenuCostingMenuItem,
  deletePilotMenuCostingRecipe,
  deletePilotMenuCostingRecipeIngredient,
  fetchPilotInventory,
  fetchPilotMenuCosting,
  updatePilotMenuCostingMenuItem,
  savePilotMenuCostingRecipe,
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
import { CompactField, CompactFieldGroup } from "../components/CompactField";
import { Modal } from "../components/Modal";
import { SectionHeader } from "../components/SectionHeader";
import { usePilotSession } from "./PilotSessionProvider";
import { WorkspacePageHeader } from "./workspace/WorkspacePageHeader";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";
import { formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";
import { sortRows, type SortDirection } from "../components/DataTable";
import { SearchableSelect } from "../components/SearchableSelect";

interface RecipeDraft {
  id: number | null;
  name: string;
  description: string;
  yieldQuantity: string;
  yieldUnit: string;
  active: boolean;
  notes: string;
}

interface IngredientDraft {
  id: number | null;
  inventoryItemId: number | "";
  quantityRequired: string;
  unit: string;
  sortOrder: string;
  notes: string;
}

interface IngredientRowDraft extends IngredientDraft {
  key: string;
  isNew: boolean;
}

interface MenuItemDraft {
  id: number | null;
  name: string;
  category: string;
  recipeId: number | "";
  sellingPrice: string;
  active: boolean;
  notes: string;
}

type PendingDiscard = {
  title: string;
  message: string;
  confirm: () => void;
};

type SearchableOption = { id: number; label: string; detail?: string; stockUnit?: string };

function SearchableAutocomplete({
  label,
  options,
  value,
  onChange,
  placeholder,
  allowEmpty = false,
}: {
  label: string;
  options: SearchableOption[];
  value: number | "";
  onChange: (value: number | "") => void;
  placeholder: string;
  allowEmpty?: boolean;
}) {
  const selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const filtered = options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);

  useEffect(() => {
    setQuery(selected?.label ?? "");
  }, [selected?.id, selected?.label]);

  const choose = (option: SearchableOption | undefined) => {
    if (!option) return;
    onChange(option.id);
    setQuery(option.label);
    setOpen(false);
  };

  return (
    <label className="compact-field relative block min-w-0">
      <span className="compact-field-label">{label}</span>
      <input
        className="input mt-1 w-full"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-options`}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setHighlighted(0); if (!event.target.value && allowEmpty) onChange(""); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHighlighted((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0))); }
          if (event.key === "ArrowUp") { event.preventDefault(); setHighlighted((current) => Math.max(current - 1, 0)); }
          if (event.key === "Enter") { event.preventDefault(); choose(filtered[highlighted]); }
          if (event.key === "Escape") setOpen(false);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open ? (
        <div id={`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-options`} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-xl border border-line bg-white p-1 shadow-lg">
          {allowEmpty ? <button type="button" role="option" aria-selected={value === ""} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-slate-50" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(false); }}>No selection</button> : null}
          {filtered.length ? filtered.map((option, index) => (
            <button key={option.id} type="button" role="option" aria-selected={option.id === value} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${index === highlighted ? "bg-brand-50" : "hover:bg-slate-50"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
              <span className="block font-semibold text-ink">{option.label}</span>
              {option.detail ? <span className="block text-xs text-muted">{option.detail}</span> : null}
            </button>
          )) : <p className="px-3 py-2 text-sm text-muted">No matches</p>}
        </div>
      ) : null}
    </label>
  );
}

export function formatMenuCostingQuantity(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-CA", { useGrouping: false, maximumFractionDigits: 4 }).format(Number(value));
}

function formatCost(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value)) ? "Cost unavailable" : formatMoney(value);
}

export function formatMenuCostingUnitCost(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "Cost unavailable";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value));
}

const blankRecipeDraft = (): RecipeDraft => ({
  id: null,
  name: "",
  description: "",
  yieldQuantity: "1",
  yieldUnit: "servings",
  active: true,
  notes: "",
});

const blankIngredientDraft = (): IngredientDraft => ({
  id: null,
  inventoryItemId: "",
  quantityRequired: "1",
  unit: "each",
  sortOrder: "0",
  notes: "",
});

const blankMenuItemDraft = (): MenuItemDraft => ({
  id: null,
  name: "",
  category: "Other",
  recipeId: "",
  sellingPrice: "",
  active: true,
  notes: "",
});

function draftFromRecipe(recipe: PilotMenuCostingRecipe): RecipeDraft {
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    yieldQuantity: String(recipe.yieldQuantity),
    yieldUnit: recipe.yieldUnit,
    active: recipe.active,
    notes: recipe.notes,
  };
}

function draftFromIngredient(ingredient: PilotMenuCostingRecipeIngredient): IngredientDraft {
  return {
    id: ingredient.id,
    inventoryItemId: ingredient.inventoryItemId,
    quantityRequired: String(ingredient.quantityRequired),
    unit: ingredient.unit,
    sortOrder: String(ingredient.sortOrder),
    notes: ingredient.notes,
  };
}

function draftFromMenuItem(menuItem: PilotMenuCostingMenuItem): MenuItemDraft {
  return {
    id: menuItem.id,
    name: menuItem.name,
    category: menuItem.category,
    recipeId: menuItem.recipeId ?? "",
    sellingPrice: String(menuItem.sellingPrice),
    active: menuItem.active,
    notes: menuItem.notes,
  };
}

export function PilotMenuCostingPage() {
  const { currentLocation, organization } = usePilotSession();
  const [data, setData] = useState<PilotMenuCostingResponse | null>(null);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<number | null>(null);
  const [menuTab, setMenuTab] = useState<"recipes" | "menu-items">("menu-items");
  const [recipeEditorMode, setRecipeEditorMode] = useState<"hidden" | "create" | "edit">("hidden");
  const [menuItemEditorMode, setMenuItemEditorMode] = useState<"hidden" | "create" | "edit">("hidden");
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft>(blankRecipeDraft());
  const [ingredientDraft, setIngredientDraft] = useState<IngredientDraft>(blankIngredientDraft());
  const [ingredientRows, setIngredientRows] = useState<IngredientDraft[]>([]);
  const [menuItemDraft, setMenuItemDraft] = useState<MenuItemDraft>(blankMenuItemDraft());
  const [whatIfPrice, setWhatIfPrice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ kind: "recipe" | "ingredient" | "menu-item"; id: number; label: string } | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [savingIngredient, setSavingIngredient] = useState(false);
  const [savingMenuItem, setSavingMenuItem] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipeSort, setRecipeSort] = useState<{ key: "name" | "yield" | "cost" | "ingredients" | "status"; direction: SortDirection } | null>(null);
  const savingIngredientRef = useRef(false);
  const previousRecipeId = useRef<number | null>(null);
  const previousIngredientId = useRef<number | null>(null);
  const savedRecipeBaseline = useRef<RecipeDraft>(blankRecipeDraft());
  const savedIngredientBaseline = useRef<IngredientDraft[]>([]);
  const loadRequestId = useRef(0);

  const load = async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(null);

    try {
      const [menuCosting, inventory] = await Promise.all([fetchPilotMenuCosting(), fetchPilotInventory()]);
      if (requestId !== loadRequestId.current) return;
      setData(menuCosting);
      setInventoryItems(inventory.items);
      if (!menuCosting.recipes.length) {
        setSelectedRecipeId(null);
        setRecipeDraft(blankRecipeDraft());
        setIngredientRows([]);
        setRecipeEditorMode("hidden");
      }
      if (!menuCosting.menuItems.length) {
        setSelectedMenuItemId(null);
        setMenuItemDraft(blankMenuItemDraft());
        setMenuItemEditorMode("hidden");
      }
      setHasLoaded(true);
    } catch (err) {
      if (requestId !== loadRequestId.current) return;
      setError(err instanceof Error ? err.message : "Could not load menu costing.");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const recipes = useMemo(() => data?.recipes ?? [], [data?.recipes]);
  const menuItems = useMemo(() => data?.menuItems ?? [], [data?.menuItems]);
  const activeInventoryItems = inventoryItems.filter((item) => item.active);
  const initialLoading = loading && !hasLoaded;
  const averageFoodCost = useMemo(() => {
    const costReadyItems = menuItems.filter((item) => item.recipeId != null && item.costAvailable && Number.isFinite(Number(item.foodCostPercent)));
    if (!costReadyItems.length) {
      return null;
    }
    return costReadyItems.reduce((sum, item) => sum + Number(item.foodCostPercent), 0) / costReadyItems.length;
  }, [menuItems]);
  const selectedRecipe = useMemo(() => recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null, [recipes, selectedRecipeId]);
  const selectedMenuItem = useMemo(() => menuItems.find((menuItem) => menuItem.id === selectedMenuItemId) ?? null, [menuItems, selectedMenuItemId]);
  useEffect(() => {
    const recipeChanged = previousRecipeId.current !== (selectedRecipe?.id ?? null);
    if (selectedRecipe) {
      if (recipeChanged) {
        setRecipeDraft(draftFromRecipe(selectedRecipe));
        setIngredientRows(selectedRecipe.ingredients.map(draftFromIngredient));
        savedRecipeBaseline.current = draftFromRecipe(selectedRecipe);
        savedIngredientBaseline.current = selectedRecipe.ingredients.map(draftFromIngredient);
        setSelectedIngredientId(null);
        setIngredientDraft(blankIngredientDraft());
      }
      setRecipeEditorMode("edit");
    }
    previousRecipeId.current = selectedRecipe?.id ?? null;
  }, [selectedRecipe]);

  useEffect(() => {
    if (selectedMenuItem) {
      setMenuItemDraft(draftFromMenuItem(selectedMenuItem));
      setMenuItemEditorMode("edit");
      setWhatIfPrice("");
    } else {
      setMenuItemDraft(blankMenuItemDraft());
      setWhatIfPrice("");
    }
  }, [selectedMenuItem]);

  const filteredRecipes = useMemo(
    () => recipes.filter((recipe) => `${recipe.name} ${recipe.description} ${recipe.yieldUnit}`.toLowerCase().includes(search.toLowerCase())),
    [recipes, search],
  );
  const sortedRecipes = useMemo(() => {
    if (!recipeSort) return filteredRecipes;
    const getters = {
      name: (recipe: PilotMenuCostingRecipe) => recipe.name,
      yield: (recipe: PilotMenuCostingRecipe) => recipe.yieldQuantity,
      cost: (recipe: PilotMenuCostingRecipe) => recipe.costPerYield,
      ingredients: (recipe: PilotMenuCostingRecipe) => recipe.ingredientCount,
      status: (recipe: PilotMenuCostingRecipe) => (recipe.active ? "Active" : "Inactive"),
    } as const;
    return sortRows(filteredRecipes, getters[recipeSort.key], recipeSort.direction);
  }, [filteredRecipes, recipeSort]);
  const filteredMenuItems = useMemo(
    () => menuItems.filter((menuItem) => `${menuItem.name} ${menuItem.category} ${menuItem.notes}`.toLowerCase().includes(search.toLowerCase())),
    [menuItems, search],
  );
  const showRecipeEditor = recipeEditorMode !== "hidden" || selectedRecipeId !== null;
  const showMenuItemEditor = menuItemEditorMode !== "hidden" || selectedMenuItemId !== null;
  const recipeBaseline = savedRecipeBaseline.current;
  const ingredientBaseline = savedIngredientBaseline.current;
  const menuItemBaseline = selectedMenuItem ? draftFromMenuItem(selectedMenuItem) : blankMenuItemDraft();
  const recipeDirty = JSON.stringify(recipeDraft) !== JSON.stringify(recipeBaseline);
  const ingredientDirty = JSON.stringify(ingredientRows) !== JSON.stringify(ingredientBaseline);
  const menuItemDirty = JSON.stringify(menuItemDraft) !== JSON.stringify(menuItemBaseline);

  const closeRecipeEditor = () => {
    setSelectedRecipeId(null);
    setIngredientRows([]);
    setRecipeEditorMode("hidden");
  };

  const closeMenuItemEditor = () => {
    setSelectedMenuItemId(null);
    setMenuItemEditorMode("hidden");
  };

  const requestRecipeClose = () => {
    if (recipeDirty || ingredientDirty) {
      setPendingDiscard({ title: "Discard recipe changes?", message: "Unsaved recipe or ingredient changes will be lost.", confirm: closeRecipeEditor });
      return;
    }
    closeRecipeEditor();
  };

  const requestMenuItemClose = () => {
    if (menuItemDirty) {
      setPendingDiscard({ title: "Discard menu item changes?", message: "Unsaved menu item changes will be lost.", confirm: closeMenuItemEditor });
      return;
    }
    closeMenuItemEditor();
  };

  const openRecipe = (recipe: PilotMenuCostingRecipe) => {
    const open = () => { setError(null); setMessage(null); setSelectedRecipeId(recipe.id); setRecipeEditorMode("edit"); };
    if (recipeDirty || ingredientDirty) {
      setPendingDiscard({ title: "Discard recipe changes?", message: "Unsaved recipe or ingredient changes will be lost.", confirm: open });
      return;
    }
    open();
  };

  const openMenuItem = (menuItem: PilotMenuCostingMenuItem) => {
    const open = () => { setError(null); setMessage(null); setSelectedMenuItemId(menuItem.id); setMenuItemEditorMode("edit"); };
    if (menuItemDirty) {
      setPendingDiscard({ title: "Discard menu item changes?", message: "Unsaved menu item changes will be lost.", confirm: open });
      return;
    }
    open();
  };

  const startNewRecipe = () => {
    const open = () => { setError(null); setMessage(null); setSelectedRecipeId(null); setSelectedIngredientId(null); setIngredientRows([]); setRecipeDraft(blankRecipeDraft()); setRecipeEditorMode("create"); };
    if (recipeDirty || ingredientDirty) {
      setPendingDiscard({ title: "Discard recipe changes?", message: "Unsaved recipe or ingredient changes will be lost.", confirm: open });
      return;
    }
    open();
  };

  const startNewMenuItem = () => {
    const open = () => { setError(null); setMessage(null); setSelectedMenuItemId(null); setMenuItemDraft(blankMenuItemDraft()); setMenuItemEditorMode("create"); };
    if (menuItemDirty) {
      setPendingDiscard({ title: "Discard menu item changes?", message: "Unsaved menu item changes will be lost.", confirm: open });
      return;
    }
    open();
  };

  const applySavedRecipe = (saved: PilotMenuCostingRecipe, preserveIngredientRows = false) => {
    setData((current) => current ? { ...current, recipes: current.recipes.some((recipe) => recipe.id === saved.id) ? current.recipes.map((recipe) => recipe.id === saved.id ? saved : recipe) : [...current.recipes, saved] } : current);
    setSelectedRecipeId(saved.id);
    setRecipeEditorMode("edit");
    setRecipeDraft(draftFromRecipe(saved));
    if (!preserveIngredientRows) setIngredientRows(saved.ingredients.map(rowFromIngredient));
  };

  const saveRecipe = async () => {
    if (!recipeDraft.yieldQuantity.trim() || !Number.isFinite(Number(recipeDraft.yieldQuantity)) || Number(recipeDraft.yieldQuantity) <= 0) {
      setError("Yield quantity must be a finite value greater than zero.");
      return;
    }
    setSavingRecipe(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: recipeDraft.name,
        description: recipeDraft.description,
        yieldQuantity: Number(recipeDraft.yieldQuantity),
        yieldUnit: recipeDraft.yieldUnit,
        active: recipeDraft.active,
        notes: recipeDraft.notes,
      };
      const saved = await savePilotMenuCostingRecipe(recipeDraft.id, { ...payload, ingredients: ingredientRows });
      setRecipeDraft(draftFromRecipe(saved));
      setIngredientRows(saved.ingredients.map(draftFromIngredient));
      savedRecipeBaseline.current = draftFromRecipe(saved);
      savedIngredientBaseline.current = saved.ingredients.map(draftFromIngredient);
      setSelectedRecipeId(saved.id);
      setRecipeEditorMode("edit");
      setMessage(`Recipe ${saved.name} saved.`);
      setData((current) => current ? {
        ...current,
        recipes: current.recipes.some((recipe) => recipe.id === saved.id)
          ? current.recipes.map((recipe) => recipe.id === saved.id ? saved : recipe)
          : [...current.recipes, saved],
      } : current);
      void load();
      setSelectedRecipeId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recipe.");
    } finally {
      setSavingRecipe(false);
    }
  };

  const saveIngredientRow = async (row: IngredientRowDraft) => {
    if (!selectedRecipe) {
      return;
    }
    const quantityRequired = Number(row.quantityRequired);
    if (row.inventoryItemId === "") {
      setError("Choose an inventory item for the ingredient.");
      return;
    }
    if (!ingredientDraft.quantityRequired.trim() || !Number.isFinite(Number(ingredientDraft.quantityRequired)) || Number(ingredientDraft.quantityRequired) <= 0) {
      setError("Ingredient quantity must be a finite value greater than zero.");
      return;
    }

    if (savingIngredientRef.current) return;
    savingIngredientRef.current = true;
    setSavingIngredient(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        inventoryItemId: ingredientDraft.inventoryItemId,
        quantityRequired: Number(ingredientDraft.quantityRequired),
        unit: ingredientDraft.unit,
        sortOrder: ingredientDraft.sortOrder,
        notes: ingredientDraft.notes,
      };
      const saved = row.id
        ? await updatePilotMenuCostingRecipeIngredient(selectedRecipe.id, row.id, payload)
        : await createPilotMenuCostingRecipeIngredient(selectedRecipe.id, payload);
      setMessage(`Recipe ingredients for ${saved.name} updated.`);
      setSelectedIngredientId(null);
      void load();
      setSelectedRecipeId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the ingredient.");
    } finally {
      savingIngredientRef.current = false;
      setSavingIngredient(false);
    }
  };

  const updateIngredientRow = (index: number, patch: Partial<IngredientDraft>) => {
    setIngredientRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const addIngredientRow = () => setIngredientRows((rows) => [...rows, { ...blankIngredientDraft(), sortOrder: rows.length }]);

  const removeIngredientRow = (index: number) => setIngredientRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index).map((row, rowIndex) => ({ ...row, sortOrder: rowIndex })));

  const saveMenuItem = async () => {
    const sellingPrice = Number(menuItemDraft.sellingPrice);
    if (menuItemDraft.sellingPrice.trim() === "" || !Number.isFinite(sellingPrice) || sellingPrice < 0) {
      setError("Selling price must be a finite non-negative value.");
      return;
    }
    setSavingMenuItem(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: menuItemDraft.name,
        category: menuItemDraft.category,
        recipeId: menuItemDraft.recipeId || null,
        sellingPrice,
        active: menuItemDraft.active,
        notes: menuItemDraft.notes,
      };
      const saved = menuItemDraft.id ? await updatePilotMenuCostingMenuItem(menuItemDraft.id, payload) : await createPilotMenuCostingMenuItem(payload);
      setSelectedMenuItemId(saved.id);
      setMenuItemEditorMode("edit");
      setMessage(`Menu item ${saved.name} saved.`);
      void load();
      setSelectedMenuItemId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the menu item.");
    } finally {
      setSavingMenuItem(false);
    }
  };

  const removeRecipe = async (recipe: PilotMenuCostingRecipe) => {
    setError(null);
    setMessage(null);
    try {
      await deletePilotMenuCostingRecipe(recipe.id);
      setMessage(`Recipe ${recipe.name} deleted.`);
      void load();
      setSelectedRecipeId(null);
      setRecipeDraft(blankRecipeDraft());
      setRecipeEditorMode("hidden");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the recipe.");
    }
  };

  const removeIngredient = async (ingredient: PilotMenuCostingRecipeIngredient) => {
    if (!selectedRecipe) {
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const saved = await deletePilotMenuCostingRecipeIngredient(selectedRecipe.id, ingredient.id);
      setMessage(`Ingredient removed from ${saved.name}.`);
      setSelectedIngredientId(null);
      void load();
      setSelectedRecipeId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the ingredient.");
    }
  };

  const removeMenuItem = async (menuItem: PilotMenuCostingMenuItem) => {
    setError(null);
    setMessage(null);
    try {
      await deletePilotMenuCostingMenuItem(menuItem.id);
      setMessage(`Menu item ${menuItem.name} deleted.`);
      void load();
      setSelectedMenuItemId(null);
      setMenuItemDraft(blankMenuItemDraft());
      setMenuItemEditorMode("hidden");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the menu item.");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    const pending = pendingDelete;
    // Keep the confirmation open (and the Delete button disabled) until the server
    // call and the follow-up reload finish, so a double click cannot delete twice.
    setDeleting(true);
    try {
      if (pending.kind === "recipe") {
        const recipe = recipes.find((candidate) => candidate.id === pending.id);
        if (recipe) await removeRecipe(recipe);
      } else if (pending.kind === "ingredient") {
        const ingredient = selectedRecipe?.ingredients.find((candidate) => candidate.id === pending.id);
        if (ingredient) await removeIngredient(ingredient);
      } else {
        const menuItem = menuItems.find((candidate) => candidate.id === pending.id);
        if (menuItem) await removeMenuItem(menuItem);
      }
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  if (!currentLocation || !organization) {
    return (
      <div className="workspace-page">
        <Card className="workspace-card">
          <p className="text-sm text-muted">Menu costing needs an active organization and location before it can load.</p>
        </Card>
      </div>
    );
  }

  // While an editor dialog is open it covers the page-level banners, so show save errors/confirmations
  // inside the dialog (where the submit button is) instead of silently behind the overlay.
  const editorOpen = showRecipeEditor || showMenuItemEditor;
  const dialogFeedback = (
    <>
      {error ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div> : null}
      {message ? <div role="status" className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div> : null}
    </>
  );

  return (
    <div className="workspace-page">
      <WorkspacePageHeader
        eyebrow="Menu costing"
        title="Menu Costing"

        actions={
          <>

<button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void load()}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </>
        }
        className="pilot-menu-costing-header"
        metrics={[
          { label: "Menu items", value: hasLoaded ? formatNumber(menuItems.length) : "—", helper: "Sellable items" },
          { label: "Average food cost", value: hasLoaded && averageFoodCost != null ? `${formatNumber(averageFoodCost)}%` : "—", helper: "Across cost-ready items" },
          { label: "Recipe needed", value: hasLoaded ? formatNumber(menuItems.filter((item) => !item.recipeId).length) : "—", helper: "Assign or create a recipe" },
        ]}
      />

      {loading ? (
        <Card className="workspace-card text-sm text-muted">{initialLoading ? "Loading menu costing…" : "Refreshing menu costing…"}</Card>
      ) : null}
      {error && !editorOpen ? (
        <Card role="alert" className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div>
            <Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>Retry</Button>
          </div>
        </Card>
      ) : null}
      {message && !editorOpen ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</Card>
      ) : null}

      <div className="pilot-menu-costing-toolbar flex items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft">
          <Search className="h-4 w-4 text-muted" />
          <input
            className="w-full border-0 bg-transparent p-0 text-sm outline-none placeholder:text-slate-400"
            placeholder="Search recipes or menu items"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="pilot-menu-costing-tabs"><WorkspaceTabs
        tabs={[
          { id: "menu-items", label: "Menu items", badge: hasLoaded ? formatNumber(menuItems.length) : "—" },
          { id: "recipes", label: "Recipes", badge: hasLoaded ? formatNumber(recipes.length) : "—" },
        ]}
        value={menuTab}
        onChange={(value) => setMenuTab(value as "recipes" | "menu-items")}
      /></div>

      {menuTab === "recipes" ? (
      <div className="grid min-w-0 gap-5">
        <Card className={`order-1 min-w-0 p-4 ${filteredRecipes.length ? "" : "hidden"}`}>
              <SectionHeader
                title="Recipes"
                description="Create a recipe, then attach the ingredient lines that drive its live cost."
                action={<Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={startNewRecipe} type="button">New recipe</Button>}
              />
              {filteredRecipes.length ? (
            <div className="min-w-0 max-h-[28rem] overflow-auto rounded-xl border border-line">
              <table className="min-w-[680px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>{([['Name', 'name'], ['Yield', 'yield'], ['Cost', 'cost'], ['Ingredients', 'ingredients'], ['Status', 'status']] as const).map(([label, key]) => {
                    const active = recipeSort?.key === key;
                    return <th key={key} className="px-3 py-2" aria-sort={active ? (recipeSort?.direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" className="inline-flex items-center gap-1 font-bold" onClick={() => setRecipeSort((current) => current?.key !== key ? { key, direction: "asc" } : current.direction === "asc" ? { key, direction: "desc" } : null)}>{label}<span aria-hidden="true">{active ? (recipeSort?.direction === "asc" ? "▲" : "▼") : "↕"}</span></button></th>;
                  })}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sortedRecipes.map((recipe) => {
                    const active = recipe.id === selectedRecipeId;
                    return <tr key={recipe.id} className={active ? "bg-brand-50" : "bg-white hover:bg-brand-25"}>
                      <td className="px-3 py-2"><button type="button" className="text-left font-semibold text-ink" onClick={() => openRecipe(recipe)}>{recipe.name}<span className="mt-1 block text-xs font-normal text-muted">{recipe.description || "No description"}</span></button></td>
                      <td className="px-3 py-2 text-muted">{formatMenuCostingQuantity(recipe.yieldQuantity)} {recipe.yieldUnit}</td>
                      <td className="px-3 py-2 text-muted">{formatCost(recipe.costPerYield)}</td>
                      <td className="px-3 py-2 text-muted">{recipe.ingredientCount}</td>
                      <td className="px-3 py-2"><Badge tone={recipe.active ? "success" : "neutral"}>{recipe.active ? "Active" : "Inactive"}</Badge></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : initialLoading ? (
            <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">Loading recipes…</div>
          ) : !loading && hasLoaded ? (
            <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">No recipes yet. Add the first one on the right.</div>
          ) : null}
        </Card>

        {showRecipeEditor ? <Modal title={recipeDraft.id ? "Edit recipe" : recipeEditorMode === "create" ? "New recipe" : "Recipe editor"} size="large" onClose={requestRecipeClose}>
          {dialogFeedback}
          <SectionHeader
            title="Recipe details"
            description={recipeDraft.id ? "Recipes stay linked to the current location and inherit live inventory costs." : recipeEditorMode === "create" ? "Build the new recipe and save it deliberately." : "Select an existing recipe or start a new one."}
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={startNewRecipe} type="button" variant="secondary">New recipe</Button>}
          />
          {showRecipeEditor ? (
            <>
          <div className="grid gap-3 sm:grid-cols-4">
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
              <input className="input mt-1" type="number" min="0.0001" step="0.0001" value={recipeDraft.yieldQuantity} onChange={(event) => setRecipeDraft((current) => ({ ...current, yieldQuantity: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Active</span>
              <select className="input mt-1" value={recipeDraft.active ? "true" : "false"} onChange={(event) => setRecipeDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </CompactField>
          </div>
          <details className="compact-form compact-optional mt-3">
            <summary>Optional description and notes</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <CompactField label="Description">
                <input className="input" value={recipeDraft.description} onChange={(event) => setRecipeDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional description" />
              </CompactField>
              <CompactField label="Notes">
                <input className="input" value={recipeDraft.notes} onChange={(event) => setRecipeDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional notes" />
              </CompactField>
            </div>
          </details>
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
                    setPendingDelete({ kind: "recipe", id: recipe.id, label: recipe.name });
                  }
                }}
              >
                Delete recipe
              </Button>
            ) : null}
          </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-6 text-sm leading-6 text-muted">
              Start a new recipe or select one from the catalog to edit its ingredients and live costing.
            </div>
          )}

          <div className="mt-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-ink">Ingredients</h3>
                <p className="mt-1 text-sm text-muted">Each line uses the current inventory valuation. When weighted-average cost is unavailable, the latest purchase cost is shown as a labeled estimate.</p>
              </div>
              <Badge tone={selectedRecipe?.costAvailable ? "success" : "warning"}>{selectedRecipe?.costAvailable ? "Cost available" : "Cost needs review"}</Badge>
            </div>

            {selectedRecipe ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">Edit ingredients locally, then save the recipe once. Cost previews update as quantities change.</p>
                  <Button variant="secondary" icon={<Plus className="h-4 w-4" />} type="button" onClick={addIngredientRow} disabled={savingRecipe}>Add ingredient</Button>
                </div>
                {ingredientRows.length ? ingredientRows.map((row, index) => {
                  const item = inventoryItems.find((candidate) => candidate.id === row.inventoryItemId);
                  const selectableInventoryItems = activeInventoryItems.concat(item && !item.active ? [item] : []);
                  const previewUnitCost = item?.active && item.stockUnit.trim().toLowerCase() === row.unit.trim().toLowerCase()
                    ? Number(item.averageUnitCost ?? 0) > 0
                      ? Number(item.averageUnitCost)
                      : Number(item.latestPurchasePrice ?? 0) > 0 && Number(item.lastPurchaseConversionFactor ?? 0) > 0
                        ? Number(item.latestPurchasePrice) / Number(item.lastPurchaseConversionFactor)
                        : null
                    : null;
                  const lineCost = previewUnitCost == null ? null : previewUnitCost * Number(row.quantityRequired);
                  return <div key={row.id ?? `new-${index}`} className="grid items-end gap-2 rounded-xl border border-line bg-white p-2 sm:grid-cols-[minmax(0,2fr)_6rem_6rem_7rem_auto]">
                    <SearchableSelect label="Inventory item" value={row.inventoryItemId} options={selectableInventoryItems.map((candidate) => ({ value: candidate.id, label: `${candidate.name} · ${candidate.stockUnit}${candidate.active ? "" : " · inactive"}` }))} onChange={(value) => { const next = selectableInventoryItems.find((candidate) => candidate.id === value); updateIngredientRow(index, { inventoryItemId: value, unit: next?.stockUnit ?? row.unit }); }} placeholder="Search inventory" disabled={savingRecipe} />
                    <label><span className="sr-only">Quantity</span><input className="input w-full" aria-label={`Quantity for ingredient ${index + 1}`} type="number" min="0.0001" step="0.0001" value={row.quantityRequired} disabled={savingRecipe} onChange={(event) => updateIngredientRow(index, { quantityRequired: event.target.value })} /></label>
                    <label><span className="sr-only">Unit</span><input className="input w-full" aria-label={`Unit for ingredient ${index + 1}`} value={row.unit} disabled={savingRecipe} onChange={(event) => updateIngredientRow(index, { unit: event.target.value })} /></label>
                    <span className="pb-2 text-sm text-muted" aria-live="polite">{lineCost == null ? "Cost unavailable" : formatCost(lineCost)}</span>
                    <Button variant="secondary" type="button" aria-label={`Remove ingredient ${index + 1}`} onClick={() => removeIngredientRow(index)} disabled={savingRecipe}><Trash2 className="h-4 w-4" /></Button>
                  </div>;
                }) : <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Add the first ingredient to calculate the recipe cost.</div>}
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => void saveRecipe()} type="button" disabled={savingRecipe || recipeEditorMode === "create"}>
                  {savingRecipe ? "Saving recipe…" : "Save recipe and ingredients"}
                </Button>

                <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap gap-4">
                    <span>Cost basis: <strong>{selectedRecipe.ingredients.some((ingredient) => ingredient.costBasis === "latest_purchase") ? "Current valuation / latest purchase estimate" : "Current inventory valuation"}</strong></span>
                    <span>Recipe cost: <strong>{formatCost(selectedRecipe.totalCost)}</strong></span>
                    <span>Per yield: <strong>{formatCost(selectedRecipe.costPerYield)}</strong></span>
                    <span>Yield: <strong>{formatMenuCostingQuantity(selectedRecipe.yieldQuantity)}</strong> {selectedRecipe.yieldUnit}</span>
                  </div>
                  {selectedRecipe.warnings.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900">
                      {selectedRecipe.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Select a recipe to manage its ingredients.</div>
            )}
          </div>
        </Modal> : null}
      </div>
      ) : (
      <Card className="p-5">
        <SectionHeader title="Menu items" description="Link a menu item to a recipe so price and margin stay visible together." action={<Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={startNewMenuItem} type="button">New menu item</Button>} />
        <div className="grid gap-5">
          <div className="workspace-table-wrap max-h-[32rem] overflow-auto">
            {filteredMenuItems.length ? (
              <table className="min-w-[760px] text-left text-sm">
                <thead><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Cost</th><th className="px-3 py-2">Food cost</th><th className="px-3 py-2">Contribution</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody>
                  {filteredMenuItems.map((menuItem) => (
                    <tr key={menuItem.id} tabIndex={0} className={`cursor-pointer border-b border-line transition hover:bg-brand-50/60 ${menuItem.id === selectedMenuItemId ? "bg-brand-50" : "bg-white"}`} onClick={() => openMenuItem(menuItem)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMenuItem(menuItem); } }}>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink">{menuItem.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{menuItem.category}</td>
                      <td aria-label={`Price ${formatMoney(menuItem.sellingPrice)}`} className="whitespace-nowrap px-3 py-2">{formatMoney(menuItem.sellingPrice)}</td>
                      <td aria-label={`Cost ${menuItem.recipeCostPerYield == null || !Number.isFinite(Number(menuItem.recipeCostPerYield)) ? "unavailable" : formatCost(menuItem.recipeCostPerYield)}`} className="whitespace-nowrap px-3 py-2">{menuItem.recipeCostPerYield == null || !Number.isFinite(Number(menuItem.recipeCostPerYield)) ? formatCost(null) : formatCost(menuItem.recipeCostPerYield)}</td>
                      <td aria-label={`Food cost ${menuItem.foodCostPercent == null ? "Unavailable" : `${formatNumber(menuItem.foodCostPercent)}%`}`} className="whitespace-nowrap px-3 py-2">{menuItem.foodCostPercent == null ? "Unavailable" : `${formatNumber(menuItem.foodCostPercent)}%`}</td>
                      <td aria-label={`Contribution ${menuItem.grossProfit == null || !Number.isFinite(Number(menuItem.grossProfit)) ? "unavailable" : formatCost(menuItem.grossProfit)}`} className="whitespace-nowrap px-3 py-2">{menuItem.grossProfit == null || !Number.isFinite(Number(menuItem.grossProfit)) ? "Unavailable" : formatCost(menuItem.grossProfit)}</td>
                      <td className="whitespace-nowrap px-3 py-2"><Badge tone={menuItem.recipeId == null ? "warning" : statusTone(menuItem.costAvailable ? "complete" : "needs review")}>{menuItem.recipeId == null ? "Recipe needed" : menuItem.costAvailable ? "Cost available" : "Needs review"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : initialLoading ? (
              <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Loading menu items…</div>
            ) : !loading && hasLoaded ? (
              <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No menu items yet.</div>
            ) : null}
          </div>
          {showMenuItemEditor ? <Modal title={menuItemDraft.id ? "Edit menu item" : menuItemEditorMode === "create" ? "New menu item" : "Menu item editor"} size="large" onClose={requestMenuItemClose}>
            {dialogFeedback}
            <div className="compact-form mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_8rem]">
              <CompactField label="Name">
                <input className="input" value={menuItemDraft.name} onChange={(event) => setMenuItemDraft((current) => ({ ...current, name: event.target.value }))} />
              </CompactField>
              <CompactField label="Category">
                <input className="input" value={menuItemDraft.category} onChange={(event) => setMenuItemDraft((current) => ({ ...current, category: event.target.value }))} />
              </CompactField>
              <SearchableAutocomplete label="Recipe" options={recipes.map((recipe) => ({ id: recipe.id, label: recipe.name, detail: `${formatMenuCostingQuantity(recipe.yieldQuantity)} ${recipe.yieldUnit}` }))} value={menuItemDraft.recipeId} allowEmpty onChange={(recipeId) => setMenuItemDraft((current) => ({ ...current, recipeId }))} placeholder="Search recipes" />
              <CompactField label="Selling price">
                <input className="input" inputMode="decimal" type="text" value={menuItemDraft.sellingPrice} onChange={(event) => setMenuItemDraft((current) => ({ ...current, sellingPrice: event.target.value }))} />
              </CompactField>
              <CompactField label="Status">
                <select className="input" value={menuItemDraft.active ? "true" : "false"} onChange={(event) => setMenuItemDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </CompactField>
            </div>
            <details className="compact-form compact-optional mt-3">
              <summary>Optional menu item notes</summary>
              <CompactField className="mt-2" label="Notes">
                <input className="input" value={menuItemDraft.notes} onChange={(event) => setMenuItemDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional notes" />
              </CompactField>
            </details>
            {showMenuItemEditor ? (
              <>
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
                      setPendingDelete({ kind: "menu-item", id: item.id, label: item.name });
                    }
                  }}
                  icon={<Trash2 className="h-4 w-4" />}
                >
                  Delete menu item
                </Button>
              ) : null}
            </div>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-line bg-slate-50 p-6 text-sm leading-6 text-muted">
                Start a new menu item or select one from the catalog to edit price, recipe linkage, and margin details.
              </div>
            )}
            {selectedMenuItem ? (
              <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-700">
                <div className="flex flex-wrap gap-4">
                  <span>Ingredient cost: <strong>{formatCost(selectedMenuItem.recipeCostPerYield)}</strong></span>
                  <span>Food cost: <strong>{selectedMenuItem.foodCostPercent == null ? "Unavailable" : `${formatNumber(selectedMenuItem.foodCostPercent)}%`}</strong></span>
                  <span>Contribution: <strong>{formatCost(selectedMenuItem.grossProfit)}</strong></span>
                  <span>Ingredient margin: <strong>{selectedMenuItem.grossMarginPercent == null ? "Unavailable" : `${formatNumber(selectedMenuItem.grossMarginPercent)}%`}</strong></span>
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-3">
                  <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-muted">Scenario selling price</span><input className="input mt-1 w-40" type="number" min="0" step="0.01" value={whatIfPrice} onChange={(event) => setWhatIfPrice(event.target.value)} placeholder="Optional" /></label>
                  {whatIfPrice !== "" ? <div className="text-sm text-muted">{(selectedMenuItem.recipeCostPerYieldExact ?? selectedMenuItem.recipeCostPerYield) == null || !Number.isFinite(Number(whatIfPrice)) || Number(whatIfPrice) <= 0 ? "Scenario cost unavailable" : `Food cost ${formatNumber(((selectedMenuItem.recipeCostPerYieldExact ?? selectedMenuItem.recipeCostPerYield)! / Number(whatIfPrice)) * 100)}% · Contribution ${formatMoney(Number(whatIfPrice) - (selectedMenuItem.recipeCostPerYieldExact ?? selectedMenuItem.recipeCostPerYield)!)} · Scenario only`}</div> : null}
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
          </Modal> : null}
        </div>
      </Card>
      )}
      {pendingDelete ? <Modal title="Confirm deletion" size="small" onClose={() => { if (!deleting) setPendingDelete(null); }}><p className="text-sm leading-6 text-muted">Delete {pendingDelete.label}? This cannot be undone.</p><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" type="button" disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</Button><Button variant="primary" className="bg-rose-700 hover:bg-rose-800" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Delete"}</Button></div></Modal> : null}
      {pendingDiscard ? <Modal title={pendingDiscard.title} size="small" onClose={() => setPendingDiscard(null)}><p className="text-sm leading-6 text-muted">{pendingDiscard.message}</p><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setPendingDiscard(null)}>Keep editing</Button><Button variant="primary" type="button" onClick={() => { const confirm = pendingDiscard.confirm; setPendingDiscard(null); confirm(); }}>Discard changes</Button></div></Modal> : null}
    </div>
  );
}
