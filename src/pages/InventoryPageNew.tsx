import { Archive, CheckCircle2, Clock3, History, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { buildDemoPath, useDemoProfile } from "../lib/demoProfile";
import {
  buildInventoryMappingKey,
  createInventoryDraft,
  describeInventoryStatus,
  findExactInventoryItemSuggestion,
  findRememberedInventoryMapping,
  rememberInventoryMapping,
  sortInventoryItems,
  sortInventoryMovementsNewestFirst,
} from "../lib/inventoryWorkspace";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InventoryItem, InventoryItemStatus, PilotInventoryDraft, PilotInventoryDraftLine } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const statusOptions: Array<InventoryItemStatus | "All"> = ["All", "In stock", "Low stock", "Reorder now", "Out of stock", "Count needed"];

type ActivePanel =
  | null
  | { kind: "item"; mode: "create" | "edit"; itemId?: string; fromReceiveLineId?: string | null }
  | { kind: "receive" }
  | { kind: "adjust" }
  | { kind: "count" }
  | { kind: "history"; itemId: string };

type ReceiveLineState = {
  invoiceLineItemId: string;
  invoiceLineName: string;
  sourceDescription: string;
  invoiceQuantity: number;
  invoiceUnit: string;
  unitPrice: number;
  selectedItemId: string;
  state: "unmapped" | "linked" | "do-not-track" | "already-received";
  matchLabel: "Previously confirmed" | "Suggested match" | "Not mapped" | "Already received";
  conversionFactor: number;
  inventoryUnit: string;
  note: string;
  suggestedItemId?: string;
};

function emptyManualMovement() {
  return { itemId: "", movementType: "manual addition" as const, quantityDelta: 1, note: "" };
}

export function buildReceiveLines(
  invoiceId: string,
  inventoryItems: InventoryItem[],
  inventoryMappings: ReturnType<typeof usePilotWorkspace>["inventoryMappings"],
  inventoryReceipts: ReturnType<typeof usePilotWorkspace>["inventoryReceipts"],
  recentInvoices: ReturnType<typeof usePilotWorkspace>["recentInvoices"],
): ReceiveLineState[] {
  const invoice = recentInvoices.find((item) => item.id === invoiceId) ?? null;
  if (!invoice) {
    return [];
  }

  return invoice.lineItems.map((line, index) => {
    const sourceDescription = line.originalDescription || line.itemName || line.rawSourceLine || `Line ${index + 1}`;
    const lineKey = line.comparisonKey || sourceDescription;
    const remembered = findRememberedInventoryMapping(inventoryMappings, invoice.supplier, lineKey);
    const exactMatch = findExactInventoryItemSuggestion(inventoryItems, lineKey);
    const alreadyReceived = inventoryReceipts.some((receipt) => receipt.invoiceId === invoice.id && receipt.invoiceLineItemId === line.id);

    if (alreadyReceived) {
      return {
        invoiceLineItemId: line.id,
        invoiceLineName: line.itemName || sourceDescription,
        sourceDescription,
        invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
        invoiceUnit: line.unit || "each",
        unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
        selectedItemId: "",
        state: "already-received",
        matchLabel: "Already received",
        conversionFactor: 1,
        inventoryUnit: line.unit || "each",
        note: "",
      };
    }

    if (remembered) {
      return {
        invoiceLineItemId: line.id,
        invoiceLineName: line.itemName || sourceDescription,
        sourceDescription,
        invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
        invoiceUnit: line.unit || "each",
        unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
        selectedItemId: remembered.inventoryItemId,
        state: "linked",
        matchLabel: "Previously confirmed",
        conversionFactor: remembered.conversionFactor || 1,
        inventoryUnit: remembered.inventoryUnit || line.unit || "each",
        note: "",
        suggestedItemId: remembered.inventoryItemId,
      };
    }

    return {
      invoiceLineItemId: line.id,
      invoiceLineName: line.itemName || sourceDescription,
      sourceDescription,
      invoiceQuantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1,
      invoiceUnit: line.unit || "each",
      unitPrice: Number.isFinite(line.unitPrice) ? line.unitPrice : 0,
      selectedItemId: "",
      state: "unmapped",
      matchLabel: exactMatch ? "Suggested match" : "Not mapped",
      conversionFactor: 1,
      inventoryUnit: exactMatch?.unit || line.unit || "each",
      note: "",
      suggestedItemId: exactMatch?.id,
    };
  });
}

function normalizePanelItem(item?: InventoryItem | null): PilotInventoryDraft {
  return createInventoryDraft(item ?? undefined);
}

export function InventoryPage() {
  const demo = useDemoProfile();
  const demoSlug = demo.slug as "cafe" | "quick-service" | "full-service";
  const {
    inventoryItems,
    inventoryMovements,
    inventoryReceipts,
    inventoryMappings,
    rememberInventoryMappings,
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
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(inventoryItems[0]?.id ?? null);
  const [itemDraft, setItemDraft] = useState<PilotInventoryDraft>(() => createInventoryDraft());
  const [itemMode, setItemMode] = useState<"create" | "edit">("create");
  const [itemPanelTitle, setItemPanelTitle] = useState("New inventory item");
  const [manualMovement, setManualMovement] = useState(emptyManualMovement());
  const [countQuantity, setCountQuantity] = useState("");
  const [countNote, setCountNote] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(recentInvoices[0]?.id ?? "");
  const [receiveLines, setReceiveLines] = useState<ReceiveLineState[]>([]);

  const selectedItem = useMemo(() => inventoryItems.find((item) => item.id === selectedItemId) ?? null, [inventoryItems, selectedItemId]);
  const selectedHistoryItemId = activePanel?.kind === "history" ? activePanel.itemId : null;
  const selectedHistoryItem = useMemo(() => inventoryItems.find((item) => item.id === selectedHistoryItemId) ?? null, [inventoryItems, selectedHistoryItemId]);

  const filteredItems = useMemo(() => {
    return sortInventoryItems(inventoryItems).filter((item) => {
      if (!showArchived && !item.active) return false;
      const status = describeInventoryStatus(item).status;
      if (statusFilter !== "All" && status !== statusFilter) return false;
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const haystack = `${item.name} ${item.category} ${item.preferredSupplier} ${item.notes} ${status}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [inventoryItems, search, showArchived, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { visible: 0 };
    for (const item of sortInventoryItems(inventoryItems)) {
      if (!showArchived && !item.active) continue;
      const status = describeInventoryStatus(item).status;
      if (statusFilter !== "All" && status !== statusFilter) continue;
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const haystack = `${item.name} ${item.category} ${item.preferredSupplier} ${status}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      counts.visible += 1;
    }
    return counts;
  }, [inventoryItems, search, showArchived, statusFilter]);

  const selectedItemMovements = useMemo(
    () => sortInventoryMovementsNewestFirst(inventoryMovements.filter((movement) => movement.inventoryItemId === selectedItem?.id)).slice(0, 8),
    [inventoryMovements, selectedItem?.id],
  );
  const historyMovements = selectedHistoryItemMovements(selectedHistoryItemId, inventoryMovements);

  useEffect(() => {
    if (activePanel?.kind !== "receive") {
      return;
    }
    setReceiveLines(buildReceiveLines(selectedInvoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
  }, [activePanel, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices, selectedInvoiceId]);

  useEffect(() => {
    if (!activePanel || activePanel.kind !== "item") {
      return;
    }
    if (activePanel.mode === "create") {
      setItemDraft(createInventoryDraft());
      setItemPanelTitle("New inventory item");
      setItemMode("create");
      return;
    }
    const item = inventoryItems.find((candidate) => candidate.id === activePanel.itemId) ?? null;
    setItemDraft(normalizePanelItem(item));
    setItemPanelTitle(item ? `Edit inventory item` : "Edit inventory item");
    setItemMode("edit");
  }, [activePanel, inventoryItems]);

  const openItemPanel = (mode: "create" | "edit", item?: InventoryItem, fromReceiveLineId?: string | null) => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "item", mode, itemId: item?.id, fromReceiveLineId: fromReceiveLineId ?? null });
    setSelectedItemId(item?.id ?? null);
    setItemMode(mode);
    setItemPanelTitle(mode === "create" ? "New inventory item" : "Edit inventory item");
    setItemDraft(normalizePanelItem(item));
  };

  const openReceivePanel = () => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "receive" });
    setReceiveLines(buildReceiveLines(selectedInvoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
  };

  const openAdjustPanel = () => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "adjust" });
  };

  const openCountPanel = () => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "count" });
  };

  const openHistoryPanel = (itemId: string) => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "history", itemId });
  };

  const handleSaveItem = () => {
    if (!itemDraft.name.trim()) {
      setErrorMessage("Enter an item name before saving.");
      return;
    }

    const saved = saveInventoryItem(itemDraft);
    setMessage(`${itemMode === "create" ? "Created" : "Updated"} ${saved.name} successfully.`);
    setErrorMessage("");
    setSelectedItemId(saved.id);
    setActivePanel(null);
    if (activePanel?.kind === "item" && activePanel.fromReceiveLineId) {
      setReceiveLines((current) =>
        current.map((line) =>
          line.invoiceLineItemId === activePanel.fromReceiveLineId
            ? {
                ...line,
                selectedItemId: saved.id,
                state: "linked",
                matchLabel: "Previously confirmed",
                inventoryUnit: saved.unit,
                conversionFactor: line.conversionFactor || 1,
              }
            : line,
        ),
      );
      setActivePanel({ kind: "receive" });
    }
  };

  const handleReceiveSave = () => {
    if (!selectedInvoiceId) {
      setErrorMessage("Choose an invoice first.");
      return;
    }
    if (receiveLines.some((line) => line.state === "unmapped" || (line.state === "linked" && !line.selectedItemId))) {
      setErrorMessage("Each invoice line must be linked, skipped, or already received before saving.");
      return;
    }

    const mappedLines: PilotInventoryDraftLine[] = receiveLines
      .filter((line) => line.state === "linked" && line.selectedItemId)
      .map((line) => ({
        invoiceLineItemId: line.invoiceLineItemId,
        inventoryItemId: line.selectedItemId,
        quantity: line.invoiceQuantity,
        conversionFactor: line.conversionFactor,
        note: line.note,
      }));

    const result = recordInventoryReceipt(selectedInvoiceId, mappedLines);
    const invoice = recentInvoices.find((entry) => entry.id === selectedInvoiceId);
    if (invoice) {
      let nextMappings = inventoryMappings;
      for (const line of receiveLines) {
        if (line.state !== "linked" || !line.selectedItemId) continue;
        const item = inventoryItems.find((candidate) => candidate.id === line.selectedItemId);
        if (!item) continue;
        nextMappings = rememberInventoryMapping(nextMappings, {
          supplierKey: invoice.supplier,
          lineKey: line.sourceDescription,
          inventoryItemId: item.id,
          inventoryItemName: item.name,
          confirmedInvoiceUnit: line.invoiceUnit,
          inventoryUnit: line.inventoryUnit || item.unit,
          conversionFactor: line.conversionFactor,
        });
      }
      if (nextMappings !== inventoryMappings) {
        rememberInventoryMappings(nextMappings);
      }
    }

    setMessage(`Recorded ${result.recorded} invoice receipt line${result.recorded === 1 ? "" : "s"}${result.skipped ? `, skipped ${result.skipped} duplicates` : ""}.`);
    setErrorMessage("");
    setActivePanel(null);
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
    setActivePanel(null);
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
    setActivePanel(null);
    setErrorMessage("");
  };

  const handleDelete = () => {
    if (!selectedItem) return;
    if (window.confirm(`Delete ${selectedItem.name}? This removes the local record and its history from this browser.`)) {
      deleteInventoryItem(selectedItem.id);
      setMessage(`${selectedItem.name} deleted.`);
      setActivePanel(null);
      setSelectedItemId(null);
    }
  };

  const handleArchive = () => {
    if (!selectedItem) return;
    archiveInventoryItem(selectedItem.id);
    setMessage(`${selectedItem.name} archived.`);
  };

  const lineItemButtons = (item: InventoryItem) => (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => openItemPanel("edit", item)}>
        Edit
      </Button>
      <Button type="button" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => openHistoryPanel(item.id)}>
        History
      </Button>
    </div>
  );

  return (
    <PageLayout
      title="Inventory"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="A first-pass inventory foundation built from saved invoices, manual counts, and a conservative movement ledger."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Inventory items" value={String(summary.inventoryItemCount)} helper={`${summary.inventoryValue ? formatCurrency(summary.inventoryValue) : "No stock value yet"}`} />
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

      <Card className="mt-8 p-5">
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
              <input className="w-full min-w-0 bg-transparent text-sm outline-none" placeholder="Item, supplier, category" value={search} onChange={(event) => setSearch(event.target.value)} />
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
          <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => openItemPanel("create")}>
            New item
          </Button>
          <Button type="button" variant="secondary" icon={<ShoppingCart className="h-4 w-4" />} onClick={openReceivePanel}>
            Receive from saved invoice
          </Button>
          <Button type="button" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={openAdjustPanel}>
            Adjust stock
          </Button>
          <Button type="button" variant="secondary" icon={<Clock3 className="h-4 w-4" />} onClick={openCountPanel}>
            Physical count
          </Button>
          <Button type="button" variant="ghost" onClick={() => setShowArchived((current) => !current)}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Badge tone="info">{statusCounts.visible} visible</Badge>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {filteredItems.map((item) => {
            const status = describeInventoryStatus(item);
            return (
              <div key={item.id} className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:bg-slate-50 ${selectedItemId === item.id ? "border-brand-200 bg-brand-50/40" : "border-line bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.category} | {item.preferredSupplier || "No preferred supplier"}
                    </p>
                  </div>
                  <Badge tone={item.active ? "success" : "warning"}>{item.active ? status.status : "Archived"}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <MiniStat label="On hand" value={`${item.currentQuantity} ${item.unit}`} />
                  <MiniStat label="Par" value={`${item.parLevel} ${item.unit}`} />
                  <MiniStat label="Min" value={`${item.minQuantity} ${item.unit}`} />
                  <MiniStat label="Latest price" value={formatCurrency(item.latestPurchasePrice)} />
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">
                  {item.lastReceivedAt ? `Last received ${formatDate(item.lastReceivedAt)}` : "No receipt recorded yet"} | {item.lastCountedAt ? `Counted ${formatDate(item.lastCountedAt)}` : "No count saved yet"}
                </p>
                {lineItemButtons(item)}
              </div>
            );
          })}
        </div>
      </Card>

      {activePanel?.kind === "item" ? (
        <ModalShell title={itemPanelTitle} onClose={() => setActivePanel(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Item name">
              <input className="input" value={itemDraft.name} onChange={(event) => setItemDraft((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Category">
              <input className="input" value={itemDraft.category} onChange={(event) => setItemDraft((current) => ({ ...current, category: event.target.value }))} />
            </Field>
            <Field label="Current quantity">
              <input className="input" type="number" step="0.01" value={itemDraft.currentQuantity} onChange={(event) => setItemDraft((current) => ({ ...current, currentQuantity: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="Unit">
              <input className="input" value={itemDraft.unit} onChange={(event) => setItemDraft((current) => ({ ...current, unit: event.target.value }))} />
            </Field>
            <Field label="Minimum quantity">
              <input className="input" type="number" step="0.01" value={itemDraft.minQuantity} onChange={(event) => setItemDraft((current) => ({ ...current, minQuantity: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="PAR level">
              <input className="input" type="number" step="0.01" value={itemDraft.parLevel} onChange={(event) => setItemDraft((current) => ({ ...current, parLevel: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="Preferred supplier">
              <input className="input" value={itemDraft.preferredSupplier} onChange={(event) => setItemDraft((current) => ({ ...current, preferredSupplier: event.target.value }))} />
            </Field>
            <Field label="Latest purchase price">
              <input className="input" type="number" step="0.01" value={itemDraft.latestPurchasePrice} onChange={(event) => setItemDraft((current) => ({ ...current, latestPurchasePrice: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="Average daily usage">
              <input className="input" type="number" step="0.01" value={itemDraft.averageDailyUsage ?? ""} onChange={(event) => setItemDraft((current) => ({ ...current, averageDailyUsage: event.target.value.trim() ? Number(event.target.value) || 0 : undefined }))} />
            </Field>
            <Field label="Notes">
              <textarea className="input min-h-28" value={itemDraft.notes} onChange={(event) => setItemDraft((current) => ({ ...current, notes: event.target.value }))} />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" icon={<Save className="h-4 w-4" />} onClick={handleSaveItem}>
              {itemMode === "create" ? "Create item" : "Save changes"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => openItemPanel(itemMode, selectedItem ?? undefined)}>
              Reset
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
        </ModalShell>
      ) : null}

      {activePanel?.kind === "receive" ? (
        <ModalShell title="Receive from saved invoice" onClose={() => setActivePanel(null)} wide>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Saved invoice">
              <select className="input" value={selectedInvoiceId} onChange={(event) => { setSelectedInvoiceId(event.target.value); setReceiveLines(buildReceiveLines(event.target.value, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices)); }}>
                {recentInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.supplier} / {invoice.invoiceNumber || invoice.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Workflow note">
              <div className="rounded-lg border border-dashed border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
                First-time mappings stay manual. Previously confirmed mappings are suggested but never auto-received.
              </div>
            </Field>
          </div>

          <div className="mt-5 space-y-4">
            {receiveLines.map((line) => {
              const item = inventoryItems.find((candidate) => candidate.id === line.selectedItemId) ?? null;
              const canLink = line.state !== "already-received";
              return (
                <div key={line.invoiceLineItemId} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-ink">{line.invoiceLineName}</p>
                        <Badge tone={line.state === "linked" ? "success" : line.state === "do-not-track" ? "neutral" : line.state === "already-received" ? "warning" : "warning"}>{line.matchLabel}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {line.sourceDescription} | Qty {line.invoiceQuantity} {line.invoiceUnit} | Unit price {formatCurrency(line.unitPrice)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canLink ? (
                        <>
                          <Button type="button" variant="secondary" onClick={() => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, state: "linked", selectedItemId: line.suggestedItemId ?? entry.selectedItemId, matchLabel: entry.matchLabel === "Previously confirmed" ? "Previously confirmed" : line.suggestedItemId ? "Suggested match" : "Not mapped" } : entry)))}>
                            Link existing item
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => {
                            const source = recentInvoices.find((invoice) => invoice.id === selectedInvoiceId);
                            if (!source) return;
                            setActivePanel({ kind: "item", mode: "create", fromReceiveLineId: line.invoiceLineItemId });
                            setItemDraft({
                              ...createInventoryDraft(),
                              name: line.sourceDescription,
                              preferredSupplier: source.supplier,
                              latestPurchasePrice: line.unitPrice,
                              category: "Other",
                              currentQuantity: 0,
                              minQuantity: 0,
                              parLevel: 0,
                            });
                            setItemMode("create");
                            setItemPanelTitle("New inventory item");
                          }}>
                            Create new inventory item
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, state: "do-not-track", selectedItemId: "", matchLabel: "Not mapped" } : entry)))}>
                            Do not track
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {line.state === "linked" ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.55fr)_minmax(0,1fr)]">
                      <Field label="Inventory item">
                        <select className="input" value={line.selectedItemId} onChange={(event) => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, selectedItemId: event.target.value, matchLabel: line.matchLabel === "Previously confirmed" ? "Previously confirmed" : line.suggestedItemId === event.target.value ? "Suggested match" : "Not mapped" } : entry)))}>
                          <option value="">Choose item</option>
                          {sortInventoryItems(inventoryItems).map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Conversion factor">
                        <input className="input" type="number" step="0.01" value={line.conversionFactor} onChange={(event) => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, conversionFactor: Number(event.target.value) || 1 } : entry)))} />
                      </Field>
                      <Field label="Note">
                        <input className="input" value={line.note} onChange={(event) => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, note: event.target.value } : entry)))} placeholder="Optional receipt note" />
                      </Field>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-lg border border-dashed border-line bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <p className="font-semibold text-ink">Effective stock addition</p>
                    <p className="mt-1">
                      {line.invoiceQuantity} {line.invoiceUnit} × {line.conversionFactor} = {(line.invoiceQuantity * line.conversionFactor).toFixed(2)} {line.inventoryUnit}
                    </p>
                    {item ? <p className="mt-1 text-xs text-muted">Receiving into {item.name}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Receipt confirmation summary</p>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              <SummaryRow label="Mapped lines" value={String(receiveLines.filter((line) => line.state === "linked").length)} />
              <SummaryRow label="Skipped lines" value={String(receiveLines.filter((line) => line.state === "do-not-track").length)} />
              <SummaryRow label="Already received" value={String(receiveLines.filter((line) => line.state === "already-received").length)} />
              <SummaryRow label="Unresolved lines" value={String(receiveLines.filter((line) => line.state === "unmapped" || (line.state === "linked" && !line.selectedItemId)).length)} />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" icon={<Save className="h-4 w-4" />} onClick={handleReceiveSave} disabled={receiveLines.some((line) => line.state === "unmapped" || (line.state === "linked" && !line.selectedItemId))}>
              Save stock movements
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
              Cancel
            </Button>
          </div>
        </ModalShell>
      ) : null}

      {activePanel?.kind === "adjust" ? (
        <ModalShell title="Adjust stock" onClose={() => setActivePanel(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
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
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={handleMovementSave}>
              Save movement
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
              Cancel
            </Button>
          </div>
        </ModalShell>
      ) : null}

      {activePanel?.kind === "count" ? (
        <ModalShell title="Physical count" onClose={() => setActivePanel(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Counted quantity">
              <input className="input" type="number" step="0.01" value={countQuantity} onChange={(event) => setCountQuantity(event.target.value)} placeholder="Enter the stock count" />
            </Field>
            <Field label="Count note">
              <input className="input" value={countNote} onChange={(event) => setCountNote(event.target.value)} placeholder="Optional count note" />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={handleCountSave} disabled={!selectedItem}>
              Save count
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
              Cancel
            </Button>
          </div>
        </ModalShell>
      ) : null}

      {activePanel?.kind === "history" ? (
        <ModalShell title={`Movement history${selectedHistoryItem ? `: ${selectedHistoryItem.name}` : ""}`} onClose={() => setActivePanel(null)} wide>
          <div className="space-y-3">
            {historyMovements.length ? historyMovements.map((movement) => (
              <div key={movement.id} className="rounded-xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-ink">{movement.movementType}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{movement.sourceInvoiceNumber ? `Invoice ${movement.sourceInvoiceNumber} | ` : ""}{movement.note || "No note saved"}</p>
                  </div>
                  <Badge tone={movement.quantityDelta >= 0 ? "success" : "warning"}>{movement.quantityDelta >= 0 ? "+" : ""}{movement.quantityDelta.toFixed(2)} {movement.unit}</Badge>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-700">{formatDate(movement.createdAt.slice(0, 10))} | {movement.quantityBefore.toFixed(2)} -&gt; {movement.quantityAfter.toFixed(2)}</p>
              </div>
            )) : <p className="text-sm leading-6 text-muted">Open an item to see its recent movements.</p>}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>Close</Button>
          </div>
        </ModalShell>
      ) : null}
    </PageLayout>
  );
}

function selectedHistoryItemMovements(itemId: string | null | undefined, inventoryMovements: ReturnType<typeof usePilotWorkspace>["inventoryMovements"]) {
  if (!itemId) return [];
  return sortInventoryMovementsNewestFirst(inventoryMovements.filter((movement) => movement.inventoryItemId === itemId)).slice(0, 8);
}

function ModalShell({
  title,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true">
      <div className={`mx-auto flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl ${wide ? "max-w-7xl" : "max-w-4xl"}`}>
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Focused workflow</p>
            <h2 className="mt-1 text-lg font-bold text-ink sm:text-xl">{title}</h2>
          </div>
          <Button type="button" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
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
