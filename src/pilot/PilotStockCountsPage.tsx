import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Plus, RefreshCcw, Save, Search } from "lucide-react";
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
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";
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
  const [pendingAction, setPendingAction] = useState<"save" | "finalize" | null>(null);
  const [confirmConcurrency, setConfirmConcurrency] = useState(false);
  const [showConcurrencyDetails, setShowConcurrencyDetails] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [lineSearch, setLineSearch] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectionSeeded, setSelectionSeeded] = useState(false);
  const [workflowTab, setWorkflowTab] = useState<"active" | "history">("active");
  const [savedDraftSignature, setSavedDraftSignature] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousSelectedId = useRef<number | null>(null);
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
          if (current) {
            const currentId = current.id;
            nextSessions = [current, ...nextSessions.filter((entry) => entry.id !== currentId)];
          }
        } catch {
          current = sessionList.countSessions.find((entry) => entry.id === targetSessionId) ?? null;
        }
      }

      setSessions(nextSessions);
      if (!selectionSeeded) {
        setSelectedItemIds(inventory.items.filter((item) => item.active).map((item) => item.id));
        setSelectionSeeded(true);
      }
      const activeSession = current ?? nextSessions.find((entry) => entry.status === "Draft") ?? nextSessions[0] ?? null;
      if (activeSession) {
        setWorkflowTab(activeSession.status === "Completed" ? "history" : "active");
        setSelectedId(activeSession.id);
        setDraft(sessionToDraft(activeSession));
        setSavedDraftSignature(JSON.stringify(sessionToDraft(activeSession)));
        setConfirmConcurrency(false);
        setShowConcurrencyDetails(false);
      } else {
        setDraft(null);
        setSavedDraftSignature(null);
        setConfirmConcurrency(false);
        setShowConcurrencyDetails(false);
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
  const visibleSessions = workflowTab === "history" ? completedSessions : draftSessions;
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
    if (previousSelectedId.current !== selectedId) {
      setShowConcurrencyDetails(false);
      previousSelectedId.current = selectedId;
    }
  }, [selectedId]);

  useEffect(() => {
    if (!visibleSessions.length) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (!visibleSessions.some((session) => session.id === selectedId)) {
      setSelectedId(visibleSessions[0].id);
    }
  }, [selectedId, visibleSessions]);

  useEffect(() => {
    if (draft?.status === "Completed") {
      setConfirmConcurrency(false);
      setShowConcurrencyDetails(false);
    }
  }, [draft?.status]);

  useEffect(() => {
    if (!draft?.hasMovementSinceStart) {
      setShowConcurrencyDetails(false);
    }
  }, [draft?.hasMovementSinceStart]);

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
    setShowConcurrencyDetails(false);
    navigate(`${location.pathname}?sessionId=${sessionId}`, { replace: true });
  };

  const createSession = async () => {
    if (creating || saving || loading) {
      return;
    }
    setCreating(true);
    setPendingAction(null);
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
      setShowConcurrencyDetails(false);
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
    setPendingAction("save");
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
      setPendingAction(null);
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
    setPendingAction("finalize");
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
      setPendingAction(null);
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
    <div className="workspace-page">
      <Card className="surface-panel workspace-card p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Stock Counts</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">Stock Counts</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">Enter counted quantities, review exceptions, and apply the count.</p>
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

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="text-xs text-muted">{formatNumber(sessions.length)} sessions · {formatNumber(inventoryItems.length)} items</span>
          {hasUnsavedChanges ? <Badge tone="warning">Unsaved changes</Badge> : null}
          <WorkspaceTabs
            tabs={[
              { id: "active", label: "Active count", badge: draftSessions.length },
              { id: "history", label: "History", badge: completedSessions.length },
            ]}
            value={workflowTab}
            onChange={(value) => setWorkflowTab(value as "active" | "history")}
          />
        </div>
      </Card>

      {workflowTab === "active" && !draft ? (
        <Card className="workspace-card">
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
      ) : null}

      <div className="flex flex-col gap-4">
        <Card className="workspace-card p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">{workflowTab === "history" ? "Completed history" : "Active drafts"}</span>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {visibleSessions.map((session) => (
              <button key={session.id} type="button" disabled={creating || saving} onClick={() => { openSession(session.id); setDraft(sessionToDraft(session)); }} className={`min-w-56 rounded-lg border px-2 py-1.5 text-left text-xs transition hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-70 ${selectedId === session.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{session.status === "Completed" ? "Completed" : "Draft"} #{session.id}</p>
                    <p className="text-[11px] text-muted">{session.countedBy || "Unassigned"} · {formatDateTime(session.updatedAt)}</p>
                  </div>
                  <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted">{session.countedLineCount}/{session.itemCount} counted · {session.uncountedLineCount} uncounted</p>
              </button>
            ))}
            {!visibleSessions.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">{workflowTab === "history" ? "No completed counts yet." : "No draft counts yet."}</p> : null}
            </div>
          </div>
        </Card>

        <Card className="workspace-card w-full p-4">
          <SectionHeader
            title={draft?.id ? `${isCompleted ? "Completed count" : "Edit count"} #${draft.id}` : workflowTab === "history" ? "Completed count" : "Start a count"}
            description={draft?.status === "Completed" ? "This count is finalized, locked, and kept as a read-only inventory snapshot." : "Fill in the counted quantities before finalizing."}
          />

          {draft ? (
            <div className={`mb-3 flex flex-wrap items-center gap-2 border-b pb-3 ${isCompleted ? "border-emerald-200" : "border-brand-100"}`}>
                <Badge tone={statusTone(draft.status)}>{draft.status}</Badge>
                <Badge tone="neutral">{isCompleted ? "Completed count" : "Draft count"}</Badge>
                <span className="text-xs text-muted">{draft.countedBy || "Unassigned"} · {draft.countedLineCount}/{draft.itemCount} counted · {draft.uncountedLineCount} uncounted · {draft.varianceTotal >= 0 ? "+" : ""}{formatNumber(draft.varianceTotal)} variance</span>
            </div>
          ) : null}

          {draft ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="block">
                  <span className="mr-2 text-xs font-semibold text-muted">Counted by</span>
                  <input className="input inline-block w-40" value={draft.countedBy} onChange={(event) => setDraft((current) => (current ? { ...current, countedBy: event.target.value } : current))} disabled={draft.status === "Completed"} />
                </label>
              </div>

              {draft.hasMovementSinceStart ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">Inventory changed after this count began.</p>
                      <p className="mt-1 leading-6">
                        {conflictLines.length} item{conflictLines.length === 1 ? " has" : "s have"} later inventory activity. Review it before applying this count.
                      </p>
                    </div>
                    {conflictLines.length ? (
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={!conflictLines.length}
                        onClick={() => setShowConcurrencyDetails((current) => !current)}
                      >
                        {showConcurrencyDetails ? "Hide details" : "View details"}
                      </Button>
                    ) : null}
                  </div>
                  {showConcurrencyDetails && conflictLines.length ? (
                    <div className="mt-3 space-y-2">
                      {conflictLines.slice(0, 4).map((line) => (
                        <div key={line.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm text-ink">
                          <p className="font-medium">{line.itemNameSnapshot}</p>
                          <Badge tone="warning">{line.movementCountSinceStart} later movement{line.movementCountSinceStart === 1 ? "" : "s"}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">Count sheet</p>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span>Filter</span>
                    <input className="input h-9 w-48" placeholder="Search items" value={lineSearch} onChange={(event) => setLineSearch(event.target.value)} />
                  </label>
                </div>
                <div className="mt-2 workspace-table-wrap overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Expected</th><th className="px-3 py-2">Counted</th><th className="px-3 py-2">Variance</th><th className="px-3 py-2">Variance note</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {filteredLines.map((line) => (
                        <tr key={line.id} className="bg-white align-middle">
                          <td className="px-3 py-2"><p className="font-semibold text-ink">{line.itemNameSnapshot}</p><div className="mt-1 flex flex-wrap gap-1">{line.hasMovementSinceStart ? <Badge tone="warning">{line.movementCountSinceStart} later movements</Badge> : null}</div></td>
                          <td className="px-3 py-2 font-semibold text-ink">{formatNumber(line.expectedQuantity)} {line.stockUnitSnapshot}</td>
                          <td className="px-3 py-2"><label className="sr-only" htmlFor={`counted-${line.id}`}>Counted quantity for {line.itemNameSnapshot}</label><input id={`counted-${line.id}`} className="input w-36 border-brand-200 bg-brand-50/40 text-base font-semibold" min="0" type="number" step="1" value={line.countedQuantity ?? ""} onChange={(event) => updateLine(line.id, (current) => ({ ...current, countedQuantity: event.target.value ? Number(event.target.value) : null }))} disabled={draft.status === "Completed"} /></td>
                          <td className={`px-3 py-2 font-semibold ${Number(line.countedQuantity ?? 0) >= line.expectedQuantity ? "text-emerald-700" : "text-red-700"}`}>{line.countedQuantity === null ? "—" : `${line.countedQuantity - line.expectedQuantity >= 0 ? "+" : ""}${formatNumber((line.countedQuantity ?? 0) - line.expectedQuantity)} ${line.stockUnitSnapshot}`}</td>
                          <td className="px-3 py-2"><label className="sr-only" htmlFor={`variance-note-${line.id}`}>Variance note for {line.itemNameSnapshot}</label><input id={`variance-note-${line.id}`} className="input" value={line.note} onChange={(event) => updateLine(line.id, (current) => ({ ...current, note: event.target.value }))} disabled={draft.status === "Completed"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredLines.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-muted">No count lines match this search.</p> : null}
                </div>
                <p className="mt-1 text-xs text-muted">{filteredLines.length} of {draft.lines.length} lines shown</p>
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-xs font-semibold text-muted">Notes</span>
                <input className="input h-9 min-w-0 flex-1" placeholder="Optional count note" value={draft.notes} onChange={(event) => setDraft((current) => (current ? { ...current, notes: event.target.value } : current))} disabled={draft.status === "Completed"} />
              </label>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <p className="text-xs text-muted">Counted quantities become inventory adjustments only when applied.</p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={creating || saving || draft.status === "Completed"} variant="secondary" icon={<Save className="h-4 w-4" />} type="button" onClick={() => void saveSession()}>
                    {saving && pendingAction === "save" ? "Saving draft..." : "Save draft"}
                  </Button>
                  <Button disabled={creating || saving || draft.status === "Completed" || draft.uncountedLineCount > 0 || (draft.hasMovementSinceStart && !confirmConcurrency)} variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} type="button" onClick={() => void finalizeSession()}>
                    {saving && pendingAction === "finalize" ? "Applying count..." : draft.hasMovementSinceStart && !confirmConcurrency ? "Review movements first" : "Apply count to inventory"}
                  </Button>
                </div>
              </div>

              {/* Concurrency review remains adjacent to the actions without competing with the count sheet. */}
              {draft.hasMovementSinceStart ? (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input checked={confirmConcurrency} disabled={draft.status === "Completed"} type="checkbox" onChange={(event) => setConfirmConcurrency(event.target.checked)} />
                  I reviewed the later inventory activity and want to reconcile this count against the current ledger.
                </label>
              ) : null}

              {draft.status === "Completed" ? (
                <div className="mt-3 rounded-xl border border-emerald-600 bg-emerald-600 px-3 py-2 text-white shadow-soft">
                  <p className="text-sm font-semibold">Count applied</p>
                  <p className="mt-1 text-sm text-emerald-50">This count is finalized and the inventory snapshot is read-only.</p>
                </div>
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
