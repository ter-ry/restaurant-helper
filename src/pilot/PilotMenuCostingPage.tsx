import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotMenuItem,
  fetchPilotInventory,
  fetchPilotMenuCosting,
  type PilotInventoryItem,
  type PilotMenuCostingResponse,
  type PilotMenuItem,
  updatePilotMenuItem,
} from "./pilotApi";
import { formatMoney, formatNumber } from "./workspace/pilotWorkspaceUtils";

interface MenuRecipeLineDraft {
  localId: string;
  ingredientName: string;
  inventoryItemId: string;
  quantity: number;
  unit: string;
  inventoryUnit: string;
  purchaseUnit: string;
  conversionFactor: number;
  notes: string;
}

interface MenuItemDraft {
  id: number | null;
  name: string;
  category: string;
  sellingPrice: number;
  active: boolean;
  notes: string;
  recipeLines: MenuRecipeLineDraft[];
}

const editableFieldClass =
  "w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand-300 focus:ring-2 focus:ring-brand-100";

function newLine(seed?: Partial<MenuRecipeLineDraft>): MenuRecipeLineDraft {
  return {
    localId: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ingredientName: "",
    inventoryItemId: "",
    quantity: 1,
    unit: "each",
    inventoryUnit: "each",
    purchaseUnit: "each",
    conversionFactor: 1,
    notes: "",
    ...seed,
  };
}

function blankDraft(): MenuItemDraft {
  return {
    id: null,
    name: "",
    category: "Other",
    sellingPrice: 0,
    active: true,
    notes: "",
    recipeLines: [newLine()],
  };
}

function draftFromItem(item: PilotMenuItem): MenuItemDraft {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    sellingPrice: item.sellingPrice,
    active: item.active,
    notes: item.notes,
    recipeLines:
      item.recipe?.lines?.length
        ? item.recipe.lines.map((line) =>
            newLine({
              localId: String(line.id),
              ingredientName: line.ingredientName,
              inventoryItemId: line.inventoryItemId ? String(line.inventoryItemId) : "",
              quantity: line.quantity,
              unit: line.unit,
              inventoryUnit: line.inventoryUnit,
              purchaseUnit: line.purchaseUnit,
              conversionFactor: line.conversionFactor,
              notes: line.notes,
            }),
          )
        : [newLine()],
  };
}

function menuItemTone(item: PilotMenuItem) {
  if (item.dataIssues.includes("Recipe missing")) return "critical" as const;
  if (item.dataIssues.includes("Square mapping missing") || item.dataIssues.includes("Untracked ingredients")) return "warning" as const;
  if ((item.marginPercent ?? 0) < 55) return "orange" as const;
  return "success" as const;
}

function summarizeRecipe(item: PilotMenuItem) {
  if (!item.recipe?.lines?.length) {
    return "No recipe yet";
  }
  return `${formatNumber(item.recipe.lineCount)} lines - ${formatMoney(item.recipeCost)} cost`;
}

export function PilotMenuCostingPage() {
  const [data, setData] = useState<PilotMenuCostingResponse | null>(null);
  const [inventory, setInventory] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<MenuItemDraft>(blankDraft());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [menuResponse, inventoryResponse] = await Promise.all([fetchPilotMenuCosting(), fetchPilotInventory()]);
      setData(menuResponse);
      setInventory(inventoryResponse.items);
      if (selectedId === null && menuResponse.menuItems[0]) {
        setSelectedId(menuResponse.menuItems[0].id);
        setDraft(draftFromItem(menuResponse.menuItems[0]));
      } else if (selectedId !== null) {
        const nextSelected = menuResponse.menuItems.find((item) => item.id === selectedId);
        if (nextSelected) {
          setDraft(draftFromItem(nextSelected));
        }
      }
      if (selectedId === null && !menuResponse.menuItems.length) {
        setDraft(blankDraft());
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

  useEffect(() => {
    if (!data) return;
    if (selectedId === null) return;
    const selected = data.menuItems.find((item) => item.id === selectedId);
    if (selected) {
      setDraft(draftFromItem(selected));
    }
  }, [data, selectedId]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const items = data?.menuItems ?? [];
    if (!query) {
      return items;
    }
    return items.filter((item) => `${item.name} ${item.category} ${item.notes}`.toLowerCase().includes(query));
  }, [data?.menuItems, search]);

  const selectedItem = useMemo(() => data?.menuItems.find((item) => item.id === selectedId) ?? null, [data?.menuItems, selectedId]);

  const recipeUsageRows = useMemo(() => {
    if (!selectedItem?.recipe?.lines?.length) return [];
    return selectedItem.recipe.lines.map((line) => {
      const usage = data?.inventoryUsage.find((entry) => entry.inventoryItemId === line.inventoryItemId) ?? null;
      return {
        line,
        usage,
      };
    });
  }, [data?.inventoryUsage, selectedItem]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        name: draft.name,
        category: draft.category,
        sellingPrice: draft.sellingPrice,
        active: draft.active,
        notes: draft.notes,
        recipeLines: draft.recipeLines
          .filter((line) => line.ingredientName.trim() || line.inventoryItemId.trim())
          .map((line) => ({
            ingredientName: line.ingredientName,
            inventoryItemId: line.inventoryItemId ? Number(line.inventoryItemId) : null,
            quantity: line.quantity,
            unit: line.unit,
            inventoryUnit: line.inventoryUnit,
            purchaseUnit: line.purchaseUnit,
            conversionFactor: line.conversionFactor,
            notes: line.notes,
          })),
      };

      const response = draft.id === null ? await createPilotMenuItem(payload) : await updatePilotMenuItem(draft.id, payload);
      setData(response);
      const updated =
        draft.id === null
          ? response.menuItems.find((item) => item.name === draft.name && item.category === draft.category) ?? response.menuItems[0]
          : response.menuItems.find((item) => item.id === draft.id);
      if (updated) {
        setSelectedId(updated.id);
        setDraft(draftFromItem(updated));
      }
      setMessage(draft.id === null ? "Menu item created." : "Menu item updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the menu item.");
    } finally {
      setSaving(false);
    }
  };

  const selectItem = (item: PilotMenuItem) => {
    setSelectedId(item.id);
    setDraft(draftFromItem(item));
    setMessage(null);
    setError(null);
  };

  const createNew = () => {
    setSelectedId(null);
    setDraft(blankDraft());
    setMessage(null);
    setError(null);
  };

  const updateLine = (localId: string, patch: Partial<MenuRecipeLineDraft>) => {
    setDraft((current) => ({
      ...current,
      recipeLines: current.recipeLines.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    }));
  };

  const addLine = () => {
    setDraft((current) => ({ ...current, recipeLines: [...current.recipeLines, newLine()] }));
  };

  const removeLine = (localId: string) => {
    setDraft((current) => {
      const next = current.recipeLines.filter((line) => line.localId !== localId);
      return { ...current, recipeLines: next.length ? next : [newLine()] };
    });
  };

  const summary = data?.summary ?? {};
  const latestCountSession = data?.latestCountSession ?? null;

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Menu costing</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Sales, recipes, usage, and stock variance.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
              This workspace connects Square sales to menu items, then rolls recipe ingredients into theoretical usage and compares that against the latest stock count.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={createNew}>
              <Plus className="h-4 w-4" />
              New menu item
            </button>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void load()}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm leading-6 text-brand-900">{message}</div> : null}
        {loading ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted" aria-busy="true">
            Loading menu costing data...
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Menu items", value: formatNumber(summary.menuItemCount), helper: "Tracked items", tone: "info" as const },
            { label: "Recipes complete", value: formatNumber(summary.recipeCount), helper: "With at least one line", tone: "success" as const },
            { label: "Mapped items", value: formatNumber(summary.mappedMenuItemCount), helper: "Square-ready items", tone: "warning" as const },
            { label: "Variance rows", value: formatNumber(summary.inventoryVarianceCount), helper: "Latest count comparison", tone: "orange" as const },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
              <p className="mt-1 text-sm text-muted">{metric.helper}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.02fr_1.18fr]">
        <Card className="p-6">
          <SectionHeader title="Menu items" description={`Sales window ${data?.salesStartDate ?? "n/a"} to ${data?.salesEndDate ?? "n/a"}.`} />
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input className={editableFieldClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu items" />
          </div>
          <div className="space-y-2">
            {filteredItems.map((item) => (
              <button key={item.id} type="button" className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${selectedId === item.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`} onClick={() => selectItem(item)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                    <p className="mt-1 text-xs text-muted">{item.category}</p>
                  </div>
                  <Badge tone={menuItemTone(item)}>{item.mappingStatus}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted">
                  <div>
                    <p className="font-semibold text-ink">{formatMoney(item.sellingPrice)}</p>
                    <p>Selling price</p>
                  </div>
                  <div>
                    <p className="font-semibold text-ink">{formatMoney(item.recipeCost)}</p>
                    <p>Recipe cost</p>
                  </div>
                  <div>
                    <p className="font-semibold text-ink">{formatMoney(item.grossProfit)}</p>
                    <p>Gross profit</p>
                  </div>
                  <div>
                    <p className="font-semibold text-ink">{item.marginPercent === null ? "n/a" : `${formatNumber(item.marginPercent)}%`}</p>
                    <p>Margin</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted">{summarizeRecipe(item)}</p>
                {item.dataIssues.length ? <p className="mt-2 text-xs font-semibold text-amber-800">{item.dataIssues.join(" - ")}</p> : null}
              </button>
            ))}
            {!filteredItems.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No menu items match that search.</p> : null}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title={selectedItem ? selectedItem.name : "New menu item"} description="Edit the menu item and recipe in one pass." />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-ink">Menu item name</span>
                <input className={editableFieldClass} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Chicken Rice Bowl" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Category</span>
                <input className={editableFieldClass} value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Lunch bowls" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Selling price</span>
                <input className={editableFieldClass} type="number" min="0" step="0.01" value={draft.sellingPrice} onChange={(event) => setDraft((current) => ({ ...current, sellingPrice: Number(event.target.value) }))} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Active</span>
                <select className={editableFieldClass} value={draft.active ? "true" : "false"} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-ink">Notes</span>
              <textarea className={`${editableFieldClass} min-h-[92px]`} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Margin watchlist, batch prep notes, or Square mapping reminders." />
            </label>

            <div className="mt-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted">
                <Sparkles className="h-4 w-4 text-brand-700" />
                {selectedItem ? "Updating a persisted menu item." : "This will create a new persisted menu item."}
              </div>
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={saving} onClick={() => void save()}>
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save menu item"}
              </button>
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Recipe lines" description="Each line feeds the cost and theoretical usage calculation." />
            <div className="space-y-4">
              {draft.recipeLines.map((line, index) => (
                <div key={line.localId} className="rounded-3xl border border-line bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-ink">Line {index + 1}</p>
                    <button className="inline-flex items-center gap-1 text-xs font-semibold text-danger transition hover:text-red-700" type="button" onClick={() => removeLine(line.localId)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Ingredient name</span>
                      <input className={editableFieldClass} value={line.ingredientName} onChange={(event) => updateLine(line.localId, { ingredientName: event.target.value })} placeholder="Chicken breast" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Inventory item</span>
                      <select className={editableFieldClass} value={line.inventoryItemId} onChange={(event) => updateLine(line.localId, { inventoryItemId: event.target.value })}>
                        <option value="">Untracked ingredient</option>
                        {inventory.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} - {item.stockUnit}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Quantity</span>
                      <input className={editableFieldClass} type="number" min="0" step="0.0001" value={line.quantity} onChange={(event) => updateLine(line.localId, { quantity: Number(event.target.value) })} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Unit</span>
                      <input className={editableFieldClass} value={line.unit} onChange={(event) => updateLine(line.localId, { unit: event.target.value })} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Inventory unit</span>
                      <input className={editableFieldClass} value={line.inventoryUnit} onChange={(event) => updateLine(line.localId, { inventoryUnit: event.target.value })} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Purchase unit</span>
                      <input className={editableFieldClass} value={line.purchaseUnit} onChange={(event) => updateLine(line.localId, { purchaseUnit: event.target.value })} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Conversion factor</span>
                      <input className={editableFieldClass} type="number" min="0" step="0.0001" value={line.conversionFactor} onChange={(event) => updateLine(line.localId, { conversionFactor: Number(event.target.value) })} />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Line notes</span>
                      <input className={editableFieldClass} value={line.notes} onChange={(event) => updateLine(line.localId, { notes: event.target.value })} />
                    </label>
                  </div>
                  <div className="mt-3 text-xs text-muted">
                    Uses {formatNumber(line.quantity)} {line.unit} per sale. If the ingredient is tracked, the cost and stock variance will flow into the usage report.
                  </div>
                </div>
              ))}
            </div>
            <button className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={addLine}>
              <Plus className="h-4 w-4" />
              Add recipe line
            </button>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
        <Card className="p-6">
          <SectionHeader title="Ingredient usage and variance" description="Theoretical usage is based on Square sales over the current lookback window." />
          <div className="overflow-hidden rounded-3xl border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Ingredient</th>
                  <th className="px-4 py-3">Theoretical usage</th>
                  <th className="px-4 py-3">Expected inventory</th>
                  <th className="px-4 py-3">Actual count</th>
                  <th className="px-4 py-3">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {recipeUsageRows.map(({ line, usage }) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{line.inventoryItemName || line.ingredientName}</p>
                      <p className="text-xs text-muted">{line.quantity} {line.unit} per sale</p>
                    </td>
                    <td className="px-4 py-3 text-muted">{usage ? `${formatNumber(usage.theoreticalUsage)} ${usage.stockUnit}` : "0"}</td>
                    <td className="px-4 py-3 text-muted">{usage ? `${formatNumber(usage.expectedInventory)} ${usage.stockUnit}` : "-"}</td>
                    <td className="px-4 py-3 text-muted">{usage?.actualStockCount === null || usage?.actualStockCount === undefined ? "-" : `${formatNumber(usage.actualStockCount)} ${usage.stockUnit}`}</td>
                    <td className="px-4 py-3">
                      {usage?.variance === null || usage?.variance === undefined ? (
                        "-"
                      ) : (
                        <Badge tone={usage.variance < 0 ? "danger" : usage.variance > 0 ? "success" : "neutral"}>{formatNumber(usage.variance)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {!recipeUsageRows.length ? (
                  <tr>
                    <td className="px-4 py-6 text-sm text-muted" colSpan={5}>
                      Select a menu item with a recipe to see ingredient usage and variance.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Sales and count context" description="What drove the current costing snapshot." />
          <div className="space-y-3">
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Selected item</p>
              <p className="mt-1 text-lg font-bold text-ink">{selectedItem?.name ?? "No menu item selected"}</p>
              <p className="mt-1 text-sm text-muted">{selectedItem ? summarizeRecipe(selectedItem) : "Pick a menu item to inspect its sales and recipe chain."}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Sales units</p>
                <p className="mt-2 text-2xl font-bold text-ink">{selectedItem ? formatNumber(selectedItem.salesUnits) : "0"}</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Net sales</p>
                <p className="mt-2 text-2xl font-bold text-ink">{selectedItem ? formatMoney(selectedItem.salesNetAmount) : formatMoney(0)}</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Recipe cost</p>
                <p className="mt-2 text-2xl font-bold text-ink">{selectedItem ? formatMoney(selectedItem.recipeCost) : formatMoney(0)}</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Margin</p>
                <p className="mt-2 text-2xl font-bold text-ink">{selectedItem?.marginPercent === null || selectedItem?.marginPercent === undefined ? "n/a" : `${formatNumber(selectedItem.marginPercent)}%`}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Latest stock count</p>
              <p className="mt-1 text-sm text-ink">{latestCountSession ? `${latestCountSession.countedBy} - ${latestCountSession.itemCount} items - ${latestCountSession.varianceTotal} variance` : "No completed count session found."}</p>
              {latestCountSession ? <p className="mt-1 text-xs text-muted">Count session #{latestCountSession.id} completed on {latestCountSession.completedAt ?? latestCountSession.updatedAt ?? "the latest count date"}.</p> : null}
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Square sales coverage</p>
              <p className="mt-1 text-sm text-ink">{formatNumber(summary.mappedMenuItemCount)} mapped items, {formatNumber(summary.unmappedSalesCount)} unmapped sales lines.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
