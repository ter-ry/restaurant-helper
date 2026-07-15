import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCcw, Save, ClipboardList } from "lucide-react";
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
}

interface CountSessionDraft {
  id: number | null;
  countedBy: string;
  notes: string;
  status: string;
  lines: CountLineDraft[];
}

function sessionToDraft(session: PilotCountSession): CountSessionDraft {
  return {
    id: session.id,
    countedBy: session.countedBy,
    notes: session.notes,
    status: session.status,
    lines: session.lines.map((line) => ({
      id: line.id,
      itemNameSnapshot: line.itemNameSnapshot,
      stockUnitSnapshot: line.stockUnitSnapshot,
      expectedQuantity: line.expectedQuantity,
      countedQuantity: line.countedQuantity,
      note: line.note,
      status: line.status,
    })),
  };
}

export function PilotStockCountsPage() {
  const [sessions, setSessions] = useState<PilotCountSession[]>([]);
  const [inventoryItems, setInventoryItems] = useState<PilotInventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<CountSessionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [sessionList, inventory] = await Promise.all([fetchPilotCountSessions(), fetchPilotInventory()]);
      setSessions(sessionList.countSessions);
      setInventoryItems(inventory.items);
      const current = selectedId ? sessionList.countSessions.find((entry) => entry.id === selectedId) : sessionList.countSessions[0];
      if (current) {
        setSelectedId(current.id);
        setDraft(sessionToDraft(current));
      } else {
        setDraft(null);
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
  }, []);

  const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedId) ?? null, [sessions, selectedId]);

  useEffect(() => {
    if (selectedSession) {
      setDraft(sessionToDraft(selectedSession));
    }
  }, [selectedSession]);

  const createSession = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const created = await createPilotCountSession({
        countedBy: "Floor lead",
        notes: "Quick pilot count",
        itemIds: inventoryItems.slice(0, 12).map((item) => item.id),
      });
      setSelectedId(created.id);
      setDraft(sessionToDraft(created));
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
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const finalized = await finalizePilotCountSession(draft.id);
      setDraft(sessionToDraft(finalized));
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

      <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        <Card className="p-6">
          <SectionHeader title="Sessions" description="Latest count sessions first." />
          <div className="space-y-2">
            {sessions.map((session) => (
              <button key={session.id} type="button" onClick={() => { setSelectedId(session.id); setDraft(sessionToDraft(session)); }} className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:shadow-soft ${selectedId === session.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">Count #{session.id}</p>
                    <p className="text-sm text-muted">{session.countedBy || "Unassigned"} • {formatDateTime(session.updatedAt)}</p>
                  </div>
                  <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                </div>
                <p className="mt-3 text-sm text-muted">{session.itemCount} items</p>
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
                          <input className="input mt-1" type="number" step="0.0001" value={line.countedQuantity ?? ""} onChange={(event) => updateLine(line.id, (current) => ({ ...current, countedQuantity: event.target.value ? Number(event.target.value) : null }))} disabled={draft.status === "Completed"} />
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
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button disabled={saving || draft.status === "Completed"} icon={<Save className="h-4 w-4" />} type="button" onClick={() => void saveSession()}>
                  Save count
                </Button>
                <Button disabled={saving || draft.status === "Completed"} variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} type="button" onClick={() => void finalizeSession()}>
                  Finalize count
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Create a count to start entering quantities.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
