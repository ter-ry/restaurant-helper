import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, RefreshCcw, Scale, Search, SquarePen, Truck } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotInventoryAdjustment,
  createPilotInventoryItem,
  fetchPilotInventory,
  type PilotCountSession,
  type PilotInventoryItem,
  type PilotInventoryResponse,
  updatePilotInventoryItem,
} from "./pilotApi";
import { formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

interface InventoryDraft {
  id: number | null;
  name: string;
  category: string;
  stockUnit: string;
  currentOnHand: number;
  minQuantity: number;
  parLevel: number;
  preferredSupplierName: string;
  latestPurchasePrice: number;
  averageDailyUsage: number;
  notes: string;
  active: boolean;
}

function blankDraft(): InventoryDraft {
  return {
    id: null,
    name: "",
    category: "Other",
    stockUnit: "each",
    currentOnHand: 0,
    minQuantity: 0,
    parLevel: 0,
    preferredSupplierName: "",
    latestPurchasePrice: 0,
    averageDailyUsage: 0,
    notes: "",
    active: true,
  };
}

function draftFromItem(item: PilotInventoryItem): InventoryDraft {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    stockUnit: item.stockUnit,
    currentOnHand: item.currentOnHand,
    minQuantity: item.minQuantity,
    parLevel: item.parLevel,
    preferredSupplierName: item.preferredSupplierName,
    latestPurchasePrice: item.latestPurchasePrice,
    averageDailyUsage: item.averageDailyUsage ?? 0,
    notes: item.notes,
    active: item.active,
  };
}

function stockStatus(item: Pick<PilotInventoryItem, "currentOnHand" | "minQuantity" | "parLevel" | "averageDailyUsage">) {
  const daysRemaining = item.averageDailyUsage && item.averageDailyUsage > 0 ? Number((item.currentOnHand / item.averageDailyUsage).toFixed(1)) : null;
  if (item.currentOnHand <= 0) return "Out of stock";
  if (item.currentOnHand <= item.minQuantity || (daysRemaining !== null && daysRemaining <= 3)) return "Reorder now";
  if (item.currentOnHand < item.parLevel || (daysRemaining !== null && daysRemaining <= 10)) return "Low stock";
  return "In stock";
}

function adjustmentTone(quantity: number) {
  if (quantity < 0) return "danger" as const;
  if (quantity > 0) return "success" as const;
  return "neutral" as const;
}

export function PilotInventoryPage() {
  const [data, setData] = useState<PilotInventoryResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<InventoryDraft>(blankDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [adjustmentDelta, setAdjustmentDelta] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState("Periodic review");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchPilotInventory();
      setData(response);
      if (selectedId === null && response.items[0]) {
        setSelectedId(response.items[0].id);
        setDraft(draftFromItem(response.items[0]));
      }
      if (!selectedId && !response.items.length) {
        setDraft(blankDraft());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedItem = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data?.items, selectedId]);
  const filteredItems = useMemo(
    () => (data?.items ?? []).filter((item) => `${item.name} ${item.category} ${item.preferredSupplierName}`.toLowerCase().includes(search.toLowerCase())),
    [data?.items, search],
  );

  useEffect(() => {
    if (selectedItem) {
      setDraft(draftFromItem(selectedItem));
    }
  }, [selectedItem]);

  const saveItem = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        name: draft.name,
        category: draft.category,
        stockUnit: draft.stockUnit,
        currentOnHand: draft.currentOnHand,
        minQuantity: draft.minQuantity,
        parLevel: draft.parLevel,
        preferredSupplierName: draft.preferredSupplierName,
        latestPurchasePrice: draft.latestPurchasePrice,
        averageDailyUsage: draft.averageDailyUsage,
        notes: draft.notes,
        active: draft.active,
      };
      const saved = draft.id ? await updatePilotInventoryItem(draft.id, payload) : await createPilotInventoryItem(payload);
      setSelectedId(saved.id);
      setDraft(draftFromItem(saved));
      setMessage(`Inventory item ${saved.name} saved.`);
      await load();
      setSelectedId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save inventory item.");
    } finally {
      setSaving(false);
    }
  };

  const saveAdjustment = async () => {
    if (!draft.id) {
      setError("Save the inventory item before recording an adjustment.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const delta = adjustmentDelta;
      await createPilotInventoryAdjustment(draft.id, {
        reason: adjustmentReason,
        quantityDelta: delta,
        movementType: delta < 0 ? "manual decrease" : "manual increase",
        sourceRecordId: `manual-${Date.now()}`,
        sourceLineId: "manual",
        note: adjustmentNote,
      });
      setMessage(`Adjustment recorded for ${draft.name}.`);
      setAdjustmentDelta(0);
      setAdjustmentNote("");
      await load();
      setSelectedId(draft.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record adjustment.");
    } finally {
      setSaving(false);
    }
  };

  const reorderCount = data?.summary.inventoryReorderNowCount ?? 0;

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Inventory</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Keep stock, counts, and reorder logic aligned</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Manage the item list, current on-hand quantities, adjustments, and the stock-count backbone that keeps the pilot realistic.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} type="button" onClick={() => { setSelectedId(null); setDraft(blankDraft()); setMessage(null); }}>
              New item
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()}>
              Refresh
            </Button>
            <Button type="button" icon={<Truck className="h-4 w-4" />} onClick={() => window.location.assign("/app/reorder-plan")}>
              Reorder list ({reorderCount})
            </Button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Items tracked", value: formatNumber(data?.summary.inventoryItemCount ?? 0) },
            { label: "Out of stock", value: formatNumber(data?.summary.inventoryOutOfStockCount ?? 0) },
            { label: "Reorder now", value: formatNumber(data?.summary.inventoryReorderNowCount ?? 0) },
            { label: "Low stock", value: formatNumber(data?.summary.inventoryLowStockCount ?? 0) },
            { label: "Inventory value", value: formatMoney(data?.summary.inventoryValue ?? 0) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="p-6">
          <SectionHeader title="Items" description="Search, open, and keep the stock list current." />
          <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted" />
              <input className="w-full bg-transparent text-sm outline-none" placeholder="Search item, supplier, or category" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {filteredItems.map((item) => {
              const status = stockStatus(item);
              return (
                <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setDraft(draftFromItem(item)); }} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${selectedId === item.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{item.name}</p>
                      <p className="text-sm text-muted">{item.category} • {item.preferredSupplierName || "No supplier"}</p>
                    </div>
                    <Badge tone={statusTone(status)}>{status}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">On hand</p>
                      <p className="mt-1 text-ink">{formatNumber(item.currentOnHand)} {item.stockUnit}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">PAR / Min</p>
                      <p className="mt-1 text-ink">{formatNumber(item.parLevel)} / {formatNumber(item.minQuantity)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
            {!filteredItems.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No inventory items match this search.</p> : null}
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
            <p className="font-semibold text-ink">PAR and Minimum</p>
            <p className="mt-1">PAR is the target stock level. Minimum is the point where reorder becomes urgent.</p>
          </div>

          <div className="mt-5">
            <SectionHeader title="Recent movements" description="What changed most recently." />
            <div className="space-y-2">
              {(data?.movements ?? []).slice(0, 5).map((movement) => (
                <div key={movement.id} className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{movement.inventoryItemName}</p>
                      <p className="text-sm text-muted">{movement.reason}</p>
                    </div>
                    <p className={`text-sm font-semibold ${movement.quantityDelta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {movement.quantityDelta >= 0 ? "+" : ""}{formatNumber(movement.quantityDelta)} {movement.unit}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title={draft.id ? `Edit ${draft.name || "inventory item"}` : "New inventory item"} description="Keep the live preview aligned with the form." />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Item name</span>
              <input className="input mt-1" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Category</span>
              <input className="input mt-1" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Stock unit</span>
              <input className="input mt-1" value={draft.stockUnit} onChange={(event) => setDraft((current) => ({ ...current, stockUnit: event.target.value }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Preferred supplier</span>
              <input className="input mt-1" value={draft.preferredSupplierName} onChange={(event) => setDraft((current) => ({ ...current, preferredSupplierName: event.target.value }))} />
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Current on hand</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.currentOnHand} onChange={(event) => setDraft((current) => ({ ...current, currentOnHand: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Minimum</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.minQuantity} onChange={(event) => setDraft((current) => ({ ...current, minQuantity: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">PAR</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.parLevel} onChange={(event) => setDraft((current) => ({ ...current, parLevel: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Latest price</span>
              <input className="input mt-1" type="number" step="0.01" value={draft.latestPurchasePrice} onChange={(event) => setDraft((current) => ({ ...current, latestPurchasePrice: Number(event.target.value) }))} />
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Average daily usage</span>
              <input className="input mt-1" type="number" step="0.0001" value={draft.averageDailyUsage} onChange={(event) => setDraft((current) => ({ ...current, averageDailyUsage: Number(event.target.value) }))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Active</span>
              <select className="input mt-1" value={draft.active ? "true" : "false"} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.value === "true" }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-ink">Notes</span>
            <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>

          <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Live preview</p>
              <div className="mt-3 space-y-2">
                <p className="text-2xl font-bold text-ink">{draft.name || "New inventory item"}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(stockStatus({ currentOnHand: draft.currentOnHand, minQuantity: draft.minQuantity, parLevel: draft.parLevel, averageDailyUsage: draft.averageDailyUsage }))}>
                    {stockStatus({ currentOnHand: draft.currentOnHand, minQuantity: draft.minQuantity, parLevel: draft.parLevel, averageDailyUsage: draft.averageDailyUsage })}
                  </Badge>
                  <Badge tone="neutral">{draft.category || "Other"}</Badge>
                  <Badge tone="neutral">{draft.stockUnit || "each"}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">On hand</p>
                    <p className="mt-1 text-ink">{formatNumber(draft.currentOnHand)} {draft.stockUnit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">PAR / Min</p>
                    <p className="mt-1 text-ink">{formatNumber(draft.parLevel)} / {formatNumber(draft.minQuantity)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Supplier</p>
                    <p className="mt-1 text-ink">{draft.preferredSupplierName || "Unassigned"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Latest price</p>
                    <p className="mt-1 text-ink">{formatMoney(draft.latestPurchasePrice)}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Adjustment</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Quantity delta</span>
                  <input className="input mt-1" type="number" step="0.0001" value={adjustmentDelta} onChange={(event) => setAdjustmentDelta(Number(event.target.value))} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Reason</span>
                  <input className="input mt-1" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-sm font-semibold text-ink">Note</span>
                <textarea className="input mt-1" value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={saving} icon={<Scale className="h-4 w-4" />} type="button" onClick={() => void saveAdjustment()}>
                  Save stock movement
                </Button>
                <Button variant="secondary" disabled={saving || !draft.id} icon={<SquarePen className="h-4 w-4" />} type="button" onClick={() => void saveItem()}>
                  {draft.id ? "Update item" : "Create item"}
                </Button>
                <Button variant="secondary" icon={<ArrowRight className="h-4 w-4" />} type="button" onClick={() => window.location.assign("/app/stock-counts")}>
                  Stock counts
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader title="Count sessions" description="Recent counts and the session status." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data?.countSessions ?? []).slice(0, 3).map((session) => <CountSessionCard key={session.id} session={session} />)}
          {!data?.countSessions.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No count sessions yet.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function CountSessionCard({ session }: { session: PilotCountSession }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Count #{session.id}</p>
          <p className="text-sm text-muted">{session.countedBy || "Unassigned"} • {formatDateTime(session.updatedAt)}</p>
        </div>
        <Badge tone={statusTone(session.status)}>{session.status}</Badge>
      </div>
      <p className="mt-3 text-sm text-muted">{session.itemCount} items counted</p>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted">Completed</span>
        <span className="font-semibold text-ink">{session.completedAt ? formatDateTime(session.completedAt) : "Pending"}</span>
      </div>
    </div>
  );
}
