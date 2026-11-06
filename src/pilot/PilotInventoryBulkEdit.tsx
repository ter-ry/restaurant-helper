import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button";
import {
  BULK_EDIT_MAX_ITEMS,
  buildBulkChanges,
  buildExpected,
  describeChanges,
  emptyBulkForm,
  filterItems,
  pruneSelection,
  selectAll,
  type ActiveFilter,
  type BulkFormState,
} from "../lib/inventoryBulkEdit";
import { itemErrorsFrom, submitBulkEdit, type BulkEditResponse } from "./inventoryBulkEditApi";
import { fetchPilotInventory, fetchPilotSuppliers, PilotApiError, type PilotInventoryItem, type PilotSupplierSummary } from "./pilotApi";
import { demoReadOnly } from "./pilotConfig";

type Phase = "edit" | "reviewing" | "review" | "applying";

const FIELD_LABELS: Record<string, string> = { minQuantity: "Reorder at", parLevel: "PAR", supplierId: "Supplier", active: "Status" };

export function PilotInventoryBulkEdit() {
  const [items, setItems] = useState<PilotInventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<PilotSupplierSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [form, setForm] = useState<BulkFormState>(emptyBulkForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("edit");
  const [review, setReview] = useState<BulkEditResponse | null>(null);
  const [itemErrors, setItemErrors] = useState<Array<{ itemId: number; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const inFlight = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [inventory, supplierResponse] = await Promise.all([fetchPilotInventory(), fetchPilotSuppliers()]);
    setItems(inventory.items);
    setSuppliers(supplierResponse.suppliers);
    setSelection((current) => pruneSelection(current, inventory.items));
  }, []);

  useEffect(() => {
    let alive = true;
    load()
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : "Could not load inventory."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => {
    if (phase === "review") reviewHeading.current?.focus();
  }, [phase]);

  // A rejection must never be missed because the list or form is scrolled out of view.
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView?.({ block: "center" });
  }, [error, itemErrors]);

  const visible = useMemo(() => filterItems(items, search, activeFilter), [items, search, activeFilter]);
  const selectedIds = useMemo(() => [...selection].sort((a, b) => a - b), [selection]);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.isActive), [suppliers]);
  const supplierName = (id: number | null) => suppliers.find((supplier) => supplier.id === id)?.name ?? (id === null ? "None" : `#${id}`);
  const itemName = (id: number) => items.find((item) => item.id === id)?.name ?? `Item ${id}`;
  const busy = phase === "reviewing" || phase === "applying";
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selection.has(item.id));

  const resetOutcome = () => {
    setReview(null);
    setItemErrors([]);
    setError(null);
    setStale(false);
    setPhase("edit");
  };

  const toggle = (id: number) => {
    if (busy) return;
    resetOutcome();
    setSuccess(null);
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_EDIT_MAX_ITEMS) next.add(id);
      return next;
    });
  };

  const updateForm = (patch: Partial<BulkFormState>) => {
    if (busy) return;
    resetOutcome();
    setSuccess(null);
    setForm((current) => ({ ...current, ...patch }));
  };

  const run = async (dryRun: boolean) => {
    if (inFlight.current || demoReadOnly) return; // duplicate-submit guard (state updates are async)
    const { changes, errors } = buildBulkChanges(form);
    setFieldErrors(errors as Record<string, string>);
    if (Object.keys(errors).length || !selectedIds.length) {
      if (!selectedIds.length) setError("Select at least one item.");
      return;
    }
    inFlight.current = true;
    setPhase(dryRun ? "reviewing" : "applying");
    setError(null);
    setItemErrors([]);
    setStale(false);
    setSuccess(null);
    try {
      const response = await submitBulkEdit({ itemIds: selectedIds, changes, expected: buildExpected(items, selectedIds, changes), dryRun });
      if (dryRun) {
        setReview(response);
        setPhase("review");
        return;
      }
      // Success: reconcile with authoritative server state, then reset the workflow.
      await load().catch(() => setItems((current) => current.map((item) => response.refreshedItems?.find((fresh) => fresh.id === item.id) ?? item)));
      const { changed, unchanged } = response.summary;
      setSuccess(`Updated ${changed} item${changed === 1 ? "" : "s"}${unchanged ? `; ${unchanged} already matched` : ""}.`);
      setSelection(new Set());
      setForm(emptyBulkForm());
      setReview(null);
      setPhase("edit");
    } catch (err) {
      setPhase("edit");
      setReview(null);
      const perItem = itemErrorsFrom(err);
      setItemErrors(perItem);
      if (err instanceof PilotApiError && err.status === 409) {
        setStale(true);
        setError("Some items changed since you loaded them. Nothing was saved. Refresh the list and review again.");
      } else {
        setError(err instanceof Error ? err.message : "Bulk edit failed. Nothing was saved.");
        if (err instanceof PilotApiError && err.errors && !perItem.length) setFieldErrors((current) => ({ ...current, ...err.errors }));
      }
    } finally {
      inFlight.current = false;
    }
  };

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await load();
      resetOutcome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh inventory.");
    } finally {
      inFlight.current = false;
    }
  };

  if (loading) return <p role="status" className="p-4 text-sm text-muted">Loading inventory items…</p>;
  if (loadError) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}</p>;

  const { changes: previewChanges } = buildBulkChanges(form);
  const summaryParts = describeChanges(previewChanges, supplierName);

  return (
    <section aria-labelledby="bulk-edit-title" className="bulk-edit space-y-4">
      <div>
        <h2 id="bulk-edit-title" className="text-lg font-semibold text-ink">Bulk edit items</h2>
        <p className="text-sm text-muted">Select items, choose what to change, review, then apply. Stock quantities and costs are never changed here.</p>
      </div>

      <div aria-live="polite" role="status" className="space-y-2">
        {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p> : null}
        {phase === "applying" ? <p className="text-sm text-muted">Applying changes to {selectedIds.length} items…</p> : null}
        {phase === "reviewing" ? <p className="text-sm text-muted">Checking changes…</p> : null}
      </div>
      {error ? (
        <div ref={errorBox} role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">{error}</p>
          {itemErrors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {itemErrors.map((entry) => <li key={entry.itemId}><strong>{itemName(entry.itemId)}:</strong> {entry.message}</li>)}
            </ul>
          ) : null}
          {stale ? <Button className="mt-2" variant="secondary" type="button" onClick={() => void refresh()}>Refresh list</Button> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-medium text-ink">Search items
          <input className="input mt-1" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, category or supplier" />
        </label>
        <label className="text-sm font-medium text-ink">Show
          <select className="input mt-1" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}>
            <option value="all">All items</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Selection">
        <span className="text-sm font-semibold text-ink" data-testid="selected-count">{selectedIds.length} selected</span>
        <Button variant="secondary" type="button" disabled={busy || !visible.length || allVisibleSelected} onClick={() => { resetOutcome(); setSelection((current) => selectAll(visible, current).selection); }}>
          Select {visible.length} shown
        </Button>
        <Button variant="ghost" type="button" disabled={busy || !selectedIds.length} onClick={() => { resetOutcome(); setSelection(new Set()); }}>Clear selection</Button>
        {selectedIds.length >= BULK_EDIT_MAX_ITEMS ? <span className="text-xs text-muted">Limit of {BULK_EDIT_MAX_ITEMS} items per edit.</span> : null}
      </div>

      <ul className="max-h-[22rem] divide-y divide-line overflow-auto rounded-2xl border border-line" aria-label="Inventory items" tabIndex={0}>
        {visible.length === 0 ? <li className="p-4 text-sm text-muted">No items match.</li> : null}
        {visible.map((item) => (
          <li key={item.id}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={selection.has(item.id)} disabled={busy} onChange={() => toggle(item.id)} aria-label={`Select ${item.name}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{item.name}{item.active ? "" : " (inactive)"}</span>
                <span className="block text-xs text-muted">
                  Reorder at {item.minQuantity} · PAR {item.parLevel} {item.stockUnit} · {item.preferredSupplierName || "No supplier"}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <fieldset className="space-y-3 rounded-2xl border border-line p-3" disabled={busy}>
        <legend className="px-1 text-sm font-semibold text-ink">What to change for the selected items</legend>
        {fieldErrors.form ? <p role="alert" className="text-sm text-red-700">{fieldErrors.form}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={form.changeMin} onChange={(event) => updateForm({ changeMin: event.target.checked })} /> Reorder threshold</label>
            <input className="input mt-1" inputMode="decimal" aria-label="New reorder threshold" disabled={!form.changeMin} value={form.minQuantity} onChange={(event) => updateForm({ minQuantity: event.target.value })} aria-invalid={Boolean(fieldErrors.minQuantity)} />
            {fieldErrors.minQuantity ? <p role="alert" className="mt-1 text-xs text-red-700">{fieldErrors.minQuantity}</p> : null}
          </div>
          <div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={form.changePar} onChange={(event) => updateForm({ changePar: event.target.checked })} /> PAR level</label>
            <input className="input mt-1" inputMode="decimal" aria-label="New PAR level" disabled={!form.changePar} value={form.parLevel} onChange={(event) => updateForm({ parLevel: event.target.value })} aria-invalid={Boolean(fieldErrors.parLevel)} />
            {fieldErrors.parLevel ? <p role="alert" className="mt-1 text-xs text-red-700">{fieldErrors.parLevel}</p> : null}
          </div>
          <div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={form.changeSupplier} onChange={(event) => updateForm({ changeSupplier: event.target.checked })} /> Preferred supplier</label>
            <select className="input mt-1" aria-label="New preferred supplier" disabled={!form.changeSupplier} value={form.supplierId} onChange={(event) => updateForm({ supplierId: event.target.value })}>
              <option value="">No supplier (clear)</option>
              {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
            {fieldErrors.supplierId ? <p role="alert" className="mt-1 text-xs text-red-700">{fieldErrors.supplierId}</p> : null}
          </div>
          <div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={form.changeActive} onChange={(event) => updateForm({ changeActive: event.target.checked })} /> Active state</label>
            <select className="input mt-1" aria-label="New active state" disabled={!form.changeActive} value={form.active ? "active" : "inactive"} onChange={(event) => updateForm({ active: event.target.value === "active" })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </fieldset>

      {phase === "review" && review ? (
        <section aria-labelledby="bulk-review-title" className="space-y-2 rounded-2xl border border-line bg-slate-50 p-3">
          <h3 id="bulk-review-title" ref={reviewHeading} tabIndex={-1} className="text-sm font-semibold text-ink">
            Review: {review.summary.changed} will change{review.summary.unchanged ? `, ${review.summary.unchanged} already match` : ""}
          </h3>
          <ul className="max-h-64 divide-y divide-line overflow-auto text-sm">
            {review.items.map((entry) => (
              <li key={entry.id} className="py-1.5">
                <span className="font-medium text-ink">{entry.name}</span>
                {entry.status === "unchanged" ? <span className="text-muted"> — no change</span> : (
                  <ul className="text-xs text-muted">
                    {entry.changedFields.map((field) => (
                      <li key={field}>{FIELD_LABELS[field] ?? field}: {formatValue(field, entry.before[field], supplierName)} → {formatValue(field, entry.after[field], supplierName)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-line bg-white/95 px-1 py-2 backdrop-blur">
        {phase === "review" && review ? (
          <>
            <Button type="button" disabled={busy || demoReadOnly || review.summary.changed === 0} onClick={() => void run(false)}>
              {`Apply to ${review.summary.changed} item${review.summary.changed === 1 ? "" : "s"}`}
            </Button>
            <Button variant="secondary" type="button" onClick={resetOutcome}>Back to edit</Button>
          </>
        ) : (
          <Button type="button" disabled={busy || demoReadOnly || !selectedIds.length} title={demoReadOnly ? "Read-only demo" : undefined} onClick={() => void run(true)}>
            {phase === "reviewing" ? "Checking…" : phase === "applying" ? "Applying…" : demoReadOnly ? "Read-only demo" : `Review changes (${selectedIds.length})`}
          </Button>
        )}
        {summaryParts.length ? <span className="text-xs text-muted">Set {summaryParts.join(", ")}</span> : null}
      </div>
    </section>
  );
}

function formatValue(field: string, value: number | boolean | null | undefined, supplierName: (id: number | null) => string) {
  if (field === "supplierId") return supplierName((value as number | null) ?? null);
  if (field === "active") return value ? "Active" : "Inactive";
  return String(value ?? "");
}
