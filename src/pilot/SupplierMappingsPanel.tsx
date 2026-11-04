import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import {
  createPilotSupplierItemMapping,
  deletePilotSupplierItemMapping,
  fetchPilotSupplierItemMappings,
  updatePilotSupplierItemMapping,
  type PilotSupplierItemMappingRow,
} from "./pilotApi";
import { demoReadOnly } from "./pilotConfig";

type InventoryOption = { id: number; name: string };

interface Props {
  supplierId: number;
  inventoryItems: InventoryOption[];
  onChanged?: () => void;
}

interface Draft {
  id: number | null;
  supplierItemName: string;
  inventoryItemId: string;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: string;
}

const blank = (): Draft => ({ id: null, supplierItemName: "", inventoryItemId: "", purchaseUnit: "case", inventoryUnit: "each", conversionFactor: "1" });

export function SupplierMappingsPanel({ supplierId, inventoryItems, onChanged }: Props) {
  const [mappings, setMappings] = useState<PilotSupplierItemMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const response = await fetchPilotSupplierItemMappings(supplierId);
    setMappings(response.mappings);
  }, [supplierId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDraft(null);
    fetchPilotSupplierItemMappings(supplierId)
      .then((response) => active && setMappings(response.mappings))
      .catch((err) => active && setError(err instanceof Error ? err.message : "Could not load mappings."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [supplierId]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      setNotice(success);
      setDraft(null);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the mapping.");
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const factor = Number(draft.conversionFactor);
    if (!draft.supplierItemName.trim() || !draft.inventoryItemId) {
      setError("Enter the supplier item name and choose an inventory item.");
      return;
    }
    if (!Number.isFinite(factor) || factor <= 0) {
      setError("Conversion factor must be greater than 0.");
      return;
    }
    const payload = {
      supplierItemName: draft.supplierItemName.trim(),
      inventoryItemId: Number(draft.inventoryItemId),
      purchaseUnit: draft.purchaseUnit.trim(),
      inventoryUnit: draft.inventoryUnit.trim(),
      conversionFactor: factor,
    };
    void run(
      () => (draft.id === null ? createPilotSupplierItemMapping(supplierId, payload) : updatePilotSupplierItemMapping(supplierId, draft.id, payload)),
      draft.id === null ? "Mapping added." : "Mapping updated.",
    );
  };

  const remove = (mapping: PilotSupplierItemMappingRow) => {
    if (!window.confirm(`Remove the mapping for "${mapping.supplierItemName}"? Future invoices will need to be mapped again.`)) return;
    void run(() => deletePilotSupplierItemMapping(supplierId, mapping.id), "Mapping removed.");
  };

  const inputClass = "mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink";

  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-4" data-testid="supplier-mappings-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Supplier item mappings</p>
        {!demoReadOnly ? (
          <Button type="button" variant="secondary" disabled={saving} onClick={() => { setNotice(null); setError(null); setDraft(blank()); }}>
            Add mapping
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}
      {loading ? <p className="mt-3 text-sm text-muted">Loading mappings…</p> : null}
      {!loading && !mappings.length ? <p className="mt-3 rounded-2xl border border-dashed border-line px-3 py-4 text-sm text-muted">No mappings yet. Add one so invoice lines from this supplier land on the right inventory item.</p> : null}
      <div className="mt-3 space-y-2">
        {mappings.map((mapping) => (
          <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-slate-50 px-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{mapping.supplierItemName}</p>
              <p className="text-xs text-muted">
                {mapping.inventoryItemName || "Unlinked item"} · 1 {mapping.purchaseUnit} = {mapping.conversionFactor} {mapping.inventoryUnit}
              </p>
            </div>
            {!demoReadOnly ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setNotice(null);
                    setError(null);
                    setDraft({ id: mapping.id, supplierItemName: mapping.supplierItemName, inventoryItemId: String(mapping.inventoryItemId), purchaseUnit: mapping.purchaseUnit, inventoryUnit: mapping.inventoryUnit, conversionFactor: String(mapping.conversionFactor) });
                  }}
                >
                  Edit
                </Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => remove(mapping)}>
                  Remove
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {draft ? (
        <form onSubmit={submit} className="mt-4 grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-2" aria-label="Mapping form">
          <label className="text-sm font-semibold text-ink sm:col-span-2">
            Supplier item name
            <input className={inputClass} value={draft.supplierItemName} onChange={(e) => setDraft({ ...draft, supplierItemName: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-ink sm:col-span-2">
            Inventory item
            <select className={inputClass} value={draft.inventoryItemId} onChange={(e) => setDraft({ ...draft, inventoryItemId: e.target.value })}>
              <option value="">Choose an item…</option>
              {inventoryItems.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-ink">
            Purchase unit
            <input className={inputClass} value={draft.purchaseUnit} onChange={(e) => setDraft({ ...draft, purchaseUnit: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-ink">
            Inventory unit
            <input className={inputClass} value={draft.inventoryUnit} onChange={(e) => setDraft({ ...draft, inventoryUnit: e.target.value })} />
          </label>
          <label className="text-sm font-semibold text-ink sm:col-span-2">
            Inventory units per purchase unit
            <input className={inputClass} inputMode="decimal" value={draft.conversionFactor} onChange={(e) => setDraft({ ...draft, conversionFactor: e.target.value })} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : draft.id === null ? "Add mapping" : "Save mapping"}</Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
