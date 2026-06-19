import { Archive, CheckCircle2, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { buildDemoPath, useDemoProfile } from "../lib/demoProfile";
import {
  createInventoryDraft,
  describeInventoryStatus,
  findInventoryItemSuggestions,
  getInventoryStatusTone,
  sortInventoryItems,
  sortInventoryMovementsNewestFirst,
} from "../lib/inventoryWorkspace";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InventoryItemStatus, PilotInventoryDraft, PilotInventoryDraftLine } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const statusOptions: Array<InventoryItemStatus | "All"> = ["All", "In stock", "Low stock", "Reorder now", "Out of stock", "Count needed"];

function emptyManualMovement() {
  return {
    itemId: "",
    movementType: "manual addition" as const,
    quantityDelta: 1,
    note: "",
  };
}

export function InventoryPage() {
  const demo = useDemoProfile();
  const demoSlug = demo.slug as "cafe" | "quick-service" | "full-service";
  const {
    inventoryItems,
    inventoryMovements,
    inventoryReceipts,
    recentInvoices,
    saveInventoryItem,
    archiveInventoryItem,
    deleteInventoryItem,
    recordInventoryReceipt,
    recordInventoryMovement,
    recordInventoryCount,
    summary,
  } = usePilotWorkspace();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InventoryItemStatus | "All">("All");
  const [mode, setMode] = useState<"create" | "edit">(inventoryItems[0] ? "edit" : "create");
  const [draft, setDraft] = useState<PilotInventoryDraft>(() => createInventoryDraft());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(inventoryItems[0]?.id ?? null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [manualMovement, setManualMovement] = useState(emptyManualMovement);
  const [countQuantity, setCountQuantity] = useState("");
  const [countNote, setCountNote] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(recentInvoices[0]?.id ?? "");
  const [receiptLines, setReceiptLines] = useState<PilotInventoryDraftLine[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  const selectedItem = useMemo(
    () => inventoryItems.find((item) => item.id === selectedItemId) ?? null,
    [inventoryItems, selectedItemId],
  );

  useEffect(() => {
    if (mode === "edit" && selectedItem) {
      setDraft(createInventoryDraft(selectedItem));
    }
  }, [mode, selectedItem]);

  useEffect(() => {
    const invoice = recentInvoices.find((item) => item.id === selectedInvoiceId) ?? recentInvoices[0] ?? null;
    if (!invoice) {
      setReceiptLines([]);
      return;
    }

    setSelectedInvoiceId(invoice.id);
    setReceiptLines(
      invoice.lineItems.map((line) => {
        const suggestion = findInventoryItemSuggestions(inventoryItems, line.comparisonKey || line.itemName)[0];
        return {
          invoiceLineItemId: line.id,
          inventoryItemId: suggestion?.id ?? "",
          quantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
          conversionFactor: 1,
          note: "",
        };
      }),
    );
  }, [inventoryItems, recentInvoices, selectedInvoiceId]);

  const statusCounts = useMemo(() => {
    const counts = {
      all: 0,
      visible: 0,
      inStock: 0,
      lowStock: 0,
      reorderNow: 0,
      outOfStock: 0,
      countNeeded: 0,
    };

    for (const item of sortInventoryItems(inventoryItems)) {
      const status = describeInventoryStatus(item).status;
      counts.all += 1;
      if (!showArchived && !item.active) {
        continue;
      }
      if (statusFilter !== "All" && status !== statusFilter) {
        continue;
      }
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const haystack = `${item.name} ${item.category} ${item.preferredSupplier} ${status}`.toLowerCase();
        if (!haystack.includes(query)) {
          continue;
        }
      }
      counts.visible += 1;
      if (status === "In stock") counts.inStock += 1;
      if (status === "Low stock") counts.lowStock += 1;
      if (status === "Reorder now") counts.reorderNow += 1;
      if (status === "Out of stock") counts.outOfStock += 1;
      if (status === "Count needed") counts.countNeeded += 1;
    }

    return counts;
  }, [inventoryItems, search, showArchived, statusFilter]);

  const filteredItems = useMemo(() => {
    return sortInventoryItems(inventoryItems).filter((item) => {
      if (!showArchived && !item.active) {
        return false;
      }

      const status = describeInventoryStatus(item).status;
      if (statusFilter !== "All" && status !== statusFilter) {
        return false;
      }

      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const haystack = `${item.name} ${item.category} ${item.preferredSupplier} ${item.notes} ${status}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [inventoryItems, search, showArchived, statusFilter]);

  const selectedItemMovements = useMemo(
    () => sortInventoryMovementsNewestFirst(inventoryMovements.filter((movement) => movement.inventoryItemId === selectedItem?.id)).slice(0, 8),
    [inventoryMovements, selectedItem?.id],
  );

  const selectedItemReceipts = useMemo(
    () => inventoryReceipts.filter((receipt) => receipt.inventoryItemId === selectedItem?.id).slice(0, 5),
    [inventoryReceipts, selectedItem?.id],
  );

  const inventoryValue = formatCurrency(summary.inventoryValue);

  const chooseItem = (itemId: string) => {
    const item = inventoryItems.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    setMode("edit");
    setSelectedItemId(item.id);
    setDraft(createInventoryDraft(item));
    setMessage(`Editing ${item.name}.`);
    setErrorMessage("");
  };

  const beginNewItem = () => {
    setMode("create");
    setSelectedItemId(null);
    setDraft(createInventoryDraft());
    setMessage("");
    setErrorMessage("");
  };

  const resetDraft = () => {
    if (mode === "edit" && selectedItem) {
      setDraft(createInventoryDraft(selectedItem));
    } else {
      setDraft(createInventoryDraft());
    }
    setMessage("");
    setErrorMessage("");
  };

  const handleSaveItem = () => {
    if (!draft.name.trim()) {
      setErrorMessage("Enter an item name before saving.");
      return;
    }

    const saved = saveInventoryItem(draft);
    const wasCreate = mode === "create";
    setMode("edit");
    setSelectedItemId(saved.id);
    setDraft(createInventoryDraft(saved));
    setMessage(`${wasCreate ? "Created" : "Updated"} ${saved.name} successfully.`);
    setErrorMessage("");
  };

  const handleArchive = () => {
    if (!selectedItem) {
      return;
    }

    archiveInventoryItem(selectedItem.id);
    setMessage(`${selectedItem.name} archived.`);
  };

  const handleDelete = () => {
    if (!selectedItem) {
      return;
    }

    if (window.confirm(`Delete ${selectedItem.name}? This removes the local record and its history from this browser.`)) {
      deleteInventoryItem(selectedItem.id);
      setDraft(createInventoryDraft());
      setMode("create");
      setSelectedItemId(null);
      setMessage(`${selectedItem.name} deleted.`);
    }
  };

  const handleReceiveInvoice = () => {
    if (!selectedInvoiceId || receiptLines.length === 0) {
      setErrorMessage("Choose an invoice with line items first.");
      return;
    }

    const result = recordInventoryReceipt(selectedInvoiceId, receiptLines);
    setMessage(`Recorded ${result.recorded} invoice receipt line${result.recorded === 1 ? "" : "s"}${result.skipped ? `, skipped ${result.skipped} duplicates` : ""}.`);
    setErrorMessage("");
  };

  const handleMovementSave = () => {
    if (!manualMovement.itemId) {
      setErrorMessage("Choose an item before saving a movement.");
      return;
    }

    const movement = recordInventoryMovement(manualMovement.itemId, manualMovement.movementType, manualMovement.quantityDelta, manualMovement.note);
    if (!movement) {
      setErrorMessage("That movement could not be saved.");
      return;
    }

    setMessage(`Recorded ${movement.movementType} for ${movement.inventoryItemName}.`);
    setManualMovement(emptyManualMovement());
    setErrorMessage("");
  };

  const handleCountSave = () => {
    if (!selectedItem) {
      setErrorMessage("Choose an item before saving a count.");
      return;
    }

    const quantity = Number(countQuantity);
    if (!Number.isFinite(quantity)) {
      setErrorMessage("Enter a counted quantity.");
      return;
    }

    const movement = recordInventoryCount(selectedItem.id, quantity, countNote);
    if (!movement) {
      setErrorMessage("That count could not be saved.");
      return;
    }

    setMessage(`Saved stock count for ${selectedItem.name}.`);
    setCountQuantity("");
    setCountNote("");
    setErrorMessage("");
  };

  return (
    <PageLayout
      title="Inventory"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="A first-pass inventory foundation built from saved invoices, manual counts, and a conservative movement ledger."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Inventory items" value={String(summary.inventoryItemCount)} helper={`${summary.inventoryValue ? inventoryValue : "No stock value yet"}`} />
        <StatCard label="Low stock" value={String(summary.inventoryLowStockCount)} helper={`${summary.inventoryReorderNowCount} require a reorder now`} />
        <StatCard label="Count needed" value={String(summary.inventoryCountNeededCount)} helper={`${summary.inventoryOutOfStockCount} out of stock`} />
        <StatCard label="Receipts saved" value={String(summary.inventoryReceiptCount)} helper={`${summary.inventoryMovementCount} total movements recorded`} />
      </div>

      {message ? (
        <div className="mt-5 rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700" role="status">
          <p className="font-semibold text-ink">Status</p>
          <p className="mt-1">{message}</p>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
          <p className="font-semibold">Problem</p>
          <p className="mt-1">{errorMessage}</p>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="p-5">
          <SectionHeader
            title="Inventory list"
            description="Search, filter, and open an item to edit its stock level, supplier preference, or notes."
            action={<Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={buildDemoPath(demoSlug, "invoices")}>Review invoices</Link>}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
            <label className="block min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">Search</span>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
                <Search className="h-4 w-4 text-muted" />
                <input
                  className="w-full min-w-0 bg-transparent text-sm outline-none"
                  placeholder="Item, supplier, category"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </label>
            <label className="block min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">Status</span>
              <select className="input mt-2" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InventoryItemStatus | "All")}>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={beginNewItem}>
              New item
            </Button>
            <Button type="button" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setShowArchived((current) => !current)}>
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            <Badge tone="info">{statusCounts.visible} visible</Badge>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {filteredItems.map((item) => {
              const status = describeInventoryStatus(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:bg-slate-50 ${selectedItemId === item.id ? "border-brand-200 bg-brand-50/40" : "border-line bg-white"}`}
                  onClick={() => chooseItem(item.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                      <p className="mt-1 text-xs text-muted">{item.category} · {item.preferredSupplier || "No preferred supplier"}</p>
                    </div>
                    <Badge tone={getInventoryStatusTone(status.status)}>{status.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <MiniStat label="On hand" value={`${item.currentQuantity} ${item.unit}`} />
                    <MiniStat label="Par" value={`${item.parLevel} ${item.unit}`} />
                    <MiniStat label="Min" value={`${item.minQuantity} ${item.unit}`} />
                    <MiniStat label="Latest price" value={formatCurrency(item.latestPurchasePrice)} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    {item.lastReceivedAt ? `Last received ${formatDate(item.lastReceivedAt)}` : "No receipt recorded yet"} · {item.lastCountedAt ? `Counted ${formatDate(item.lastCountedAt)}` : "No count saved yet"}
                  </p>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionHeader
              title={mode === "create" ? "New inventory item" : selectedItem ? `Item details: ${selectedItem.name}` : "Item details"}
              description="Edit one item at a time. Stock remains in browser storage and can be reopened later."
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Item name">
                <input className="input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field label="Category">
                <input className="input" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} />
              </Field>
              <Field label="Current quantity">
                <input className="input" type="number" step="0.01" value={draft.currentQuantity} onChange={(event) => setDraft((current) => ({ ...current, currentQuantity: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="Unit">
                <input className="input" value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} />
              </Field>
              <Field label="Minimum quantity">
                <input className="input" type="number" step="0.01" value={draft.minQuantity} onChange={(event) => setDraft((current) => ({ ...current, minQuantity: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="PAR level">
                <input className="input" type="number" step="0.01" value={draft.parLevel} onChange={(event) => setDraft((current) => ({ ...current, parLevel: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="Preferred supplier">
                <input className="input" value={draft.preferredSupplier} onChange={(event) => setDraft((current) => ({ ...current, preferredSupplier: event.target.value }))} />
              </Field>
              <Field label="Latest purchase price">
                <input className="input" type="number" step="0.01" value={draft.latestPurchasePrice} onChange={(event) => setDraft((current) => ({ ...current, latestPurchasePrice: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="Average daily usage">
                <input className="input" type="number" step="0.01" value={draft.averageDailyUsage ?? ""} onChange={(event) => setDraft((current) => ({ ...current, averageDailyUsage: event.target.value.trim() ? Number(event.target.value) || 0 : undefined }))} />
              </Field>
              <Field label="Notes">
                <textarea className="input min-h-28" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" icon={<Save className="h-4 w-4" />} onClick={handleSaveItem}>
                {mode === "create" ? "Create item" : "Save item"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetDraft}>
                {mode === "create" ? "Clear draft" : "Reset"}
              </Button>
              {selectedItem ? (
                <>
                  <Button type="button" variant="ghost" icon={<Archive className="h-4 w-4" />} onClick={handleArchive}>
                    Archive
                  </Button>
                  <Button type="button" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={handleDelete}>
                    Delete
                  </Button>
                </>
              ) : null}
            </div>
            {selectedItem ? (
              <div className="mt-4 rounded-xl border border-line bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniStat label="Status" value={describeInventoryStatus(selectedItem).status} />
                  <MiniStat label="Days remaining" value={describeInventoryStatus(selectedItem).daysRemaining ? `${describeInventoryStatus(selectedItem).daysRemaining}` : "Not enough data"} />
                  <MiniStat label="Inventory value" value={formatCurrency(selectedItem.currentQuantity * selectedItem.latestPurchasePrice)} />
                  <MiniStat label="Active" value={selectedItem.active ? "Yes" : "Archived"} />
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <SectionHeader title="Receive from saved invoice" description="Pick a saved invoice, map each line conservatively, and record receipt movements without rerunning OCR." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Saved invoice">
                <select className="input" value={selectedInvoiceId} onChange={(event) => setSelectedInvoiceId(event.target.value)}>
                  {recentInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.supplier} / {invoice.invoiceNumber || invoice.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source note">
                <div className="rounded-lg border border-dashed border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Receipt records stay local and only use saved invoice data. Duplicate receipt keys are skipped automatically.
                </div>
              </Field>
            </div>

            <div className="mt-4 space-y-3">
              {receiptLines.map((line, index) => {
                const invoice = recentInvoices.find((item) => item.id === selectedInvoiceId);
                const invoiceLine = invoice?.lineItems.find((entry) => entry.id === line.invoiceLineItemId);
                return (
                  <div key={line.invoiceLineItemId} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-bold text-ink">{invoiceLine?.itemName || `Line ${index + 1}`}</p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          {invoiceLine?.originalDescription || "No source description available"} · Qty {invoiceLine?.quantity ?? 0} {invoiceLine?.unit || ""}
                        </p>
                      </div>
                      <Badge tone={line.inventoryItemId ? "success" : "warning"}>{line.inventoryItemId ? "Mapped" : "Needs item"}</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Inventory item">
                        <select
                          className="input"
                          value={line.inventoryItemId}
                          onChange={(event) =>
                            setReceiptLines((current) => current.map((item) => (item.invoiceLineItemId === line.invoiceLineItemId ? { ...item, inventoryItemId: event.target.value } : item)))
                          }
                        >
                          <option value="">Choose item</option>
                          {sortInventoryItems(inventoryItems).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Receive quantity">
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) =>
                            setReceiptLines((current) => current.map((item) => (item.invoiceLineItemId === line.invoiceLineItemId ? { ...item, quantity: Number(event.target.value) || 0 } : item)))
                          }
                        />
                      </Field>
                      <Field label="Conversion factor">
                        <input
                          className="input"
                          type="number"
                          step="0.01"
                          value={line.conversionFactor}
                          onChange={(event) =>
                            setReceiptLines((current) => current.map((item) => (item.invoiceLineItemId === line.invoiceLineItemId ? { ...item, conversionFactor: Number(event.target.value) || 1 } : item)))
                          }
                        />
                      </Field>
                      <Field label="Note">
                        <input
                          className="input"
                          value={line.note}
                          onChange={(event) =>
                            setReceiptLines((current) => current.map((item) => (item.invoiceLineItemId === line.invoiceLineItemId ? { ...item, note: event.target.value } : item)))
                          }
                          placeholder="Optional receipt note"
                        />
                      </Field>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted">
                      Effective stock add: {(line.quantity * line.conversionFactor).toFixed(2)} {selectedItem?.unit || "units"}.
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" icon={<CheckCircle2 className="h-4 w-4" />} onClick={handleReceiveInvoice}>
                Record receipt
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReceiptLines([])}>
                Clear mappings
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Manual movement" description="Record usage, waste, breakage, other adjustments, or positive additions without changing invoice history." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Item">
                <select className="input" value={manualMovement.itemId} onChange={(event) => setManualMovement((current) => ({ ...current, itemId: event.target.value }))}>
                  <option value="">Choose item</option>
                  {sortInventoryItems(inventoryItems).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Movement type">
                <select className="input" value={manualMovement.movementType} onChange={(event) => setManualMovement((current) => ({ ...current, movementType: event.target.value as typeof manualMovement.movementType }))}>
                  <option value="manual addition">Manual addition</option>
                  <option value="usage">Usage</option>
                  <option value="waste">Waste</option>
                  <option value="breakage">Breakage</option>
                  <option value="correction">Correction</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Quantity delta">
                <input className="input" type="number" step="0.01" value={manualMovement.quantityDelta} onChange={(event) => setManualMovement((current) => ({ ...current, quantityDelta: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="Note">
                <input className="input" value={manualMovement.note} onChange={(event) => setManualMovement((current) => ({ ...current, note: event.target.value }))} placeholder="Reason for this movement" />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" onClick={handleMovementSave}>
                Save movement
              </Button>
              <Button type="button" variant="ghost" onClick={() => setManualMovement(emptyManualMovement())}>
                Reset
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Manual stock count" description="Set the actual count on hand and store a count-adjustment movement." />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Counted quantity">
                <input className="input" type="number" step="0.01" value={countQuantity} onChange={(event) => setCountQuantity(event.target.value)} placeholder="Enter the stock count" />
              </Field>
              <Field label="Count note">
                <input className="input" value={countNote} onChange={(event) => setCountNote(event.target.value)} placeholder="Optional count note" />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" onClick={handleCountSave} disabled={!selectedItem}>
                Save count
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Movement ledger" description="Recent stock movements for the selected item stay visible for traceability." />
            <div className="mt-4 space-y-3">
              {selectedItemMovements.length ? (
                selectedItemMovements.map((movement) => (
                  <div key={movement.id} className="rounded-xl border border-line bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-ink">{movement.movementType}</p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          {movement.sourceInvoiceNumber ? `Invoice ${movement.sourceInvoiceNumber} · ` : ""}
                          {movement.note || "No note saved"}
                        </p>
                      </div>
                      <Badge tone={movement.quantityDelta >= 0 ? "success" : "warning"}>{movement.quantityDelta >= 0 ? "+" : ""}{movement.quantityDelta.toFixed(2)} {movement.unit}</Badge>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-700">
                      {formatDate(movement.createdAt.slice(0, 10))} · {movement.quantityBefore.toFixed(2)} → {movement.quantityAfter.toFixed(2)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-muted">Open an item to see its recent movements.</p>
              )}
            </div>
            <div className="mt-4 text-sm leading-6 text-muted">
              {selectedItemReceipts.length ? (
                <>
                  <p className="font-semibold text-ink">Recent invoice receipts</p>
                  <ul className="mt-2 space-y-2">
                    {selectedItemReceipts.map((receipt) => (
                      <li key={receipt.id} className="rounded-lg border border-line bg-white px-3 py-2">
                        {receipt.invoiceNumber} · {receipt.invoiceLineDescription || receipt.inventoryItemName}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
    </div>
  );
}
