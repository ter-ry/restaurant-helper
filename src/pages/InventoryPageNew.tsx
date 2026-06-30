import { Archive, Clock3, History, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { buildDemoPath, useDemoProfile } from "../lib/demoProfile";
import {
  createInventoryDraft,
  describeInventoryStatus,
  getInventoryStatusTone,
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
  normalizeCountSession,
  setCountSessionMetadata,
  updateCountSessionLine,
  upsertReorderIntent,
} from "../lib/inventoryOperations";
import {
  buildInvoiceReceiveLines,
  summarizeInvoiceInventoryStatus,
  type InvoiceReceiveLineState,
} from "../lib/invoiceInventory";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InventoryCountSession, InventoryCountSessionFilterKind, InventoryItem, InventoryItemStatus, InventoryMovement, InventoryMovementType, InventoryInvoiceReceipt, PilotInventoryDraft, PilotInventoryDraftLine } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

export { buildInvoiceReceiveLines as buildReceiveLines } from "../lib/invoiceInventory";

const statusOptions: Array<InventoryItemStatus | "All"> = ["All", "In stock", "Low stock", "Reorder now", "Out of stock", "Count needed"];

type ActivePanel =
  | null
  | { kind: "item"; mode: "create" | "edit"; itemId?: string; fromReceiveLineId?: string | null }
  | { kind: "receive-queue" }
  | { kind: "receive" }
  | { kind: "adjust" }
  | { kind: "count" }
  | { kind: "count-session"; sessionId?: string | null }
  | { kind: "reorder" }
  | { kind: "activity" }
  | { kind: "history"; itemId: string };

type ManualMovementDraft = {
  itemId: string;
  movementType: Exclude<InventoryMovementType, "invoice receipt">;
  quantityDelta: number;
  note: string;
};

function emptyManualMovement(): ManualMovementDraft {
  return { itemId: "", movementType: "manual addition", quantityDelta: 1, note: "" };
}

function normalizePanelItem(item?: InventoryItem | null): PilotInventoryDraft {
  return createInventoryDraft(item ?? undefined);
}

function buildInventoryPreviewItem(draft: PilotInventoryDraft, base?: InventoryItem | null): InventoryItem {
  const now = new Date().toISOString();
  const name = draft.name.trim() || base?.name || "New item";
  const category = draft.category.trim() || base?.category || "Other";
  const unit = draft.unit.trim() || base?.unit || "each";
  const preferredSupplier = draft.preferredSupplier.trim() || base?.preferredSupplier || "";
  const currentQuantity = Number.isFinite(draft.currentQuantity) ? draft.currentQuantity : base?.currentQuantity ?? 0;
  const minQuantity = Number.isFinite(draft.minQuantity) ? draft.minQuantity : base?.minQuantity ?? 0;
  const parLevel = Number.isFinite(draft.parLevel) ? draft.parLevel : Math.max(minQuantity, base?.parLevel ?? 0);
  return {
    id: base?.id || "inventory-draft-preview",
    name,
    normalizedName: base?.normalizedName || name.toLowerCase(),
    category,
    currentQuantity,
    unit,
    minQuantity,
    parLevel,
    preferredSupplier,
    latestPurchasePrice: Number.isFinite(draft.latestPurchasePrice) ? draft.latestPurchasePrice : base?.latestPurchasePrice ?? 0,
    latestPurchaseUnit: base?.latestPurchaseUnit || unit,
    latestPurchaseConversionFactor: base?.latestPurchaseConversionFactor ?? 1,
    lastReceivedAt: base?.lastReceivedAt || now.slice(0, 10),
    lastCountedAt: base?.lastCountedAt || now.slice(0, 10),
    averageDailyUsage: draft.averageDailyUsage ?? base?.averageDailyUsage,
    supplierMatchKey: base?.supplierMatchKey || preferredSupplier.toLowerCase(),
    itemMatchKey: base?.itemMatchKey || name.toLowerCase(),
    active: draft.active,
    notes: draft.notes.trim(),
    createdAt: base?.createdAt || now,
    updatedAt: now,
  };
}

function movementLabel(type: InventoryMovementType) {
  switch (type) {
    case "manual addition":
      return "Adjustment";
    case "adjustment":
      return "Adjustment";
    case "usage":
      return "Usage";
    case "waste":
      return "Waste";
    case "spoilage / expired":
      return "Spoilage / expired";
    case "damaged":
      return "Damaged";
    case "staff meal / comped":
      return "Staff meal / comped";
    case "breakage":
      return "Breakage";
    case "count adjustment":
      return "Count adjustment";
    case "physical count adjustment":
      return "Physical count adjustment";
    case "correction":
      return "Correction";
    case "invoice receipt":
      return "Invoice receipt";
    default:
      return "Other";
  }
}

function movementTone(type: InventoryMovementType) {
  if (type === "invoice receipt") return "success" as const;
  if (type === "manual addition" || type === "adjustment" || type === "count adjustment" || type === "physical count adjustment") return "info" as const;
  if (type === "usage" || type === "waste" || type === "spoilage / expired" || type === "damaged" || type === "staff meal / comped" || type === "breakage") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function reorderStatusLabel(status: string) {
  return status === "Ordered" ? "Saved for reorder" : "Needs ordering";
}

function reorderStatusTone(status: string) {
  return status === "Ordered" ? ("success" as const) : ("warning" as const);
}

function buildReceiveQueue(
  recentInvoices: ReturnType<typeof usePilotWorkspace>["recentInvoices"],
  inventoryItems: InventoryItem[],
  inventoryMappings: ReturnType<typeof usePilotWorkspace>["inventoryMappings"],
  inventoryReceipts: InventoryInvoiceReceipt[],
) {
  return recentInvoices
    .flatMap((invoice) => {
      const inventoryStatus = summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
      if (inventoryStatus === "Received" || inventoryStatus === "No tracked items") {
        return [];
      }

      const lines = buildInvoiceReceiveLines(invoice.id, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices);
      return lines
        .filter((line) => line.state !== "already-received")
        .map((line) => ({
          invoiceId: invoice.id,
          supplier: invoice.supplier,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          invoiceStatus: inventoryStatus,
          ...line,
        }));
    })
    .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());
}

function buildRecentNonReceiptMovements(movements: InventoryMovement[]) {
  return sortInventoryMovementsNewestFirst(movements)
    .filter((movement) => movement.movementType !== "invoice receipt")
    .slice(0, 8);
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
    deleteInventoryReorderIntent,
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
  const [manualMovement, setManualMovement] = useState<ManualMovementDraft>(() => emptyManualMovement());
  const [countQuantity, setCountQuantity] = useState("");
  const [countNote, setCountNote] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(recentInvoices[0]?.id ?? "");
  const [receiveLines, setReceiveLines] = useState<InvoiceReceiveLineState[]>([]);
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
  const openReorderFromState = (location.state as { openPanel?: string } | null)?.openPanel === "reorder";

  const selectedItem = useMemo(() => inventoryItems.find((item) => item.id === selectedItemId) ?? null, [inventoryItems, selectedItemId]);
  const selectedHistoryItemId = activePanel?.kind === "history" ? activePanel.itemId : null;
  const selectedHistoryItem = useMemo(() => inventoryItems.find((item) => item.id === selectedHistoryItemId) ?? null, [inventoryItems, selectedHistoryItemId]);
  const itemPreview = useMemo(
    () => (activePanel?.kind === "item" ? buildInventoryPreviewItem(itemDraft, selectedItem) : null),
    [activePanel?.kind, itemDraft, selectedItem],
  );

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
  const selectedItemReceipts = useMemo(() => inventoryReceipts.filter((receipt) => receipt.inventoryItemId === selectedItem?.id).slice(0, 6), [inventoryReceipts, selectedItem?.id]);
  const selectedItemCountSessions = useMemo(
    () =>
      inventoryCountSessions
        .filter((session) => session.lines.some((line) => line.inventoryItemId === selectedItem?.id))
        .slice(0, 4),
    [inventoryCountSessions, selectedItem?.id],
  );
  const historyMovements = selectedHistoryItemMovements(selectedHistoryItemId, inventoryMovements);
  const reorderSuggestions = useMemo(() => buildReorderSuggestions(inventoryItems, inventoryReorderIntents), [inventoryItems, inventoryReorderIntents]);
  const plannedReorderIds = useMemo(
    () => new Set(inventoryReorderIntents.filter((intent) => intent.status === "Ordered").map((intent) => intent.itemId)),
    [inventoryReorderIntents],
  );
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
  const activeItems = useMemo(() => sortInventoryItems(inventoryItems).filter((item) => item.active), [inventoryItems]);
  const receiveQueue = useMemo(() => buildReceiveQueue(recentInvoices, inventoryItems, inventoryMappings, inventoryReceipts), [inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices]);
  const recentMovementsFeed = useMemo(() => sortInventoryMovementsNewestFirst(inventoryMovements).slice(0, 8), [inventoryMovements]);
  const activeCountSessions = useMemo(() => inventoryCountSessions.filter((session) => session.status === "Draft" || session.status === "Ready to review"), [inventoryCountSessions]);
  const countSessionsSummary = useMemo(
    () => ({
      draft: inventoryCountSessions.filter((session) => session.status === "Draft").length,
      ready: inventoryCountSessions.filter((session) => session.status === "Ready to review").length,
      completed: inventoryCountSessions.filter((session) => session.status === "Completed").length,
      cancelled: inventoryCountSessions.filter((session) => session.status === "Cancelled").length,
    }),
    [inventoryCountSessions],
  );
  const lowStockRiskItems = useMemo(() => inventoryItems.filter((item) => item.active && (describeInventoryStatus(item).daysRemaining ?? Number.POSITIVE_INFINITY) <= 14), [inventoryItems]);
  const belowParItems = useMemo(() => inventoryItems.filter((item) => item.active && (item.currentQuantity <= item.parLevel || item.currentQuantity <= item.minQuantity)), [inventoryItems]);
  const pendingReceiveInvoices = useMemo(
    () =>
      recentInvoices.filter((invoice) => {
        const status = summarizeInvoiceInventoryStatus(invoice, inventoryReceipts);
        return status !== "Received" && status !== "No tracked items";
      }),
    [inventoryReceipts, recentInvoices],
  );

  useEffect(() => {
    if (activePanel?.kind !== "receive") {
      return;
    }
    setReceiveLines(buildInvoiceReceiveLines(selectedInvoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
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
    setReceiveLines(buildInvoiceReceiveLines(receiveInvoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
    navigate(location.pathname, { replace: true });
  }, [inventoryItems, inventoryMappings, inventoryReceipts, location.pathname, location.search, navigate, recentInvoices]);

  useEffect(() => {
    if (!activePanel || activePanel.kind !== "item") {
      return;
    }
    if (activePanel.mode === "create") {
      if (activePanel.fromReceiveLineId) {
        return;
      }
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

  const closeItemPanel = () => {
    if (activePanel?.kind === "item" && activePanel.fromReceiveLineId) {
      setActivePanel({ kind: "receive" });
      return;
    }
    setActivePanel(null);
  };

  const openReceivePanel = (invoiceId = selectedInvoiceId) => {
    setErrorMessage("");
    setMessage("");
    if (invoiceId) {
      setSelectedInvoiceId(invoiceId);
    }
    setActivePanel({ kind: "receive" });
    setReceiveLines(buildInvoiceReceiveLines(invoiceId, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices));
  };

  const closeReceivePanel = () => {
    receivedInvoiceRouteRef.current = null;
    setActivePanel(null);
  };

  useEffect(() => {
    if (openReorderFromState) {
      setActivePanel({ kind: "reorder" });
    }
  }, [openReorderFromState]);

  const openAdjustPanel = (movementType: Exclude<InventoryMovementType, "invoice receipt"> = "adjustment", item?: InventoryItem | null) => {
    setErrorMessage("");
    setMessage("");
    setManualMovement((current) => ({
      ...current,
      itemId: item?.id ?? current.itemId,
      movementType,
      quantityDelta: movementType === "manual addition" || movementType === "adjustment" ? 1 : -1,
    }));
    if (item) {
      setSelectedItemId(item.id);
    }
    setActivePanel({ kind: "adjust" });
  };

  const openWastePanel = () => openAdjustPanel("waste");

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

  const openReceiveQueuePanel = () => {
    setErrorMessage("");
    setMessage("");
    setActivePanel({ kind: "receive-queue" });
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
      setMessage("Copied draft order list to clipboard.");
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
    setMessage("Exported draft order CSV.");
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
    if (activePanel?.kind === "item" && activePanel.fromReceiveLineId) {
      setReceiveLines((current) =>
        current.map((line) =>
          line.invoiceLineItemId === activePanel.fromReceiveLineId
            ? {
                ...line,
                selectedItemId: saved.id,
                state: "linked",
                matchLabel: "Previously mapped",
                inventoryUnit: saved.unit,
                conversionFactor: line.conversionFactor || 1,
              }
            : line,
        ),
      );
      setActivePanel({ kind: "receive" });
    } else {
      setActivePanel(null);
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
    const linkedCount = receiveLines.filter((line) => line.state === "linked" && line.selectedItemId).length;
    const skippedCount = receiveLines.filter((line) => line.state === "do-not-track").length;
    const alreadyReceivedCount = receiveLines.filter((line) => line.state === "already-received").length;
    const unresolvedCount = receiveLines.filter((line) => line.state === "unmapped" || (line.state === "linked" && !line.selectedItemId)).length;
    let inventoryStatus: "Not received" | "Partially received" | "Received" | "No tracked items" | "Skipped" = "Not received";

    if (receiveLines.length === 0 || (skippedCount === receiveLines.length && linkedCount === 0 && alreadyReceivedCount === 0)) {
      inventoryStatus = "No tracked items";
    } else if (alreadyReceivedCount === receiveLines.length || (unresolvedCount === 0 && (linkedCount > 0 || alreadyReceivedCount > 0))) {
      inventoryStatus = "Received";
    } else if (linkedCount > 0 || skippedCount > 0 || alreadyReceivedCount > 0) {
      inventoryStatus = "Partially received";
    }

    const result = recordInventoryReceipt(selectedInvoiceId, mappedLines, inventoryStatus);
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

    setMessage(
      result.recorded > 0
        ? `Recorded ${result.recorded} invoice receipt line${result.recorded === 1 ? "" : "s"} and updated inventory.`
        : "This purchase was already received. No duplicate stock movement was created.",
    );
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

  const handleSaveForReorder = (itemId: string) => {
    const suggestion = reorderSuggestions.find((line) => line.itemId === itemId);
    if (!suggestion) return;
    const adjustedQuantity = reorderQuantities[itemId] - suggestion.adjustedQuantity;
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
    setMessage(`${suggestion.itemName} added to the reorder plan.`);
  };

  const handleRemoveFromReorderPlan = (itemId: string) => {
    const suggestion = reorderSuggestions.find((line) => line.itemId === itemId);
    if (!suggestion) return;
    deleteInventoryReorderIntent(itemId);
    setMessage(`${suggestion.itemName} removed from the reorder plan.`);
  };

  const lineItemButtons = (item: InventoryItem) => (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={() => openItemPanel("edit", item)}>
        Open
      </Button>
      <Button type="button" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => openAdjustPanel("adjustment", item)}>
        Adjust
      </Button>
      <Button type="button" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => openHistoryPanel(item.id)}>
        History
      </Button>
    </div>
  );

  return (
    <PageLayout
      title="Inventory"
      eyebrow="Restaurant operations"
      description="What stock changed, what needs receiving, and what needs reordering."
    >
      <Card className="surface-panel p-5 sm:p-6">
        <div className="flex flex-col gap-4 border-b border-line pb-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">Inventory</p>
            <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Stock changes, receiving, and reorder needs.</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="warning">Low stock {summary.inventoryLowStockCount}</Badge>
            <Badge tone="orange">Reorder list {reorderSuggestions.length}</Badge>
            <Badge tone="info">Plan {inventoryReorderIntents.filter((intent) => intent.status === "Ordered").length}</Badge>
            <Badge tone="info">Needs receiving {pendingReceiveInvoices.length}</Badge>
            <Badge tone={countSessionsSummary.draft || countSessionsSummary.ready ? "warning" : "neutral"}>
              Count {countSessionsSummary.draft || countSessionsSummary.ready ? "Not finished" : "Not started"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" icon={<ShoppingCart className="h-4 w-4" />} onClick={openReceiveQueuePanel}>
              Receive queue
            </Button>
            <Button type="button" variant="secondary" icon={<Clock3 className="h-4 w-4" />} onClick={openCountPanel}>
              Start count
            </Button>
            <Button type="button" variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={openWastePanel}>
              Log waste
            </Button>
            <Button type="button" icon={<Archive className="h-4 w-4" />} onClick={openReorderPanel}>
              Reorder list ({reorderSuggestions.length})
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <SectionHeader
            title="Inventory list"
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowArchived((current) => !current)}>
                  {showArchived ? "Hide archived" : "Show archived"}
                </Button>
                <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => openItemPanel("create")}>
                  New item
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
            <Badge tone="info">{statusCounts.visible} visible</Badge>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {filteredItems.map((item) => {
              const status = describeInventoryStatus(item);
              return (
                <div key={item.id} className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:bg-slate-50 ${selectedItemId === item.id ? "border-brand-200 bg-brand-50/40" : "border-line bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{item.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {item.category} Â· {item.preferredSupplier || "No preferred supplier"}
                      </p>
                    </div>
                    <Badge tone={item.active ? getInventoryStatusTone(status.status) : "warning"}>{item.active ? status.status : "Archived"}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                    <MiniStat label="On hand" value={`${item.currentQuantity} ${item.unit}`} />
                    <MiniStat label="PAR / min" value={`${item.parLevel} / ${item.minQuantity} ${item.unit}`} />
                    <MiniStat label="Days remaining" value={status.daysRemaining ? `${Math.max(0, Math.round(status.daysRemaining ?? 0))} days` : "Usage not configured"} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    {item.lastReceivedAt ? `Last received ${formatDate(item.lastReceivedAt)}` : "No receipt recorded yet"} Â· {item.lastCountedAt ? `Counted ${formatDate(item.lastCountedAt)}` : "No count saved yet"}
                  </p>
                  {lineItemButtons(item)}
                </div>
              );
            })}
          </div>
        </div>

        {/*
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="min-w-0 border border-line bg-white p-5">
            <SectionHeader
              title="Receive queue"
              description="Purchase lines waiting for confirmation before they update stock."
              action={<Badge tone="info">{receiveQueue.length} lines</Badge>}
            />
            {receiveQueue.length ? (
              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted">
                  {receiveQueue.length} purchase line{receiveQueue.length === 1 ? "" : "s"} waiting to be received.
                </p>
                {receiveQueue.slice(0, 3).map((line) => (
                  <div key={`${line.invoiceId}-${line.invoiceLineItemId}`} className="rounded-xl border border-line bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink">{line.supplier}</p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          {line.invoiceNumber || "No invoice number"} ? {formatDate(line.invoiceDate)}
                        </p>
                        <p className="mt-1 truncate text-xs leading-5 text-muted">{line.invoiceLineName}</p>
                      </div>
                      <Badge tone={line.matchLabel === "Previously mapped" || line.matchLabel === "Suggested match" ? "success" : line.state === "unmapped" ? "warning" : "info"}>{line.matchLabel}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                      <span>{line.invoiceQuantity} {line.invoiceUnit}</span>
                      <span>{formatCurrency(line.unitPrice)}</span>
                      <span>{(line.invoiceQuantity * line.conversionFactor).toFixed(2)} {line.inventoryUnit}</span>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="secondary" onClick={() => openReceivePanel()}>
                  Open receive queue
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                No purchase lines need receiving right now.
              </div>
            )}
          </Card>

          <Card className="min-w-0 border border-line bg-white p-5">
            <SectionHeader
              title="Stock count"
              description="Start a count, resume a draft, or review recent count activity."
              action={<Badge tone="info">{draftCountSessions.length + activeCountSessions.length} open or draft</Badge>}
            />
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Current status</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {draftCountSessions.length ? `Draft count: ${describeCountSessionProgress(draftCountSessions[0])}` : "Stock count: Not started"}
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
                      Resume draft
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" onClick={openCountOverviewPanel}>
                    View history
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <CompactInfoCard label="Draft" value={String(countSessionsSummary.draft)} detail="Started but not reviewed" />
                <CompactInfoCard label="Ready" value={String(countSessionsSummary.ready)} detail="Can be confirmed now" />
                <CompactInfoCard label="Completed" value={String(countSessionsSummary.completed)} detail="Saved count sessions" />
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="min-w-0 border border-line bg-white p-5">
            <SectionHeader
              title="Waste & adjustments"
              description="Log waste, spoilage, damaged stock, and corrections."
              action={<Badge tone="warning">{recentNonReceiptMovements.length} recent</Badge>}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => openAdjustPanel("adjustment")}>
                Add adjustment
              </Button>
              <Button type="button" variant="secondary" onClick={() => openWastePanel()}>
                Log waste
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {recentNonReceiptMovements.length ? (
                recentNonReceiptMovements.slice(0, 3).map((movement) => (
                  <div key={movement.id} className="rounded-xl border border-line bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink">{movementLabel(movement.movementType)}</p>
                        <p className="mt-1 truncate text-xs leading-5 text-muted">
                          {movement.inventoryItemName} ? {movement.sourceInvoiceNumber ? `Invoice ${movement.sourceInvoiceNumber}` : movement.sourceCountSessionName || "Manual entry"}
                        </p>
                      </div>
                      <Badge tone={movementTone(movement.movementType)}>{movement.quantityDelta >= 0 ? "+" : ""}{movement.quantityDelta.toFixed(2)} {movement.unit}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted">{formatDate(movement.createdAt.slice(0, 10))}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                  Waste and adjustment actions will show here after they are recorded.
                </div>
              )}
            </div>
          </Card>

          <Card className="min-w-0 border border-line bg-white p-5">
            <SectionHeader
              title="Reorder plan"
              description="Grouped by supplier in the plan drawer. Draft only; no supplier message is sent."
              action={<Badge tone="info">{summary.inventoryItemsToReorderCount} need ordering</Badge>}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={openReorderPanel}>
                Open reorder plan
              </Button>
              <Button type="button" variant="ghost" onClick={() => openItemPanel("create")}>
                New item
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {reorderSuggestions.slice(0, 3).map((line) => (
                <div key={line.id} className="rounded-xl border border-line bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{line.itemName}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {line.supplier} Â· {line.currentQuantity} {line.unit} on hand Â· order {line.adjustedQuantity} {line.unit}
                      </p>
                    </div>
                    <Badge tone={reorderStatusTone(line.status)}>{reorderStatusLabel(line.status)}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    PAR {line.parLevel} Â· Min {line.minimumQuantity} Â· {line.estimatedDaysRemaining ? `${Math.max(0, Math.round(line.estimatedDaysRemaining))} days left` : "Usage not configured"}{line.estimatedCost === null ? "" : ` Â· ${formatCurrency(line.estimatedCost)}`}
                  </p>
                </div>
              ))}
              {!reorderSuggestions.length ? <p className="text-sm leading-6 text-muted">No reorder action is needed right now.</p> : null}
            </div>
          </Card>
        </div>

        <Card className="mt-5 p-4">
          <SectionHeader
            title="Recent activity"
            description="Latest movements only. Open the full activity view for more detail."
            action={<Button type="button" variant="ghost" onClick={openActivityPanel}>View all</Button>}
          />
          <div className="mt-4 space-y-3">
            {recentMovementsFeed.length ? (
              recentMovementsFeed.slice(0, 4).map((movement) => (
                <div key={movement.id} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{movement.inventoryItemName}</p>
                      <p className="mt-1 truncate text-xs leading-5 text-muted">
                        {movementLabel(movement.movementType)} ? {movement.sourceInvoiceNumber || movement.sourceCountSessionName || "Manual entry"}
                      </p>
                    </div>
                    <Badge tone={movementTone(movement.movementType)}>{movement.quantityDelta >= 0 ? "+" : ""}{movement.quantityDelta.toFixed(2)} {movement.unit}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">{formatDate(movement.createdAt.slice(0, 10))} ? {movement.note || "No note saved"}</p>
                </div>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted">No movement history yet.</p>
            )}
          </div>
        </Card>

        </Card>
        </div>
        */}
      </Card>

      {activePanel?.kind === "receive-queue" ? (
        <ModalShell title="Receive queue" onClose={() => setActivePanel(null)} wide>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{receiveQueue.length} pending lines</Badge>
            <Badge tone="neutral">{pendingReceiveInvoices.length} invoices with pending receiving</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {receiveQueue.length ? (
              receiveQueue.map((line) => (
                <div key={`${line.invoiceId}-${line.invoiceLineItemId}`} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{line.supplier}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {line.invoiceNumber || "No invoice number"} Â· {formatDate(line.invoiceDate)}
                      </p>
                      <p className="mt-1 truncate text-xs leading-5 text-muted">{line.invoiceLineName}</p>
                    </div>
                      <Badge tone={line.matchLabel === "Previously mapped" || line.matchLabel === "Suggested match" ? "success" : line.state === "unmapped" ? "warning" : "info"}>{line.matchLabel}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                    <span>{line.invoiceQuantity} {line.invoiceUnit}</span>
                    <span>{formatCurrency(line.unitPrice)}</span>
                    <span>{(line.invoiceQuantity * line.conversionFactor).toFixed(2)} {line.inventoryUnit}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        openReceivePanel(line.invoiceId);
                        setActivePanel({ kind: "receive" });
                      }}
                    >
                      Open receive flow
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted">No purchase lines need receiving right now.</p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
              Close
            </Button>
          </div>
        </ModalShell>
      ) : null}

      {activePanel?.kind === "item" ? (
        <ModalShell title={itemPanelTitle} onClose={closeItemPanel}>
          {itemPreview ? (
            <div className="mb-5 rounded-xl border border-line bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Live preview</p>
                  <h3 className="mt-1 text-lg font-bold text-ink">{itemPreview.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    {itemPreview.category} | {itemPreview.active ? "Active" : "Archived"} | {itemPreview.preferredSupplier || "No preferred supplier"}
                  </p>
                </div>
                <Badge tone={itemPreview.active ? getInventoryStatusTone(describeInventoryStatus(itemPreview).status) : "warning"}>{describeInventoryStatus(itemPreview).status}</Badge>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Current quantity" value={`${itemPreview.currentQuantity} ${itemPreview.unit}`} />
                <MiniStat label="PAR / min" value={`${itemPreview.parLevel} / ${itemPreview.minQuantity} ${itemPreview.unit}`} />
                <MiniStat label="Days remaining" value={describeInventoryStatus(itemPreview).daysRemaining ? `About ${Math.max(0, Math.round(describeInventoryStatus(itemPreview).daysRemaining ?? 0))} days` : "Usage not configured"} />
                <MiniStat label="Latest price" value={formatCurrency(itemPreview.latestPurchasePrice)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Last received" value={itemPreview.lastReceivedAt} />
                <MiniStat label="Last counted" value={itemPreview.lastCountedAt} />
                <MiniStat label="Average daily usage" value={itemPreview.averageDailyUsage ? `${itemPreview.averageDailyUsage} / day` : "Usage not configured"} />
                <MiniStat label="Purchase basis" value={itemPreview.latestPurchaseConversionFactor ? `1 ${itemPreview.latestPurchaseUnit} = ${itemPreview.latestPurchaseConversionFactor} ${itemPreview.unit}` : "Cost unavailable — confirm purchase unit"} />
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Linked purchases</p>
                  <div className="mt-3 space-y-2">
                    {selectedItemReceipts.length ? (
                      selectedItemReceipts.map((receipt) => (
                        <div key={receipt.id} className="rounded-lg border border-line bg-slate-50 p-3">
                          <p className="text-sm font-semibold text-ink">{receipt.supplier}</p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {receipt.invoiceNumber || "No invoice number"} Â· {formatDate(receipt.invoiceDate)} Â· {receipt.quantity} {receipt.unit}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted">{receipt.invoiceLineDescription}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm leading-6 text-muted">No linked purchase receipts yet.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Related count sessions</p>
                  <div className="mt-3 space-y-2">
                    {selectedItemCountSessions.length ? (
                      selectedItemCountSessions.map((session) => (
                        <div key={session.id} className="rounded-lg border border-line bg-slate-50 p-3">
                          <p className="text-sm font-semibold text-ink">{session.countedBy || session.id}</p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {session.status} Â· {describeCountSessionProgress(session)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm leading-6 text-muted">No related count sessions yet.</p>
                    )}
                  </div>
                </div>
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
            {activePanel.fromReceiveLineId ? null : (
              <Button type="button" variant="secondary" onClick={() => openItemPanel(itemMode, selectedItem ?? undefined)}>
                Reset
              </Button>
            )}
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
          {receiveLines.length > 0 && receiveLines.every((line) => line.state === "already-received") ? (
            <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-brand-800">
              This purchase has already been received into inventory. The lines below are view-only so duplicate stock movements are not created.
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Saved invoice">
              <select className="input" value={selectedInvoiceId} onChange={(event) => { setSelectedInvoiceId(event.target.value); setReceiveLines(buildInvoiceReceiveLines(event.target.value, inventoryItems, inventoryMappings, inventoryReceipts, recentInvoices)); }}>
                {recentInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.supplier} / {invoice.invoiceNumber || invoice.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Workflow note">
              <div className="rounded-lg border border-dashed border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
                First-time matches stay manual. Previously mapped items are suggested, but the user still confirms them before receiving.
              </div>
            </Field>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Match progress</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-700">
                <Badge tone="success">Ready {receiveLines.filter((line) => line.state === "linked").length}</Badge>
                <Badge tone="warning">Needs confirmation {receiveLines.filter((line) => line.state === "unmapped" || (line.state === "linked" && !line.selectedItemId)).length}</Badge>
                <Badge tone="neutral">Skipped {receiveLines.filter((line) => line.state === "do-not-track").length}</Badge>
                <Badge tone="success">Completed {receiveLines.filter((line) => line.state === "already-received").length}</Badge>
              </div>
            </div>
            {receiveLines.map((line) => {
              const item = inventoryItems.find((candidate) => candidate.id === line.selectedItemId) ?? null;
              const canLink = line.state !== "already-received";
              const canChooseItem = line.state !== "already-received" && line.state !== "do-not-track";
              return (
                <div key={line.invoiceLineItemId} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-ink">{line.invoiceLineName}</p>
                        <Badge tone={line.matchLabel === "Previously mapped" || line.matchLabel === "Suggested match" ? "success" : line.state === "do-not-track" ? "neutral" : line.state === "already-received" ? "warning" : "warning"}>{line.matchLabel}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {line.sourceDescription} | Qty {line.invoiceQuantity} {line.invoiceUnit} | Unit price {formatCurrency(line.unitPrice)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canLink ? (
                        <>
                          <Button type="button" variant="secondary" onClick={() => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, state: "linked", selectedItemId: line.suggestedItemId ?? entry.selectedItemId, matchLabel: entry.matchLabel === "Previously mapped" ? "Previously mapped" : line.suggestedItemId ? "Suggested match" : "Needs confirmation" } : entry)))}>
                            Use suggested match
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
                            setItemPanelTitle("Create inventory item from invoice line");
                          }}>
                            Create new item
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, state: "do-not-track", selectedItemId: "", matchLabel: "Not mapped" } : entry)))}>
                            Do not track
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {canChooseItem ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.55fr)_minmax(0,1fr)]">
                      <Field label="Inventory item">
                        <select className="input" value={line.selectedItemId} onChange={(event) => setReceiveLines((current) => current.map((entry) => (entry.invoiceLineItemId === line.invoiceLineItemId ? { ...entry, state: event.target.value ? "linked" : "unmapped", selectedItemId: event.target.value, matchLabel: line.matchLabel === "Previously mapped" ? "Previously mapped" : line.suggestedItemId === event.target.value ? "Suggested match" : event.target.value ? "Needs confirmation" : "Not mapped" } : entry)))}>
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
                      {line.invoiceQuantity} {line.invoiceUnit} Ã— {line.conversionFactor} = {(line.invoiceQuantity * line.conversionFactor).toFixed(2)} {line.inventoryUnit}
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
            {receiveLines.length > 0 && receiveLines.every((line) => line.state === "already-received") ? null : (
              <Button type="button" icon={<Save className="h-4 w-4" />} onClick={handleReceiveSave} disabled={receiveLines.some((line) => line.state === "unmapped" || (line.state === "linked" && !line.selectedItemId))}>
                Save stock movements
              </Button>
            )}
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
                      <MiniStat label="Difference" value={line.difference === null ? "â€”" : `${line.difference > 0 ? "+" : ""}${line.difference} ${line.stockUnitSnapshot}`} />
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
        <ModalShell title="Reorder plan" onClose={() => setActivePanel(null)} wide>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
            <div className="rounded-lg border border-line bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-700">
              Suggested quantity uses PAR first, then minimum when PAR is absent. Cost is only shown when the purchase basis is known. Supplier sending is a future integration, and no message is sent.
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
              Copy draft
            </Button>
            <Button type="button" variant="secondary" onClick={() => beginReorderExport("csv")}>
              Export draft CSV
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
                        {group.itemCount} item{group.itemCount === 1 ? "" : "s"} Â· Estimated order total {group.estimatedOrderTotal ? formatCurrency(group.estimatedOrderTotal) : "Unavailable"}
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
                              {line.stockStatus} Â· {line.currentQuantity} {line.unit} on hand Â· PAR {line.parLevel} Â· Min {line.minimumQuantity}
                            </p>
                          </div>
                          <Badge tone={reorderStatusTone(line.status)}>{reorderStatusLabel(line.status)}</Badge>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <MiniStat label="Suggested qty" value={`${line.suggestedQuantity} ${line.unit}`} />
                          <MiniStat label="Latest price" value={line.latestPurchasePrice ? formatCurrency(line.latestPurchasePrice) : "No price yet"} />
                          <MiniStat label="Estimated cost" value={line.estimatedCost === null ? "Cost unavailable" : formatCurrency(line.estimatedCost)} />
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted">
                          {line.estimatedDaysRemaining ? `About ${Math.max(0, Math.round(line.estimatedDaysRemaining))} days left` : "Usage not configured"}
                        </p>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)]">
                          <label className="block min-w-0">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Order quantity</span>
                            <input
                              className="input mt-2"
                              type="number"
                              step="0.01"
                              value={reorderQuantities[line.itemId] - line.adjustedQuantity}
                              onChange={(event) => setReorderQuantities((current) => ({ ...current, [line.itemId]: Number(event.target.value) || 0 }))}
                            />
                          </label>
                          <div className="flex flex-wrap gap-2 self-end">
                            {plannedReorderIds.has(line.itemId) ? (
                              <Button type="button" variant="secondary" onClick={() => handleRemoveFromReorderPlan(line.itemId)}>
                                Remove from plan
                              </Button>
                            ) : (
                              <Button type="button" variant="secondary" onClick={() => handleSaveForReorder(line.itemId)}>
                                Add to reorder plan
                              </Button>
                            )}
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

      {activePanel?.kind === "activity" ? (
        <ModalShell title="Recent inventory activity" onClose={() => setActivePanel(null)}>
          <div className="space-y-3">
            {recentMovementsFeed.length ? (
              recentMovementsFeed.map((movement) => (
                <div key={movement.id} className="rounded-xl border border-line bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{movement.inventoryItemName}</p>
                      <p className="mt-1 truncate text-xs leading-5 text-muted">
                        {movementLabel(movement.movementType)} Â· {movement.sourceInvoiceNumber || movement.sourceCountSessionName || "Manual entry"}
                      </p>
                    </div>
                    <Badge tone={movementTone(movement.movementType)}>{movement.quantityDelta >= 0 ? "+" : ""}{movement.quantityDelta.toFixed(2)} {movement.unit}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    {formatDate(movement.createdAt.slice(0, 10))} Â· {movement.note || "No note saved"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted">No movement history yet.</p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" variant="ghost" onClick={() => setActivePanel(null)}>
              Close
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
