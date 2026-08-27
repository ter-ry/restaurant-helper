import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCcw, Save, ClipboardList, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotCountSession,
  fetchPilotCountSessions,
  fetchPilotCountSession,
  fetchPilotInventory,
  finalizePilotCountSession,
  updatePilotCountSession,
  type PilotCountSession,
  type PilotInventoryItem,
} from "./pilotApi";
import { formatDateTime, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

interface CountLineDraft {
  id: number;
  itemNameSnapshot: string;
  stockUnitSnapshot: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  note: string;
  status: string;
  movementCountSinceStart: number;
  hasMovementSinceStart: boolean;
}

interface CountSessionDraft {
  id: number | null;
  updatedAt: string | null;
  countedBy: string;
  notes: string;
  status: string;
  itemCount: number;
  countedLineCount: number;
  uncountedLineCount: number;
  varianceTotal: number;
  movementCountSinceStart: number;
  hasMovementSinceStart: boolean;
  lines: CountLineDraft[];
}

function sessionToDraft(session: PilotCountSession): CountSessionDraft {
  return {
    id: session.id,
    updatedAt: session.updatedAt,
    countedBy: session.countedBy,
    notes: session.notes,
    status: session.status,
    itemCount: session.itemCount,
    countedLineCount: session.countedLineCount,
    uncountedLineCount: session.uncountedLineCount,
    varianceTotal: session.varianceTotal,
    movementCountSinceStart: session.movementCountSinceStart,
    hasMovementSinceStart: session.hasMovementSinceStart,
    lines: session.lines.map((line) => ({
      id: line.id,
      itemNameSnapshot: line.itemNameSnapshot,
      stockUnitSnapshot: line.stockUnitSnapshot,
      expectedQuantity: line.expectedQuantity,
      countedQuantity: line.countedQuantity,
      note: line.note,
      status: line.status,
      movementCountSinceStart: line.movementCountSinceStart,
      hasMovementSinceStart: line.hasMovementSinceStart,
    })),
  };
}

export function PilotStockCountsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<PilotCountSession[]>([]);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<CountSessionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmConcurrency, setConfirmConcurrency] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [lineSearch, setLineSearch] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectionSeeded, setSelectionSeeded] = useState(false);
  const [savedDraftSignature, setSavedDraftSignature] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedSessionId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("sessionId");
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [location.search]);

  const load = async (preferredSessionId: number | null = requestedSessionId) => {
    setLoading(true);
    setError(null);

    try {
      const [sessionList, inventory] = await Promise.all([fetchPilotCountSessions(), fetchPilotInventory()]);
      setInventoryItems(inventory.items);
      let nextSessions = sessionList.countSessions;
      let current: PilotCountSession | null = null;

      const targetSessionId = preferredSessionId ?? selectedId;
      if (targetSessionId) {
        try {
          current = await fetchPilotCountSession(targetSessionId);
          const currentId = current.id;
          nextSessions = [current, ...nextSessions.filter((entry) => entry.id !== currentId)];
        } catch {
          current = sessionList.countSessions.find((entry) => entry.id === targetSessionId) ?? null;
        }
      }

      setSessions(nextSessions);
      if (!selectionSeeded) {
        setSelectedItemIds(inventory.items.filter((item) => item.active).map((item) => item.id));
        setSelectionSeeded(true);
      }
      const activeSession = current ?? nextSessions[0] ?? null;
      if (activeSession) {
        setSelectedId(activeSession.id);
        setDraft(sessionToDraft(activeSession));
        setSavedDraftSignature(JSON.stringify(sessionToDraft(activeSession)));
        setConfirmConcurrency(false);
      } else {
        setDraft(null);
        setSavedDraftSignature(null);
        setConfirmConcurrency(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load count sessions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId]);

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedId) ?? null, [sessions, selectedId]);
  const draftSessions = useMemo(() => sessions.filter((session) => session.status === "Draft"), [sessions]);
  const completedSessions = useMemo(() => sessions.filter((session) => session.status === "Completed"), [sessions]);
  const filteredItems = useMemo(
    () => inventoryItems.filter((item) => `${item.name} ${item.category} ${item.preferredSupplierName}`.toLowerCase().includes(itemSearch.toLowerCase())),
    [inventoryItems, itemSearch],
  );
  const filteredLines = useMemo(
    () =>
      draft?.lines.filter((line) =>
        `${line.itemNameSnapshot} ${line.stockUnitSnapshot} ${line.status} ${line.note}`.toLowerCase().includes(lineSearch.toLowerCase()),
      ) ?? [],
    [draft?.lines, lineSearch],
  );
  const conflictLines = useMemo(() => draft?.lines.filter((line) => line.hasMovementSinceStart) ?? [], [draft?.lines]);
  const isCompleted = draft?.status === "Completed";

  useEffect(() => {
    if (selectedSession) {
      setDraft(sessionToDraft(selectedSession));
      setConfirmConcurrency(false);
    }
  }, [selectedSession]);

  useEffect(() => {
    if (draft?.status === "Completed") {
      setConfirmConcurrency(false);
    }
  }, [draft?.status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!draft || draft.status === "Completed") {
        return;
      }
      const currentSignature = JSON.stringify(draft);
      if (savedDraftSignature !== null && currentSignature !== savedDraftSignature) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft, savedDraftSignature]);

  const hasUnsavedChanges = useMemo(() => draft !== null && draft.status !== "Completed" && JSON.stringify(draft) !== savedDraftSignature, [draft, savedDraftSignature]);

  const selectedItemCount = selectedItemIds.length;
  const activeItemCount = inventoryItems.filter((item) => item.active).length;
  const openSession = (sessionId: number) => {
    setSelectedId(sessionId);
    setConfirmConcurrency(false);
    navigate(`${location.pathname}?sessionId=${sessionId}`, { replace: true });
  };

  const createSession = async () => {
    if (creating || saving || loading) {
      return;
    }
    setCreating(true);
    setMessage(null);
    setError(null);

    try {
      const activeIds = selectedItemIds.length ? selectedItemIds : inventoryItems.filter((item) => item.active).map((item) => item.id);
      const created = await createPilotCountSession({
        countedBy: "Floor lead",
        notes: "Quick pilot count",
        itemIds: activeIds,
      });
      setSelectedId(created.id);
      setDraft(sessionToDraft(created));
      setSavedDraftSignature(JSON.stringify(sessionToDraft(created)));
      setConfirmConcurrency(false);
      setMessage(`Stock count ${created.id} started.`);
      navigate(`${location.pathname}?sessionId=${created.id}`, { replace: true });
      await load(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a stock count.");
    } finally {
      setCreating(false);
    }
  };

  const saveSession = async () => {
    if (!draft?.id) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const saved = await updatePilotCountSession(draft.id, {
        updatedAt: draft.updatedAt,
        countedBy: draft.countedBy,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          id: line.id,
          countedQuantity: line.countedQuantity,
          note: line.note,
        })),
      });
      setDraft(sessionToDraft(saved));
      setSavedDraftSignature(JSON.stringify(sessionToDraft(saved)));
      setMessage(`Stock count ${saved.id} saved.`);
      navigate(`${location.pathname}?sessionId=${saved.id}`, { replace: true });
      await load(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this stock count.");
    } finally {
      setSaving(false);
    }
  };

  const finalizeSession = async () => {
    if (!draft?.id) {
      return;
    }
    if (draft.hasMovementSinceStart && !confirmConcurrency) {
      setError("Review the later inventory movements before finalizing this count.");
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const finalized = await finalizePilotCountSession(draft.id, { confirmConcurrency });
      setDraft(sessionToDraft(finalized));
      setSavedDraftSignature(JSON.stringify(sessionToDraft(finalized)));
      setConfirmConcurrency(false);
      setMessage(`Stock count ${finalized.id} finalized.`);
      navigate(`${location.pathname}?sessionId=${finalized.id}`, { replace: true });
      await load(finalized.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finalize this stock count.");
    } finally {
      setSaving(false);
    }
  };

  const updateLine = (lineId: number, updater: (line: CountLineDraft) => CountLineDraft) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) => (line.id === lineId ? updater(line) : line)),
          }
        : current,
    );
  };

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Stock Counts</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Count sessions that turn into real stock adjustments</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Start a count, enter counted quantities, save the draft, and finalize into the inventory ledger when the shelf is reconciled.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={creating || saving || loading} icon={<Plus className="h-4 w-4" />} type="button" onClick={() => void createSession()}>
              New count
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()} disabled={creating || saving || loading}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Count sessions", value: formatNumber(sessions.length) },
            { label: "Draft counts", value: formatNumber(sessions.filter((session) => session.status === "Draft").length) },
            { label: "Completed counts", value: formatNumber(sessions.filter((session) => session.status === "Completed").length) },
            { label: "Items available", value: formatNumber(inventoryItems.length) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
            </div>
          ))}
        </div>
        {hasUnsavedChanges ? <p className="mt-3 text-sm text-amber-700">You have unsaved count changes.</p> : null}
      </Card>

      <Card className="p-6">
        <SectionHeader title="Start a count" description="Pick the active inventory items to include, then start or resume a count session." />
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted" />
                <input className="w-full bg-transparent text-sm outline-none" placeholder="Search items to include" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="neutral">{selectedItemCount} selected</Badge>
              <Badge tone="neutral">{activeItemCount} active items</Badge>
              <Badge tone={selectedItemCount === activeItemCount ? "success" : "warning"}>{selectedItemCount === activeItemCount ? "All active selected" : "Partial selection"}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setSelectedItemIds(inventoryItems.filter((item) => item.active).map((item) => item.id))}>
                Select active items
              </Button>
              <Button type="button" variant="secondary" onClick={() => setSelectedItemIds([])}>
                Clear selection
              </Button>
              <Button disabled={saving || !selectedItemCount} icon={<Plus className="h-4 w-4" />} type="button" onClick={() => void createSession()}>
                Start count
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Included items</p>
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {filteredItems.map((item) => {
                const selected = selectedItemIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={creating || saving}
                    onClick={() => setSelectedItemIds((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-70 ${
                      selected ? "border-brand-200 bg-brand-50" : "border-line bg-white"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{item.name}</p>
                      <p className="text-sm text-muted">{item.category} • {formatNumber(item.currentOnHand)} {item.stockUnit}</p>
                    </div>
                    <Badge tone={selected ? "success" : "neutral"}>{selected ? "Included" : "Excluded"}</Badge>
                  </button>
                );
              })}
              {!filteredItems.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No active inventory items match this search.</p> : null}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        <Card className="p-6">
          <SectionHeader title="Sessions" description="Latest count sessions first." />
          <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
            {draftSessions.map((session) => (
              <button key={session.id} type="button" disabled={creating || saving} onClick={() => { openSession(session.id); setDraft(sessionToDraft(session)); }} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-70 ${selectedId === session.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">Draft #{session.id}</p>
                    <p className="text-sm text-muted">{session.countedBy || "Unassigned"} • {formatDateTime(session.updatedAt)}</p>
                  </div>
                  <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge tone="neutral">{session.countedLineCount}/{session.itemCount} counted</Badge>
                  <Badge tone={session.uncountedLineCount > 0 ? "warning" : "success"}>{session.uncountedLineCount} uncounted</Badge>
                </div>
              </button>
            ))}
            {completedSessions.map((session) => (
              <button key={session.id} type="button" disabled={creating || saving} onClick={() => { openSession(session.id); setDraft(sessionToDraft(session)); }} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-70 ${selectedId === session.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">Completed #{session.id}</p>
                    <p className="text-sm text-muted">{session.countedBy || "Unassigned"} • {formatDateTime(session.updatedAt)}</p>
                  </div>
                  <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge tone="neutral">{session.countedLineCount}/{session.itemCount} counted</Badge>
                  <Badge tone="neutral">{session.varianceTotal >= 0 ? "+" : ""}{formatNumber(session.varianceTotal)} variance</Badge>
                </div>
              </button>
            ))}
            {!sessions.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No count sessions yet.</p> : null}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader
            title={draft?.id ? `Edit count #${draft.id}` : "Start a count"}
            description={draft?.status === "Completed" ? "This count is finalized, locked, and kept as a read-only inventory snapshot." : "Fill in the counted quantities before finalizing."}
          />

          {draft ? (
            <div className={`mb-5 rounded-2xl border px-4 py-3 ${isCompleted ? "border-emerald-200 bg-emerald-50" : "border-brand-100 bg-brand-50"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(draft.status)}>{draft.status}</Badge>
                <Badge tone="neutral">{isCompleted ? "Completed count" : "Draft count"}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted">
                {isCompleted
                  ? "Inventory has already been updated from this count. Review the locked snapshot below for audit history."
                  : "This draft is still editable. Save draft keeps it open; Apply count to inventory posts the reconciliation movements."}
              </p>
            </div>
          ) : null}

          {draft ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Counted by</span>
                  <input className="input mt-1" value={draft.countedBy} onChange={(event) => setDraft((current) => (current ? { ...current, countedBy: event.target.value } : current))} disabled={draft.status === "Completed"} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Status</span>
                  <input className="input mt-1" value={draft.status} readOnly />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Badge tone="neutral">{draft.countedLineCount}/{draft.itemCount} counted</Badge>
                <Badge tone={draft.uncountedLineCount > 0 ? "warning" : "success"}>{draft.uncountedLineCount} uncounted</Badge>
                <Badge tone={draft.varianceTotal === 0 ? "success" : "orange"}>{draft.varianceTotal >= 0 ? "+" : ""}{formatNumber(draft.varianceTotal)} variance</Badge>
                <Badge tone={draft.hasMovementSinceStart ? "warning" : "neutral"}>{draft.movementCountSinceStart} later movements</Badge>
              </div>

              {draft.hasMovementSinceStart ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Inventory moved after this count began. Review the variances, then confirm you want to finalize against the current ledger.
                </div>
              ) : null}
              {conflictLines.length ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Later movements since this count began</p>
                  <div className="mt-3 space-y-2">
                    {conflictLines.slice(0, 4).map((line) => (
                      <div key={line.id} className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{line.itemNameSnapshot}</p>
                          <p className="text-xs text-muted">{line.movementCountSinceStart} later movement{line.movementCountSinceStart === 1 ? "" : "s"}</p>
                        </div>
                        <Badge tone="warning">{line.hasMovementSinceStart ? "Review" : "Clear"}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {draft.status !== "Completed" && draft.countedLineCount > 0 ? (
                <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
                  <p className="text-sm font-semibold text-ink">Ready to apply this count?</p>
                  <p className="mt-1 text-sm leading-6 text-muted">Finalizing will write reconciliation movements into inventory and update the on-hand quantities for every counted line.</p>
                  <div className="mt-3 space-y-2">
                    {draft.lines
                      .filter((line) => line.countedQuantity !== null)
                      .slice(0, 3)
                      .map((line) => (
                        <div key={line.id} className="rounded-xl bg-white px-3 py-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-ink">{line.itemNameSnapshot}</p>
                            <p className="text-xs text-muted">
                              {formatNumber(line.expectedQuantity)} {line.stockUnitSnapshot} expected → {formatNumber(line.countedQuantity ?? 0)} counted
                            </p>
                          </div>
                          <Badge tone={line.countedQuantity !== null && line.countedQuantity >= line.expectedQuantity ? "success" : "warning"}>
                            {line.countedQuantity !== null && line.countedQuantity - line.expectedQuantity >= 0 ? "+" : ""}{formatNumber((line.countedQuantity ?? 0) - line.expectedQuantity)} variance
                          </Badge>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}

              <label className="mt-4 block">
                <span className="text-sm font-semibold text-ink">Notes</span>
                <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => (current ? { ...current, notes: event.target.value } : current))} disabled={draft.status === "Completed"} />
              </label>

              <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-sm font-semibold text-ink">Count lines</p>
                <div className="mt-3 rounded-2xl border border-line bg-white px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted" />
                    <input className="w-full bg-transparent text-sm outline-none" placeholder="Search count lines" value={lineSearch} onChange={(event) => setLineSearch(event.target.value)} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">{filteredLines.length} of {draft.lines.length} lines shown</p>
                <div className="mt-4 space-y-3">
                  {filteredLines.map((line) => (
                    <div key={line.id} className="rounded-2xl border border-line bg-white p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{line.itemNameSnapshot}</p>
                          <p className="text-sm text-muted">
                            Expected {formatNumber(line.expectedQuantity)} {line.stockUnitSnapshot} • Counted {line.countedQuantity === null ? "not entered" : formatNumber(line.countedQuantity)} • Variance {line.countedQuantity === null ? "—" : `${line.countedQuantity - line.expectedQuantity >= 0 ? "+" : ""}${formatNumber((line.countedQuantity ?? 0) - line.expectedQuantity)}`}
                          </p>
                        </div>
                        <Badge tone={statusTone(line.status)}>{line.status}</Badge>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-2xl border border-line bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Expected</p>
                          <p className="mt-2 text-lg font-bold text-ink">{formatNumber(line.expectedQuantity)} {line.stockUnitSnapshot}</p>
                        </div>
                        <div className="rounded-2xl border border-line bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Counted</p>
                          <p className="mt-2 text-lg font-bold text-ink">{line.countedQuantity === null ? "Not counted" : `${formatNumber(line.countedQuantity)} ${line.stockUnitSnapshot}`}</p>
                        </div>
                        <div className="rounded-2xl border border-line bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Variance</p>
                          <p className={`mt-2 text-lg font-bold ${Number(line.countedQuantity ?? 0) >= line.expectedQuantity ? "text-emerald-700" : "text-red-700"}`}>
                            {line.countedQuantity === null ? "—" : `${line.countedQuantity - line.expectedQuantity >= 0 ? "+" : ""}${formatNumber((line.countedQuantity ?? 0) - line.expectedQuantity)} ${line.stockUnitSnapshot}`}
                          </p>
                        </div>
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Counted quantity</span>
                          <input className="input mt-1" min="0" type="number" step="0.0001" value={line.countedQuantity ?? ""} onChange={(event) => updateLine(line.id, (current) => ({ ...current, countedQuantity: event.target.value ? Number(event.target.value) : null }))} disabled={draft.status === "Completed"} />
                        </label>
                        <label className="block md:col-span-2 xl:col-span-1">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Variance note</span>
                          <input className="input mt-1" value={line.note} onChange={(event) => updateLine(line.id, (current) => ({ ...current, note: event.target.value }))} disabled={draft.status === "Completed"} />
                        </label>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge tone="neutral">Expected {formatNumber(line.expectedQuantity)}</Badge>
                        <Badge tone={line.countedQuantity === null ? "neutral" : line.countedQuantity >= line.expectedQuantity ? "success" : "warning"}>
                          {line.countedQuantity === null ? "Not counted yet" : `${line.countedQuantity >= line.expectedQuantity ? "+" : ""}${formatNumber((line.countedQuantity ?? 0) - line.expectedQuantity)} variance`}
                        </Badge>
                        <Badge tone={line.hasMovementSinceStart ? "warning" : "neutral"}>{line.movementCountSinceStart} later movements</Badge>
                      </div>
                    </div>
                  ))}
                  {!filteredLines.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No count lines match this search.</p> : null}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={creating || saving || draft.status === "Completed"} variant="secondary" icon={<Save className="h-4 w-4" />} type="button" onClick={() => void saveSession()}>
                  Save draft
                </Button>
                <Button disabled={creating || saving || draft.status === "Completed" || draft.uncountedLineCount > 0 || (draft.hasMovementSinceStart && !confirmConcurrency)} variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} type="button" onClick={() => void finalizeSession()}>
                  {draft.hasMovementSinceStart && !confirmConcurrency ? "Review movements first" : "Apply count to inventory"}
                </Button>
              </div>

              {draft.status === "Completed" ? (
                <div className="mt-4 rounded-2xl border border-emerald-600 bg-emerald-600 px-4 py-3 text-white shadow-soft">
                  <p className="text-sm font-semibold">Count applied</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-50">This count has been finalized and the inventory snapshot above is now read-only.</p>
                </div>
              ) : null}

              {draft.hasMovementSinceStart ? (
                <label className="mt-4 flex items-center gap-2 text-sm text-muted">
                  <input checked={confirmConcurrency} disabled={draft.status === "Completed"} type="checkbox" onChange={(event) => setConfirmConcurrency(event.target.checked)} />
                  I reviewed the later inventory movements and want to finalize against the current ledger.
                </label>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Create a count to start entering quantities.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
