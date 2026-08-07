import { describeInventoryStatus, sortInventoryItems } from "./inventoryWorkspace";
import type {
  InventoryCountLineStatus,
  InventoryCountSession,
  InventoryCountSessionFilterKind,
  InventoryCountSessionLine,
  InventoryCountSessionStatus,
  InventoryItem,
  InventoryMovement,
  InventoryReorderIntent,
  InventoryReorderLineStatus,
  PilotInventoryState,
} from "../types";

function nowIso() {
  return new Date().toISOString();
}

function clampQuantity(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function clampMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function buildId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getCandidateItems(items: InventoryItem[], filterKind: InventoryCountSessionFilterKind, filterValue?: string) {
  const activeItems = sortInventoryItems(items).filter((item) => item.active);
  switch (filterKind) {
    case "category":
      return activeItems.filter((item) => item.category === filterValue);
    case "supplier":
      return activeItems.filter((item) => item.preferredSupplier === filterValue);
    case "needs-count":
      return activeItems.filter((item) => describeInventoryStatus(item).status === "Count needed");
    default:
      return activeItems;
  }
}

export function createCountSessionDraft(
  items: InventoryItem[],
  filterKind: InventoryCountSessionFilterKind = "all-active",
  filterValue?: string,
  countedBy = "",
  notes = "",
): InventoryCountSession {
  const now = nowIso();
  const candidateItems = getCandidateItems(items, filterKind, filterValue);
  return {
    id: buildId("count-session"),
    status: "Draft",
    startedAt: now,
    filterKind,
    selectedCategory: filterKind === "category" ? filterValue : undefined,
    selectedSupplier: filterKind === "supplier" ? filterValue : undefined,
    itemCount: candidateItems.length,
    countedBy: countedBy.trim() || undefined,
    notes: notes.trim(),
    lines: candidateItems.map((item) => ({
      id: buildId("count-line"),
      inventoryItemId: item.id,
      itemNameSnapshot: item.name,
      stockUnitSnapshot: item.unit,
      recordedQuantity: clampQuantity(item.currentQuantity),
      countedQuantity: null,
      difference: null,
      resultingQuantity: null,
      note: "",
      confirmationStatus: "pending" as InventoryCountLineStatus,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeCountSessionStatus(value: string | undefined): InventoryCountSessionStatus {
  switch (value) {
    case "Draft":
    case "Ready to review":
    case "Completed":
    case "Cancelled":
      return value;
    default:
      return "Draft";
  }
}

export function normalizeCountSessionLine(line: Partial<InventoryCountSessionLine>): InventoryCountSessionLine {
  const countedQuantity = typeof line.countedQuantity === "number" && Number.isFinite(line.countedQuantity) ? clampQuantity(line.countedQuantity) : null;
  const recordedQuantity = clampQuantity(Number(line.recordedQuantity ?? 0));
  const confirmed = line.confirmationStatus === "confirmed";
  const skipped = line.confirmationStatus === "skipped";
  const difference = countedQuantity === null ? null : clampQuantity(countedQuantity - recordedQuantity);
  const resultingQuantity = countedQuantity === null ? null : clampQuantity(countedQuantity);
  return {
    id: line.id || buildId("count-line"),
    inventoryItemId: line.inventoryItemId || "",
    itemNameSnapshot: line.itemNameSnapshot || "Unknown item",
    stockUnitSnapshot: line.stockUnitSnapshot || "each",
    recordedQuantity,
    countedQuantity,
    difference,
    resultingQuantity,
    note: line.note?.trim() || "",
    confirmationStatus: confirmed ? "confirmed" : skipped ? "skipped" : "pending",
  };
}

export function normalizeCountSession(session: Partial<InventoryCountSession>): InventoryCountSession {
  const now = nowIso();
  const lines = Array.isArray(session.lines) ? session.lines.map((line) => normalizeCountSessionLine(line)) : [];
  return {
    id: session.id || buildId("count-session"),
    status: normalizeCountSessionStatus(session.status),
    startedAt: session.startedAt || session.createdAt || now,
    completedAt: session.completedAt,
    selectedCategory: session.selectedCategory?.trim() || undefined,
    selectedSupplier: session.selectedSupplier?.trim() || undefined,
    filterKind: session.filterKind || "all-active",
    itemCount: Number.isFinite(session.itemCount) ? Number(session.itemCount) : lines.length,
    countedBy: session.countedBy?.trim() || undefined,
    notes: session.notes?.trim() || "",
    lines,
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt || now,
  };
}

export function countSessionProgress(session: InventoryCountSession) {
  const counted = session.lines.filter((line) => line.confirmationStatus !== "pending").length;
  return {
    counted,
    total: session.lines.length,
    remaining: Math.max(0, session.lines.length - counted),
    percent: session.lines.length ? Math.round((counted / session.lines.length) * 100) : 0,
  };
}

export function updateCountSessionLine(
  session: InventoryCountSession,
  lineId: string,
  updates: { countedQuantity?: number | null; note?: string; skip?: boolean },
) {
  return {
    ...session,
    status: "Draft" as const,
    updatedAt: nowIso(),
    lines: session.lines.map((line) => {
      if (line.id !== lineId) {
        return line;
      }

      if (updates.skip) {
        return {
          ...line,
          countedQuantity: null,
          difference: null,
          resultingQuantity: null,
          confirmationStatus: "skipped" as const,
          note: updates.note?.trim() ?? line.note,
        };
      }

      const countedQuantity = typeof updates.countedQuantity === "number" && Number.isFinite(updates.countedQuantity) ? clampQuantity(updates.countedQuantity) : null;
      const difference = countedQuantity === null ? null : clampQuantity(countedQuantity - line.recordedQuantity);
      return {
        ...line,
        countedQuantity,
        difference,
        resultingQuantity: countedQuantity,
        confirmationStatus: countedQuantity === null ? "pending" as const : "confirmed" as const,
        note: updates.note?.trim() ?? line.note,
      };
    }),
  };
}

export function setCountSessionMetadata(session: InventoryCountSession, updates: Partial<Pick<InventoryCountSession, "countedBy" | "notes" | "selectedCategory" | "selectedSupplier">>) {
  return {
    ...session,
    countedBy: updates.countedBy === undefined ? session.countedBy : updates.countedBy.trim() || undefined,
    notes: updates.notes === undefined ? session.notes : updates.notes.trim(),
    selectedCategory: updates.selectedCategory === undefined ? session.selectedCategory : updates.selectedCategory.trim() || undefined,
    selectedSupplier: updates.selectedSupplier === undefined ? session.selectedSupplier : updates.selectedSupplier.trim() || undefined,
    updatedAt: nowIso(),
  };
}

export function normalizeReorderIntent(intent: Partial<InventoryReorderIntent>): InventoryReorderIntent {
  const now = nowIso();
  return {
    id: intent.id || buildId("reorder-intent"),
    itemId: intent.itemId || "",
    itemName: intent.itemName || "Unknown item",
    category: intent.category || "Other",
    supplier: intent.supplier || "Unknown supplier",
    currentQuantity: clampQuantity(Number(intent.currentQuantity ?? 0)),
    unit: intent.unit || "each",
    minimumQuantity: clampQuantity(Number(intent.minimumQuantity ?? 0)),
    parLevel: clampQuantity(Number(intent.parLevel ?? 0)),
    suggestedQuantity: clampQuantity(Number(intent.suggestedQuantity ?? 0)),
    adjustedQuantity: clampQuantity(Number(intent.adjustedQuantity ?? intent.suggestedQuantity ?? 0)),
    latestPurchasePrice: clampMoney(Number(intent.latestPurchasePrice ?? 0)),
    estimatedCost: intent.estimatedCost === null ? null : typeof intent.estimatedCost === "number" && Number.isFinite(intent.estimatedCost) ? clampMoney(intent.estimatedCost) : null,
    costStatus: intent.costStatus === "available" ? "available" : "unavailable",
    daysRemaining: typeof intent.daysRemaining === "number" && Number.isFinite(intent.daysRemaining) ? Number(intent.daysRemaining.toFixed(1)) : null,
    notes: intent.notes?.trim() || "",
    status: intent.status || "Needs ordering",
    markedAt: intent.markedAt,
    createdAt: intent.createdAt || now,
    updatedAt: intent.updatedAt || now,
  };
}

export function canConfirmCountSession(session: InventoryCountSession) {
  return session.status !== "Completed" && session.status !== "Cancelled" && session.lines.every((line) => line.confirmationStatus !== "pending");
}

export function confirmCountSession(
  state: Pick<PilotInventoryState, "items" | "movements" | "countSessions">,
  sessionId: string,
) {
  const now = nowIso();
  const session = state.countSessions.find((candidate) => candidate.id === sessionId);
  if (!session || !canConfirmCountSession(session)) {
    return null;
  }

  const updatedItems = [...state.items];
  const updatedMovements = [...state.movements];
  let changedCount = 0;

  for (const line of session.lines) {
    if (line.confirmationStatus !== "confirmed" || line.countedQuantity === null) {
      continue;
    }

    const itemIndex = updatedItems.findIndex((candidate) => candidate.id === line.inventoryItemId);
    if (itemIndex === -1) {
      continue;
    }

    const item = updatedItems[itemIndex];
    const nextQuantity = clampQuantity(line.countedQuantity);
    const delta = clampQuantity(nextQuantity - item.currentQuantity);
    if (delta !== 0) {
      changedCount += 1;
      updatedMovements.unshift({
        id: buildId("inventory-movement"),
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        movementType: "physical count adjustment",
        quantityDelta: delta,
        quantityBefore: item.currentQuantity,
        quantityAfter: nextQuantity,
        unit: item.unit,
        sourceCountSessionId: session.id,
        sourceCountSessionName: session.countedBy?.trim() || session.notes?.trim() || `Count session ${session.id}`,
        note: line.note || `Physical count session ${session.id}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    updatedItems[itemIndex] = {
      ...item,
      currentQuantity: nextQuantity,
      lastCountedAt: now.slice(0, 10),
      updatedAt: now,
    };
  }

  const nextSessions = state.countSessions.map((candidate) =>
    candidate.id === session.id
      ? {
          ...candidate,
          status: "Completed" as const,
          completedAt: now,
          updatedAt: now,
        }
      : candidate,
  );

  return {
    items: updatedItems,
    movements: updatedMovements,
    countSessions: nextSessions,
    changedCount,
  };
}

export function cancelCountSession(state: Pick<PilotInventoryState, "countSessions">, sessionId: string) {
  const now = nowIso();
  return state.countSessions.map((candidate) =>
    candidate.id === sessionId
      ? {
          ...candidate,
          status: "Cancelled" as const,
          completedAt: candidate.completedAt || now,
          updatedAt: now,
        }
      : candidate,
  );
}

function getReorderThreshold(item: InventoryItem) {
  if (item.parLevel > 0) {
    return { value: item.parLevel, source: "PAR" as const };
  }

  if (item.minQuantity > 0) {
    return { value: item.minQuantity, source: "minimum" as const };
  }

  return { value: 0, source: "none" as const };
}

export function buildReorderSuggestions(items: InventoryItem[], intents: InventoryReorderIntent[] = []) {
  const orderedByItem = new Map(intents.map((intent) => [intent.itemId, intent] as const));

  return sortInventoryItems(items)
    .filter((item) => item.active)
    .map((item) => {
      const stockStatus = describeInventoryStatus(item).status;
      const threshold = getReorderThreshold(item);
      const suggestedQuantity = threshold.source === "none" ? 0 : Math.max(0, Number((threshold.value - item.currentQuantity).toFixed(2)));
      const intent = orderedByItem.get(item.id);
      const convertedCost = calculateEstimatedCost(item, suggestedQuantity);

      return {
        id: item.id,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        supplier: item.preferredSupplier || "No preferred supplier",
        currentQuantity: item.currentQuantity,
        unit: item.unit,
        minimumQuantity: item.minQuantity,
        parLevel: item.parLevel,
        thresholdSource: threshold.source,
        suggestedQuantity,
        estimatedDaysRemaining: item.averageDailyUsage && item.averageDailyUsage > 0 ? item.currentQuantity / item.averageDailyUsage : null,
        latestPurchasePrice: item.latestPurchasePrice,
        estimatedCost: convertedCost.estimatedCost,
        costStatus: convertedCost.costStatus,
        stockStatus,
        note: intent?.notes || "",
        status: intent?.status || ("Needs ordering" as InventoryReorderLineStatus),
        adjustedQuantity: intent?.adjustedQuantity ?? suggestedQuantity,
        markedAt: intent?.markedAt,
        latestPurchaseUnit: item.latestPurchaseUnit,
        latestPurchaseConversionFactor: item.latestPurchaseConversionFactor,
      };
    })
    .filter((line) => line.stockStatus === "Out of stock" || line.stockStatus === "Reorder now" || line.status !== "Needs ordering");
}

function calculateEstimatedCost(item: InventoryItem, suggestedQuantity: number) {
  const factor = typeof item.latestPurchaseConversionFactor === "number" && Number.isFinite(item.latestPurchaseConversionFactor) ? item.latestPurchaseConversionFactor : null;
  if (!factor || factor <= 0 || !item.latestPurchaseUnit) {
    return { estimatedCost: null as number | null, costStatus: "unavailable" as const };
  }

  const purchaseQuantity = suggestedQuantity / factor;
  if (!Number.isFinite(purchaseQuantity)) {
    return { estimatedCost: null as number | null, costStatus: "unavailable" as const };
  }

  return {
    estimatedCost: clampMoney(purchaseQuantity * item.latestPurchasePrice),
    costStatus: "available" as const,
  };
}

export function groupReorderSuggestionsBySupplier<T extends { supplier: string; estimatedCost: number | null }>(lines: T[]) {
  const groups = new Map<string, T[]>();
  for (const line of lines) {
    const bucket = groups.get(line.supplier) || [];
    bucket.push(line);
    groups.set(line.supplier, bucket);
  }

  return [...groups.entries()].map(([supplier, supplierLines]) => ({
    supplier,
    lines: supplierLines,
    itemCount: supplierLines.length,
    estimatedOrderTotal: clampMoney(supplierLines.reduce((sum, line) => sum + (line.estimatedCost ?? 0), 0)),
  }));
}

export function buildCopyOrderText(supplier: string, lines: Array<{ itemName: string; adjustedQuantity: number; unit: string }>) {
  return [
    supplier,
    ...lines.map((line) => `- ${line.itemName}: ${line.adjustedQuantity} ${line.unit}`),
  ].join("\n");
}

export function buildReorderCsv(lines: Array<{
  supplier: string;
  itemName: string;
  currentQuantity: number;
  unit: string;
  parLevel: number;
  suggestedQuantity: number;
  latestPurchasePrice: number;
  estimatedCost: number | null;
  notes: string;
}>) {
  const header = ["supplier","item","current quantity","unit","PAR","suggested order quantity","latest price","estimated cost","notes"];
  const rows = lines.map((line) => [
    line.supplier,
    line.itemName,
    String(line.currentQuantity),
    line.unit,
    String(line.parLevel),
    String(line.suggestedQuantity),
    String(line.latestPurchasePrice.toFixed(2)),
    line.estimatedCost === null ? "" : line.estimatedCost.toFixed(2),
    line.notes,
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value: string) {
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function upsertReorderIntent(
  intents: InventoryReorderIntent[],
  payload: {
    itemId: string;
    itemName: string;
    category: string;
    supplier: string;
    currentQuantity: number;
    unit: string;
    minimumQuantity: number;
    parLevel: number;
    suggestedQuantity: number;
    adjustedQuantity?: number;
    latestPurchasePrice: number;
    estimatedCost: number | null;
    costStatus: "available" | "unavailable";
    daysRemaining?: number | null;
    notes?: string;
    status?: InventoryReorderLineStatus;
  },
) {
  const now = nowIso();
  const existing = intents.find((intent) => intent.itemId === payload.itemId && intent.supplier === payload.supplier);
  const record: InventoryReorderIntent = {
    id: existing?.id || buildId("reorder-intent"),
    itemId: payload.itemId,
    itemName: payload.itemName,
    category: payload.category,
    supplier: payload.supplier,
    currentQuantity: clampQuantity(payload.currentQuantity),
    unit: payload.unit,
    minimumQuantity: clampQuantity(payload.minimumQuantity),
    parLevel: clampQuantity(payload.parLevel),
    suggestedQuantity: clampQuantity(payload.suggestedQuantity),
    adjustedQuantity: clampQuantity(payload.adjustedQuantity ?? payload.suggestedQuantity),
    latestPurchasePrice: clampMoney(payload.latestPurchasePrice),
    estimatedCost: payload.estimatedCost === null ? null : clampMoney(payload.estimatedCost),
    costStatus: payload.costStatus,
    daysRemaining: typeof payload.daysRemaining === "number" && Number.isFinite(payload.daysRemaining) ? Number(payload.daysRemaining.toFixed(1)) : null,
    notes: payload.notes?.trim() || "",
    status: payload.status || existing?.status || "Needs ordering",
    markedAt: existing?.markedAt || now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  return [record, ...intents.filter((intent) => intent.id !== record.id)];
}

export function largeAdjustmentSignal(movement: InventoryMovement) {
  const absolute = Math.abs(movement.quantityDelta);
  const relative = Math.abs(movement.quantityBefore) * 0.25;
  return absolute >= 5 || absolute >= relative;
}

export function buildInventoryOperationsSummary(state: Pick<PilotInventoryState, "items" | "movements" | "countSessions">) {
  const reorderSuggestions = buildReorderSuggestions(state.items);
  const draftCount = state.countSessions.filter((session) => session.status === "Draft").length;
  const recentLargeAdjustments = state.movements.filter((movement) => largeAdjustmentSignal(movement)).length;
  const estimatedReorderCost = reorderSuggestions.reduce((sum, line) => sum + (line.estimatedCost ?? 0), 0);

  return {
    inventoryCountSessionDraftCount: draftCount,
    inventoryItemsToReorderCount: reorderSuggestions.length,
    inventoryEstimatedReorderCost: clampMoney(estimatedReorderCost),
    inventoryRecentLargeAdjustmentCount: recentLargeAdjustments,
  };
}

export function describeCountSessionProgress(session: InventoryCountSession) {
  const progress = countSessionProgress(session);
  return `${progress.counted} of ${progress.total} items counted`;
}
