import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCcw, Save, ClipboardList, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  createPilotCountSession,
  fetchPilotCountSessions,
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
  const [sessions, setSessions] = useState<PilotCountSession[]>([]);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<CountSessionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmConcurrency, setConfirmConcurrency] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [selectionSeeded, setSelectionSeeded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedSessionId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("sessionId");
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [location.search]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [sessionList, inventory] = await Promise.all([fetchPilotCountSessions(), fetchPilotInventory()]);
      setSessions(sessionList.countSessions);
      setInventoryItems(inventory.items);
      if (!selectionSeeded) {
        setSelectedItemIds(inventory.items.filter((item) => item.active).map((item) => item.id));
        setSelectionSeeded(true);
      }
      const current = requestedSessionId
        ? sessionList.countSessions.find((entry) => entry.id === requestedSessionId) ?? null
        : selectedId
          ? sessionList.countSessions.find((entry) => entry.id === selectedId) ?? null
          : sessionList.countSessions[0] ?? null;
      if (current) {
        setSelectedId(current.id);
        setDraft(sessionToDraft(current));
        setConfirmConcurrency(false);
      } else {
        setDraft(null);
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

  const selectedItemCount = selectedItemIds.length;
  const activeItemCount = inventoryItems.filter((item) => item.active).length;

  const createSession = async () => {
    setSaving(true);
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
      setConfirmConcurrency(false);
      setMessage(`Stock count ${created.id} started.`);
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a stock count.");
    } finally {
      setSaving(false);
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
        countedBy: draft.countedBy,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          id: line.id,
          countedQuantity: line.countedQuantity,
          note: line.note,
        })),
      });
      setDraft(sessionToDraft(saved));
      setMessage(`Stock count ${saved.id} saved.`);
      await load();
      setSelectedId(saved.id);
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
      setConfirmConcurrency(false);
      setMessage(`Stock count ${finalized.id} finalized.`);
      await load();
      setSelectedId(finalized.id);
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
            <Button icon={<Plus className="h-4 w-4" />} type="button" onClick={() => void createSession()}>
              New count
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()}>
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
                    onClick={() => setSelectedItemIds((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition hover:shadow-soft ${
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
          <div className="space-y-2">
            {draftSessions.map((session) => (
              <button key={session.id} type="button" onClick={() => { setSelectedId(session.id); setDraft(sessionToDraft(session)); setConfirmConcurrency(false); }} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:shadow-soft ${selectedId === session.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
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
              <button key={session.id} type="button" onClick={() => { setSelectedId(session.id); setDraft(sessionToDraft(session)); setConfirmConcurrency(false); }} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:shadow-soft ${selectedId === session.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
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
            description={draft?.status === "Completed" ? "This count is finalized and view-only." : "Fill in the counted quantities before finalizing."}
          />

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

              <label className="mt-4 block">
                <span className="text-sm font-semibold text-ink">Notes</span>
                <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => (current ? { ...current, notes: event.target.value } : current))} disabled={draft.status === "Completed"} />
              </label>

              <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-sm font-semibold text-ink">Count lines</p>
                <div className="mt-4 space-y-3">
                  {draft.lines.map((line) => (
                    <div key={line.id} className="rounded-2xl border border-line bg-white p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{line.itemNameSnapshot}</p>
                          <p className="text-sm text-muted">Expected {formatNumber(line.expectedQuantity)} {line.stockUnitSnapshot}</p>
                        </div>
                        <Badge tone={statusTone(line.status)}>{line.status}</Badge>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Counted</span>
                          <input className="input mt-1" min="0" type="number" step="0.0001" value={line.countedQuantity ?? ""} onChange={(event) => updateLine(line.id, (current) => ({ ...current, countedQuantity: event.target.value ? Number(event.target.value) : null }))} disabled={draft.status === "Completed"} />
                        </label>
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Variance note</span>
                          <input className="input mt-1" value={line.note} onChange={(event) => updateLine(line.id, (current) => ({ ...current, note: event.target.value }))} disabled={draft.status === "Completed"} />
                        </label>
                        <div className="rounded-2xl border border-line bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Variance</p>
                          <p className={`mt-2 text-lg font-bold ${Number(line.countedQuantity ?? 0) >= line.expectedQuantity ? "text-emerald-700" : "text-red-700"}`}>
                            {line.countedQuantity === null ? "—" : `${line.countedQuantity - line.expectedQuantity >= 0 ? "+" : ""}${formatNumber((line.countedQuantity ?? 0) - line.expectedQuantity)}`}
                          </p>
                        </div>
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
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={saving || draft.status === "Completed"} icon={<Save className="h-4 w-4" />} type="button" onClick={() => void saveSession()}>
                  Save count
                </Button>
                <Button disabled={saving || draft.status === "Completed" || draft.uncountedLineCount > 0 || (draft.hasMovementSinceStart && !confirmConcurrency)} variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} type="button" onClick={() => void finalizeSession()}>
                  {draft.hasMovementSinceStart && !confirmConcurrency ? "Review movements first" : "Finalize count"}
                </Button>
              </div>

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
