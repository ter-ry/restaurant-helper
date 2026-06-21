import { Archive, CheckCircle2, Clock3, History, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import {
  buildCopyOrderText,
  buildReorderCsv,
  buildReorderSuggestions,
  canConfirmCountSession,
  confirmCountSession,
  countSessionProgress,
  createCountSessionDraft,
  describeCountSessionProgress,
  groupReorderSuggestionsBySupplier,
  largeAdjustmentSignal,
  normalizeCountSession,
  setCountSessionMetadata,
  updateCountSessionLine,
  upsertReorderIntent,
} from "../lib/inventoryOperations";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InventoryCountSession, InventoryCountSessionFilterKind, InventoryItem, InventoryItemStatus, PilotInventoryDraft, PilotInventoryDraftLine } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const statusOptions: Array<InventoryItemStatus | "All"> = ["All", "In stock", "Low stock", "Reorder now", "Out of stock", "Count needed"];

type ActivePanel =
  | null
  | { kind: "item"; mode: "create" | "edit"; itemId?: string; fromReceiveLineId?: string | null }
  | { kind: "receive" }
  | { kind: "adjust" }
  | { kind: "count" }
  | { kind: "count-session"; sessionId?: string | null }
  | { kind: "reorder" }
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
    inventoryCountSessions,
    inventoryReorderIntents,
    rememberInventoryMappings,
    upsertInventoryCountSession,
    confirmInventoryCountSession,
    cancelInventoryCountSession,
    upsertInventoryReorderIntent,
    resetWorkspace,
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
  const [countSessionFilterKind, setCountSessionFilterKind] = useState<InventoryCountSessionFilterKind>("all-active");
  const [countSessionFilterValue, setCountSessionFilterValue] = useState("");
  const [countSessionCountedBy, setCountSessionCountedBy] = useState("");
  const [countSessionNotes, setCountSessionNotes] = useState("");
  const [selectedCountSessionId, setSelectedCountSessionId] = useState<string | null>(null);
  const [reorderSupplierFilter, setReorderSupplierFilter] = useState("All suppliers");
  const [reorderQuantities, setReorderQuantities] = useState<Record<string, number>>({});
  const location = useLocation();
  const navigate = useNavigate();
  const receivedInvoiceRouteRef = useRef<string | null>(null);

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
  const reorderSuggestions = useMemo(() => buildReorderSuggestions(inventoryItems, inventoryReorderIntents), [inventoryItems, inventoryReorderIntents]);
  const reorderGroups = useMemo(
    () => groupReorderSuggestionsBySupplier(reorderSuggestions.filter((line) => reorderSupplierFilter === "All suppliers" || line.supplier === reorderSupplierFilter)),
    [reorderSuggestions, reorderSupplierFilter],
  );
  const reorderSupplierOptions = useMemo(() => ["All suppliers", ...Array.from(new Set(reorderSuggestions.map((line) => line.supplier)))], [reorderSuggestions]);
  const countSession = useMemo(() => inventoryCountSessions.find((session) => session.id === selectedCountSessionId) ?? null, [inventoryCountSessions, selectedCountSessionId]);
  const draftCountSessions = useMemo(
    () => inventoryCountSessions.filter((session) => session.status === "Draft" || session.status === "Ready to review").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [inventoryCountSessions],
  );
  const latestCompletedCountSession = useMemo(
    () =>
      [...inventoryCountSessions]
        .filter((session) => session.status === "Completed")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
    [inventoryCountSessions],
  );
  const latestOrderedReorderIntent = useMemo(
    () =>
      [...inventoryReorderIntents]
        .filter((intent) => intent.status === "Ordered")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
    [inventoryReorderIntents],
  );
  const latestLargeAdjustmentMovement = useMemo(() => inventoryMovements.find((movement) => largeAdjustmentSignal(movement)) ?? null, [inventoryMovements]);
  const latestReceiptMovement = useMemo(() => inventoryMovements.find((movement) => movement.movementType === "invoice receipt") ?? null, [inventoryMovements]);

  useEffect(() => {
    if (activePanel?.kind !== "receive") {
      return;
    }
    setReceiveLines(buildReceiveLines(selectedInvoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
  }, [activePanel, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices, selectedInvoiceId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const receiveInvoiceId = params.get("receive");
    if (!receiveInvoiceId || receivedInvoiceRouteRef.current === receiveInvoiceId) {
      return;
    }

    const invoice = recentInvoices.find((entry) => entry.id === receiveInvoiceId);
    if (!invoice) {
      return;
    }

    receivedInvoiceRouteRef.current = receiveInvoiceId;
    setSelectedInvoiceId(receiveInvoiceId);
    setActivePanel({ kind: "receive" });
    setReceiveLines(buildReceiveLines(receiveInvoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
    navigate(location.pathname, { replace: true });
  }, [inventoryItems, inventoryMappings, inventoryReceipts, location.pathname, location.search, navigate, recentInvoices]);

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

  const closeReceivePanel = () => {
    receivedInvoiceRouteRef.current = null;
    setActivePanel(null);
  };

  const openAdjustPanel = () => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "adjust" });
  };

  const openCountPanel = () => {
    setErrorMessage("");
    setMessage("");
    setSelectedCountSessionId(draftCountSessions[0]?.id ?? null);
    setActivePanel({ kind: "count-session", sessionId: draftCountSessions[0]?.id ?? null });
  };

  const openCountOverviewPanel = () => {
    setErrorMessage("");
    setMessage("");
    setSelectedCountSessionId(null);
    setActivePanel({ kind: "count-session", sessionId: null });
  };

  const openReorderPanel = () => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "reorder" });
  };

  const startCountSession = () => {
    if ((countSessionFilterKind === "category" || countSessionFilterKind === "supplier") && !countSessionFilterValue.trim()) {
      setErrorMessage("Choose a category or supplier before starting that filtered count.");
      return;
    }
    const nextSession = createCountSessionDraft(inventoryItems, countSessionFilterKind, countSessionFilterValue || undefined, countSessionCountedBy, countSessionNotes);
    upsertInventoryCountSession(nextSession);
    setSelectedCountSessionId(nextSession.id);
    setActivePanel({ kind: "count-session", sessionId: nextSession.id });
  };

  const openExistingCountSession = (sessionId: string) => {
    setSelectedCountSessionId(sessionId);
    setActivePanel({ kind: "count-session", sessionId });
  };

  const persistCurrentCountSession = (session: InventoryCountSession) => {
    upsertInventoryCountSession(session);
    setSelectedCountSessionId(session.id);
  };

  const updateCurrentCountSession = (updater: (session: InventoryCountSession) => InventoryCountSession) => {
    if (!countSession) return;
    const next = updater(countSession);
    persistCurrentCountSession(next);
  };

  const beginReorderExport = (format: "copy" | "csv") => {
    if (!reorderSuggestions.length) return;
    if (format === "copy") {
      const text = reorderGroups
        .map((group) => buildCopyOrderText(group.supplier, group.lines.map((line) => ({ itemName: line.itemName, adjustedQuantity: line.adjustedQuantity, unit: line.unit }))))
        .join("\n\n");
      navigator.clipboard?.writeText(text);
      setMessage("Copied reorder list to clipboard.");
      return;
    }

    const csv = buildReorderCsv(
      reorderSuggestions.map((line) => ({
        supplier: line.supplier,
        itemName: line.itemName,
        currentQuantity: line.currentQuantity,
        unit: line.unit,
        parLevel: line.parLevel,
        suggestedQuantity: line.adjustedQuantity,
        latestPurchasePrice: line.latestPurchasePrice,
        estimatedCost: line.estimatedCost,
        notes: line.note,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "flowtally-reorder-list.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Exported reorder list as CSV.");
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
    closeReceivePanel();
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

  const handleCountSessionFieldUpdate = (lineId: string, countedQuantity: string, note: string) => {
    updateCurrentCountSession((session) =>
      updateCountSessionLine(session, lineId, {
        countedQuantity: countedQuantity.trim() ? Number(countedQuantity) : null,
        note,
      }),
    );
  };

  const handleCountSessionSkip = (lineId: string) => {
    if (!countSession) return;
    persistCurrentCountSession(
      updateCountSessionLine(countSession, lineId, {
        skip: true,
      }),
    );
  };

  const handleCountSessionSaveDraft = () => {
    if (!countSession) return;
    persistCurrentCountSession({
      ...countSession,
      status: canConfirmCountSession(countSession) ? "Ready to review" : "Draft",
      updatedAt: new Date().toISOString(),
    });
    setMessage("Count session draft saved locally.");
  };

  const handleCountSessionConfirm = () => {
    if (!countSession) return;
    if (!canConfirmCountSession(countSession)) {
      setErrorMessage("Count every item or mark blanks as skipped before confirming.");
      return;
    }
    const result = confirmInventoryCountSession(countSession.id);
    if (!result.confirmed) {
      setErrorMessage("That count session could not be confirmed.");
      return;
    }
    setMessage(`Confirmed ${result.changedCount} stock adjustment${result.changedCount === 1 ? "" : "s"} from ${countSession.id}.`);
    setErrorMessage("");
    setActivePanel(null);
    setSelectedCountSessionId(null);
  };

  const handleCountSessionCancel = () => {
    if (!countSession) return;
    cancelInventoryCountSession(countSession.id);
    setMessage("Count session cancelled.");
    setErrorMessage("");
    setActivePanel(null);
    setSelectedCountSessionId(null);
  };

  const handleMarkReorderOrdered = (itemId: string) => {
    const suggestion = reorderSuggestions.find((line) => line.itemId === itemId);
    if (!suggestion) return;
    const adjustedQuantity = reorderQuantities[itemId] ?? suggestion.adjustedQuantity;
    upsertInventoryReorderIntent({
      id: suggestion.itemId,
      itemId: suggestion.itemId,
      itemName: suggestion.itemName,
      category: suggestion.category,
      supplier: suggestion.supplier,
      currentQuantity: suggestion.currentQuantity,
      unit: suggestion.unit,
      minimumQuantity: suggestion.minimumQuantity,
      parLevel: suggestion.parLevel,
      suggestedQuantity: suggestion.suggestedQuantity,
      adjustedQuantity,
      latestPurchasePrice: suggestion.latestPurchasePrice,
      estimatedCost: suggestion.estimatedCost,
      costStatus: suggestion.costStatus,
      daysRemaining: suggestion.estimatedDaysRemaining ?? undefined,
      notes: suggestion.note,
      status: "Ordered",
      markedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setMessage(`${suggestion.itemName} marked as ordered.`);
  };

  const lineItemButtons = (item: InventoryItem) => (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => openItemPanel("edit", item)}>
        Open
      </Button>
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CompactStatCard label="Tracked" value={String(summary.inventoryItemCount)} helper={summary.inventoryValue ? formatCurrency(summary.inventoryValue) : "No stock value"} />
        <CompactStatCard label="Low stock" value={String(summary.inventoryLowStockCount)} helper={`${summary.inventoryReorderNowCount} reorder now`} />
        <CompactStatCard label="Out of stock" value={String(summary.inventoryOutOfStockCount)} helper={`${summary.inventoryCountNeededCount} need count`} />
        <CompactStatCard label="Receipts" value={String(summary.inventoryReceiptCount)} helper={`${summary.inventoryMovementCount} movements`} />
        <CompactStatCard label="Reorder now" value={String(summary.inventoryReorderNowCount)} helper={summary.inventoryEstimatedReorderCost ? `Cost ${formatCurrency(summary.inventoryEstimatedReorderCost)}` : "No order value"} />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Count status</p>
          <p className="mt-2 text-sm font-semibold text-ink">
            {draftCountSessions.length ? `Draft count: ${describeCountSessionProgress(draftCountSessions[0])}` : "No draft stock count"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            {latestCompletedCountSession ? `Last completed count ${formatDate(latestCompletedCountSession.updatedAt.slice(0, 10))}` : "No completed count yet"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" icon={<Clock3 className="h-4 w-4" />} onClick={startCountSession}>
              Start stock count
            </Button>
            {draftCountSessions[0] ? (
              <Button type="button" variant="ghost" onClick={() => openExistingCountSession(draftCountSessions[0].id)}>
                Resume draft count
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={openCountOverviewPanel}>
              View count history
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Reorder status</p>
          <p className="mt-2 text-sm font-semibold text-ink">
            {summary.inventoryItemsToReorderCount ? `${summary.inventoryItemsToReorderCount} items need ordering` : "No reorder action needed"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            {summary.inventoryEstimatedReorderCost ? `Estimated reorder cost ${formatCurrency(summary.inventoryEstimatedReorderCost)}` : "No cost estimate available"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={openReorderPanel}>
              View reorder list
            </Button>
            <Button type="button" variant="ghost" onClick={() => openItemPanel("create")}>
              New item
            </Button>
          </div>
        </Card>
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

      <div className="mt-5">
        <SectionHeader
          title="Inventory list"
          description="Search, filter, and open an item to edit its stock level, supplier preference, or notes."
          action={
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={buildDemoPath(demoSlug, "invoices")}>Review invoices</Link>
              <Button type="button" variant="ghost" onClick={() => setShowArchived((current) => !current)}>
                {showArchived ? "Hide archived" : "Show archived"}
              </Button>
            </div>
          }
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
          <Button type="button" variant="secondary" onClick={openReorderPanel}>
            View reorder list
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
      </div>

      <Card className="mt-8 p-4">
        <SectionHeader title="Recent activity" description="A quick read on the most recent count, receipt, adjustment, and ordering action." />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CompactInfoCard label="Latest count" value={latestCompletedCountSession ? formatDate(latestCompletedCountSession.updatedAt.slice(0, 10)) : "No completed count"} detail={latestCompletedCountSession ? describeCountSessionProgress(latestCompletedCountSession) : "Start a count to track stock checks"} />
          <CompactInfoCard label="Latest receipt" value={latestReceiptMovement ? formatDate(latestReceiptMovement.createdAt.slice(0, 10)) : "No receipt yet"} detail={latestReceiptMovement ? latestReceiptMovement.sourceInvoiceNumber || latestReceiptMovement.note || "Invoice receipt" : "Receive an invoice to add stock"} />
          <CompactInfoCard label="Latest adjustment" value={latestLargeAdjustmentMovement ? formatDate(latestLargeAdjustmentMovement.createdAt.slice(0, 10)) : "No large adjustment"} detail={latestLargeAdjustmentMovement ? `${latestLargeAdjustmentMovement.quantityDelta >= 0 ? "+" : ""}${latestLargeAdjustmentMovement.quantityDelta.toFixed(2)} ${latestLargeAdjustmentMovement.unit}` : "Large changes will appear here"} />
          <CompactInfoCard label="Latest order" value={latestOrderedReorderIntent ? formatDate(latestOrderedReorderIntent.updatedAt.slice(0, 10)) : "No order marked"} detail={latestOrderedReorderIntent ? `${latestOrderedReorderIntent.itemName} · ${latestOrderedReorderIntent.supplier}` : "Mark an item as ordered to log it"} />
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Quiet controls</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">Restore the seeded sample workspace if you want a clean pilot reset.</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (window.confirm("Restore the seeded sample inventory, invoices, and reconciliations in this browser?")) {
                resetWorkspace();
                setMessage("Sample data restored.");
              }
            }}
          >
            Restore sample data
          </Button>
        </div>
      </Card>

      {activePanel?.kind === "item" ? (
        <ModalShell title={itemPanelTitle} onClose={() => setActivePanel(null)}>
          {selectedItem ? (
            <div className="mb-5 rounded-xl border border-line bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Item detail</p>
                  <h3 className="mt-1 text-lg font-bold text-ink">{selectedItem.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    {selectedItem.category} | {selectedItem.active ? "Active" : "Archived"} | {selectedItem.preferredSupplier || "No preferred supplier"}
                  </p>
                </div>
                <Badge tone={selectedItem.active ? "success" : "warning"}>{describeInventoryStatus(selectedItem).status}</Badge>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Current quantity" value={`${selectedItem.currentQuantity} ${selectedItem.unit}`} />
                <MiniStat label="PAR / min" value={`${selectedItem.parLevel} / ${selectedItem.minQuantity} ${selectedItem.unit}`} />
                <MiniStat label="Days remaining" value={describeInventoryStatus(selectedItem).daysRemaining ? `About ${Math.max(0, Math.round(describeInventoryStatus(selectedItem).daysRemaining ?? 0))} days` : "Usage not configured"} />
                <MiniStat label="Latest price" value={formatCurrency(selectedItem.latestPurchasePrice)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Last received" value={selectedItem.lastReceivedAt} />
                <MiniStat label="Last counted" value={selectedItem.lastCountedAt} />
                <MiniStat label="Average daily usage" value={selectedItem.averageDailyUsage ? `${selectedItem.averageDailyUsage} / day` : "Usage not configured"} />
                <MiniStat label="Purchase basis" value={selectedItem.latestPurchaseConversionFactor ? `1 ${selectedItem.latestPurchaseUnit} = ${selectedItem.latestPurchaseConversionFactor} ${selectedItem.unit}` : "Cost unavailable — confirm purchase unit"} />
              </div>
            </div>
          ) : null}
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
          {selectedItem ? (
            <div className="mt-6 rounded-xl border border-line bg-white p-4">
              <SectionHeader title="Movement timeline" description="Chronological stock activity for this item, newest first." />
              <div className="mt-4 space-y-3">
                {selectedItemMovements.length ? selectedItemMovements.map((movement) => (
                  <div key={movement.id} className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink">{movement.movementType}</p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          {movement.sourceInvoiceNumber ? `Invoice ${movement.sourceInvoiceNumber}` : ""}
                          {movement.sourceCountSessionId ? `${movement.sourceInvoiceNumber ? " | " : ""}Count session ${movement.sourceCountSessionId}` : ""}
                          {!movement.sourceInvoiceNumber && !movement.sourceCountSessionId ? "Manual entry" : ""}
                        </p>
                      </div>
                      <Badge tone={movement.quantityDelta >= 0 ? "success" : "warning"}>{movement.quantityDelta >= 0 ? "+" : ""}{movement.quantityDelta.toFixed(2)} {movement.unit}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-700">
                      {formatDate(movement.createdAt.slice(0, 10))} | {movement.quantityBefore.toFixed(2)} -&gt; {movement.quantityAfter.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted">{movement.note || "No note saved"}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {movement.sourceInvoiceId ? (
                        <Link className="inline-flex min-h-9 items-center justify-center rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink" to={buildDemoPath(demoSlug, "invoices")}>
                          Open invoice source
                        </Link>
                      ) : null}
                      {movement.sourceCountSessionId ? (
                        <Button type="button" variant="secondary" onClick={() => openExistingCountSession(movement.sourceCountSessionId || "")}>
                          Open count session
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )) : <p className="text-sm leading-6 text-muted">Open an item to see its recent movements.</p>}
              </div>
            </div>
          ) : null}
        </ModalShell>
      ) : null}

      {activePanel?.kind === "receive" ? (
        <ModalShell title="Receive from saved invoice" onClose={closeReceivePanel} wide>
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
            <Button type="button" variant="ghost" onClick={closeReceivePanel}>
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

      {activePanel?.kind === "count-session" ? (
        <ModalShell title={countSession ? "Stock count session" : "Stock count sessions"} onClose={() => setActivePanel(null)} wide>
          {countSession ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Status" value={countSession.status} />
                <MiniStat label="Progress" value={describeCountSessionProgress(countSession)} />
                <MiniStat label="Counted by" value={countSession.countedBy || "Not set"} />
                <MiniStat label="Items" value={String(countSession.itemCount)} />
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Counted by">
                  <input className="input" value={countSession.countedBy || ""} onChange={(event) => updateCurrentCountSession((session) => setCountSessionMetadata(session, { countedBy: event.target.value }))} placeholder="Optional name" disabled={countSession.status === "Completed" || countSession.status === "Cancelled"} />
                </Field>
                <Field label="Notes">
                  <input className="input" value={countSession.notes} onChange={(event) => updateCurrentCountSession((session) => setCountSessionMetadata(session, { notes: event.target.value }))} placeholder="Optional session notes" disabled={countSession.status === "Completed" || countSession.status === "Cancelled"} />
                </Field>
              </div>

              <div className="mt-5 space-y-3">
                {countSession.lines.map((line, index) => (
                  <div key={line.id} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink">
                          {index + 1}. {line.itemNameSnapshot}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          Recorded {line.recordedQuantity} {line.stockUnitSnapshot} | {line.confirmationStatus === "skipped" ? "Skipped" : line.confirmationStatus === "confirmed" ? "Counted" : "Pending"}
                        </p>
                      </div>
                      <Badge tone={line.confirmationStatus === "skipped" ? "neutral" : line.confirmationStatus === "confirmed" ? "success" : "warning"}>{line.confirmationStatus}</Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(8rem,0.45fr)_minmax(8rem,0.45fr)_minmax(0,1fr)]">
                      <MiniStat label="Recorded" value={`${line.recordedQuantity} ${line.stockUnitSnapshot}`} />
                      <label className="block min-w-0">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Counted qty</span>
                        <input
                          className="input mt-2"
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          value={line.countedQuantity ?? ""}
                          onChange={(event) => handleCountSessionFieldUpdate(line.id, event.target.value, line.note)}
                          placeholder="Enter count"
                          disabled={countSession.status === "Completed" || countSession.status === "Cancelled"}
                        />
                      </label>
                      <MiniStat label="Difference" value={line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${line.difference} ${line.stockUnitSnapshot}`} />
                      <label className="block min-w-0">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Note</span>
                        <input
                          className="input mt-2"
                          value={line.note}
                          onChange={(event) => handleCountSessionFieldUpdate(line.id, line.countedQuantity === null ? "" : String(line.countedQuantity), event.target.value)}
                          placeholder="Optional note"
                          disabled={countSession.status === "Completed" || countSession.status === "Cancelled"}
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => handleCountSessionSkip(line.id)} disabled={countSession.status === "Completed" || countSession.status === "Cancelled"}>
                        Skip
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Review summary</p>
                <div className="mt-3 grid gap-2 text-sm text-slate-700">
                  <SummaryRow label="Counted items" value={String(countSession.lines.filter((line) => line.confirmationStatus !== "pending").length)} />
                  <SummaryRow label="Missing counts" value={String(countSession.lines.filter((line) => line.confirmationStatus === "pending").length)} />
                  <SummaryRow label="Large discrepancies" value={String(countSession.lines.filter((line) => typeof line.difference === "number" && Math.abs(line.difference) >= 5).length)} />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button type="button" variant="secondary" onClick={handleCountSessionSaveDraft} disabled={countSession.status === "Completed" || countSession.status === "Cancelled"}>
                  Save draft
                </Button>
                <Button type="button" icon={<Save className="h-4 w-4" />} onClick={handleCountSessionConfirm} disabled={countSession.status === "Completed" || countSession.status === "Cancelled" || !canConfirmCountSession(countSession)}>
                  Confirm all adjustments
                </Button>
                <Button type="button" variant="ghost" onClick={handleCountSessionCancel} disabled={countSession.status === "Completed" || countSession.status === "Cancelled"}>
                  Cancel session
                </Button>
                <Button type="button" variant="ghost" onClick={openCountOverviewPanel}>
                  Back to count list
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Count scope</span>
                  <select className="input mt-2" value={countSessionFilterKind} onChange={(event) => setCountSessionFilterKind(event.target.value as InventoryCountSessionFilterKind)}>
                    <option value="all-active">All active items</option>
                    <option value="category">One category</option>
                    <option value="supplier">One supplier</option>
                    <option value="needs-count">Items needing a count</option>
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Filter value</span>
                  <input className="input mt-2" value={countSessionFilterValue} onChange={(event) => setCountSessionFilterValue(event.target.value)} placeholder="Category or supplier" />
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Counted by</span>
                  <input className="input mt-2" value={countSessionCountedBy} onChange={(event) => setCountSessionCountedBy(event.target.value)} placeholder="Optional name" />
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">Notes</span>
                  <input className="input mt-2" value={countSessionNotes} onChange={(event) => setCountSessionNotes(event.target.value)} placeholder="Optional session notes" />
                </label>
              </div>

              <div className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Draft sessions</p>
                <div className="mt-3 space-y-3">
                  {draftCountSessions.length ? (
                    draftCountSessions.map((session) => {
                      const progress = countSessionProgress(session);
                      return (
                        <div key={session.id} className="rounded-lg border border-line bg-white p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-ink">{session.countedBy || "Stock count draft"}</p>
                              <p className="mt-1 text-xs leading-5 text-muted">
                                {describeCountSessionProgress(session)} | {session.status}
                              </p>
                            </div>
                            <Badge tone={session.status === "Completed" ? "success" : session.status === "Cancelled" ? "warning" : "info"}>{session.status}</Badge>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                            <MiniStat label="Selected items" value={String(session.itemCount)} />
                            <MiniStat label="Progress" value={`${progress.percent}%`} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => openExistingCountSession(session.id)}>
                              {session.status === "Completed" ? "Review" : "Resume"}
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm leading-6 text-muted">No draft count sessions yet.</p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Completed history</p>
                <div className="mt-3 space-y-3">
                  {inventoryCountSessions.filter((session) => session.status === "Completed" || session.status === "Cancelled").slice(0, 4).map((session) => (
                    <div key={session.id} className="rounded-lg border border-line bg-white p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-ink">{session.countedBy || "Count session"}</p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {session.status} | {describeCountSessionProgress(session)}
                          </p>
                        </div>
                        <Button type="button" variant="secondary" onClick={() => openExistingCountSession(session.id)}>
                          Review
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button type="button" onClick={startCountSession}>
                  Start stock count
                </Button>
                <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
                  Close
                </Button>
              </div>
            </>
          )}
        </ModalShell>
      ) : null}

      {activePanel?.kind === "reorder" ? (
        <ModalShell title="Practical reorder list" onClose={() => setActivePanel(null)} wide>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
            <div className="rounded-lg border border-line bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">
              Suggested quantity uses PAR first, then minimum when PAR is absent. Cost is only shown when the purchase basis is known.
            </div>
            <label className="block min-w-0">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">Supplier filter</span>
              <select className="input mt-2" value={reorderSupplierFilter} onChange={(event) => setReorderSupplierFilter(event.target.value)}>
                {reorderSupplierOptions.map((supplier) => (
                  <option key={supplier} value={supplier}>
                    {supplier}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => beginReorderExport("copy")}>
              Copy order list
            </Button>
            <Button type="button" variant="secondary" onClick={() => beginReorderExport("csv")}>
              Export CSV
            </Button>
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {reorderGroups.length ? (
              reorderGroups.map((group) => (
                <div key={group.supplier} className="rounded-xl border border-line bg-white p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-ink">{group.supplier}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {group.itemCount} item{group.itemCount === 1 ? "" : "s"} | Estimated order total {group.estimatedOrderTotal ? formatCurrency(group.estimatedOrderTotal) : "Unavailable"}
                      </p>
                    </div>
                    <Badge tone="info">Needs action</Badge>
                  </div>
                  <div className="mt-4 space-y-3">
                    {group.lines.map((line) => (
                      <div key={line.id} className="rounded-lg border border-line bg-slate-50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{line.itemName}</p>
                            <p className="mt-1 text-xs leading-5 text-muted">
                              {line.stockStatus} | {line.currentQuantity} {line.unit} on hand | PAR {line.parLevel} | Min {line.minimumQuantity}
                            </p>
                          </div>
                          <Badge tone={line.status === "Ordered" ? "success" : "warning"}>{line.status}</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <MiniStat label="Suggested qty" value={`${line.suggestedQuantity} ${line.unit}`} />
                          <MiniStat label="Days remaining" value={line.estimatedDaysRemaining ? `About ${Math.max(0, Math.round(line.estimatedDaysRemaining))} days` : "Usage not configured"} />
                          <MiniStat label="Estimated cost" value={line.estimatedCost === null ? "Cost unavailable" : formatCurrency(line.estimatedCost)} />
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)]">
                          <label className="block min-w-0">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Order quantity</span>
                            <input
                              className="input mt-2"
                              type="number"
                              step="0.01"
                              value={reorderQuantities[line.itemId] ?? line.adjustedQuantity}
                              onChange={(event) => setReorderQuantities((current) => ({ ...current, [line.itemId]: Number(event.target.value) || 0 }))}
                            />
                          </label>
                          <div className="flex flex-wrap gap-2 self-end">
                            <Button type="button" variant="secondary" onClick={() => handleMarkReorderOrdered(line.itemId)}>
                              Mark as ordered
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted">No reorder action is needed right now.</p>
            )}
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

function CompactStatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
    </div>
  );
}

function CompactInfoCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}
