import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Lock, RefreshCw, Save } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { usePilotSession } from "./PilotSessionProvider";
import { WorkspacePageHeader } from "./workspace/WorkspacePageHeader";
import {
  fetchPilotDailyClose,
  finalizePilotDailyClose,
  openPilotDailyClose,
  syncPilotDailyCloseSales,
  updatePilotDailyClose,
  type PilotDailyCloseResponse,
  type CashReconciliation,
} from "./pilotApi";
import { formatDate, formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

function formatSignedNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${formatNumber(number)}`;
}

function currentBusinessDate(timeZone: string | null | undefined) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}


function exceptionAction(exception: string) {
  const exact: Record<string, { href: string; label: string }> = {
    reorder_now: { href: "/app/inventory?view=reorder", label: "Review reorder" },
    unmapped_square_sales: { href: "/app/square", label: "Review mappings" },
    usage_variance: { href: "/app/inventory?view=usage", label: "Review usage" },
  };
  if (exact[exception]) return exact[exception];
  const text = exception.toLowerCase();
  if (text.includes("variation") && text.includes("unmapped")) return { href: "/app/square", label: "Review mappings" };
  if (text.includes("refund") || text.includes("cancel")) return { href: "/app/square", label: "Review sales" };
  if (text.includes("sync") || text.includes("location") || text.includes("square")) return { href: "/app/square", label: "Review Square" };
  if (text.includes("recipe") || text.includes("mapping")) return { href: "/app/menu-costing", label: "Review Menu Costing" };
  if (text.includes("usage variance") || text.includes("variance")) return { href: "/app/inventory?view=usage", label: "Review usage" };
  return null;
}

export function PilotDailyClosePage() {
  const { currentLocation, locations } = usePilotSession();
  const location = useLocation();
  const queryLocationId = Number(new URLSearchParams(location.search).get("locationId"));
  const queryBusinessDate = new URLSearchParams(location.search).get("businessDate")?.trim() || "";
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(() =>
    Number.isFinite(queryLocationId) && queryLocationId > 0 ? queryLocationId : currentLocation?.id ?? locations[0]?.id ?? null,
  );
  const [selectedBusinessDate, setSelectedBusinessDate] = useState<string>(() => queryBusinessDate || currentBusinessDate(currentLocation?.timezone));
  const [data, setData] = useState<PilotDailyCloseResponse | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"open" | "notes" | "finalize" | "sync-sales" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [countedCash, setCountedCash] = useState("");

  const currentSession = data?.session ?? null;
  const snapshot = currentSession?.currentSnapshot ?? data?.snapshot ?? null;
  const sales = (snapshot?.sales ?? {}) as Record<string, any>;
  const usage = snapshot?.usage ?? null;
  const attentionItems = (snapshot?.attentionItems ?? []) as Array<{ type: string; title: string; severity: string; href?: string; detail?: string; label?: string }>;
  const displayAttentionItems = attentionItems.length ? attentionItems : (data?.exceptions ?? []).map((exception) => { const action = exceptionAction(exception); return { type: "legacy", title: exception, severity: "warning", href: action?.href, label: action?.label, detail: "" }; });
  const history = data?.history ?? [];
  const locationOptions = locations;

  const load = async (locationId = selectedLocationId, businessDate = selectedBusinessDate) => {
    if (!locationId) {
      setData(null);
      setCountedCash("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchPilotDailyClose(locationId, businessDate || null);
      setData(response);
      setNotes(response.session?.notes ?? "");
      setSelectedBusinessDate(response.businessDate);
      const savedCash = response.snapshot?.cashReconciliation?.countedCash ?? response.snapshot?.manualReconciliation?.countedCash;
      setCountedCash(savedCash == null ? "" : String(savedCash));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load daily close.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queryBusinessDate && !data && currentLocation?.timezone) {
      setSelectedBusinessDate(currentBusinessDate(currentLocation.timezone));
    }
  }, [currentLocation?.timezone, data, queryBusinessDate]);

  const openClose = async () => {
    if (!selectedLocationId) {
      setError("Choose a location first.");
      return;
    }
    setSaving("open");
    setError(null);
    setMessage(null);
    try {
      const response = await openPilotDailyClose({ locationId: selectedLocationId, businessDate: selectedBusinessDate || undefined });
      setData(response);
      setNotes(response.session?.notes ?? "");
      setSelectedBusinessDate(response.businessDate);
      const savedCash = response.snapshot?.cashReconciliation?.countedCash ?? response.snapshot?.manualReconciliation?.countedCash;
      setCountedCash(savedCash == null ? "" : String(savedCash));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start daily close.");
    } finally {
      setSaving(null);
      setLoading(false);
    }
  };

  const saveNotes = async () => {
    if (!currentSession) {
      return;
    }
    setSaving("notes");
    setError(null);
    setMessage(null);
    try {
      const response = await updatePilotDailyClose(currentSession.id, { notes, reconciliation: { countedCash: countedCash.trim() === "" ? null : Number(countedCash) } });
      setData(response);
      setNotes(response.session?.notes ?? notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the daily close note.");
    } finally {
      setSaving(null);
    }
  };

  const finalizeClose = async () => {
    if (!currentSession) {
      return;
    }
    setSaving("finalize");
    setError(null);
    setMessage(null);
    try {
      const saved = await updatePilotDailyClose(currentSession.id, { notes, reconciliation: { countedCash: countedCash.trim() === "" ? null : Number(countedCash) } });
      setData(saved);
      const response = await finalizePilotDailyClose(saved.session?.id ?? currentSession.id);
      setData(response);
      setNotes(response.session?.notes ?? notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finalize the daily close.");
    } finally {
      setSaving(null);
    }
  };

  const syncSales = async () => {
    if (!currentSession || !canSyncSales) {
      return;
    }
    setSaving("sync-sales");
    setError(null);
    setMessage(null);
    try {
      const response = await syncPilotDailyCloseSales(currentSession.id, { businessDate: selectedBusinessDate || currentSession.businessDate });
      setData(response);
      setNotes(response.session?.notes ?? notes);
      setSelectedBusinessDate(response.businessDate);
      setMessage(`Synced Square sales for ${formatDate(response.businessDate)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync Square sales.");
    } finally {
      setSaving(null);
    }
  };

  const selectedLocation = locationOptions.find((entry) => entry.id === selectedLocationId) ?? currentLocation ?? null;
  const squareStatus = String(snapshot?.square?.squareStatus ?? "Not connected");
  const squareSynced = Boolean(snapshot?.square?.squareSynced);
  const locationMapped = Boolean(snapshot?.square?.locationMapped);
  const squareConnected = squareStatus.toLowerCase() === "connected";
  const completed = currentSession?.status === "COMPLETED";
  const canSyncSales = Boolean(currentSession && !completed && squareConnected && locationMapped);
  const cashReconciliation: CashReconciliation = snapshot?.cashReconciliation ?? { status: "unavailable", mode: null, expectedCash: null, openingFloat: null, cashPayments: null, cashRefunds: null, paidIn: null, paidOut: null, closedCash: null };
  const expectedCash = Number.isFinite(Number(cashReconciliation.expectedCash)) ? Number(cashReconciliation.expectedCash) : null;
  const countedCashValue = countedCash.trim() === "" ? null : Number(countedCash);
  const squareClosedCash = Number.isFinite(Number(cashReconciliation.closedCash)) ? Number(cashReconciliation.closedCash) : null;
  const cashDifference = expectedCash != null && (squareClosedCash != null || countedCashValue != null) && Number.isFinite(squareClosedCash ?? countedCashValue)
    ? (squareClosedCash ?? countedCashValue)! - expectedCash
    : (cashReconciliation.overShort != null ? Number(cashReconciliation.overShort) : null);
  const recordedWasteQuantity = Number(snapshot?.reconciliation?.recordedWasteQuantity ?? 0);
  const recordedWasteCost = Number(snapshot?.reconciliation?.recordedWasteCost ?? 0);
  const wasteLabel = recordedWasteCost > 0
    ? `${formatMoney(recordedWasteCost)} recorded`
    : recordedWasteQuantity !== 0 || recordedWasteCost !== 0
      ? "Recorded"
      : "No recorded entries";

  const openHistorySession = (sessionDate: string) => {
    setSelectedBusinessDate(sessionDate);
    void load(selectedLocationId ?? undefined, sessionDate);
  };

  return (
    <div className="workspace-page">
      <WorkspacePageHeader
        title="Daily Close"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/app/square">
              <ExternalLink className="h-4 w-4" />
              {squareConnected ? "Open Square" : "Connect Square"}
            </Link>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              type="button"
              onClick={() => void load()}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        }
        metrics={[]}
      />

      <Card className="p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Location</p>
            <h2 className="text-base font-bold text-ink">{selectedLocation?.name ?? "No location selected"}</h2>
            <p className="text-xs text-muted">
              {data?.businessDate ? `Business date ${formatDate(data.businessDate)}` : "Choose a location to start the close."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[28rem]">
            {locationOptions.length > 1 ? (
              <label className="block">
                <span className="text-sm font-semibold text-ink">Workspace location</span>
                <select
                  className="input mt-1"
                  value={selectedLocationId ?? ""}
                  onChange={(event) => {
                    const nextLocationId = Number(event.target.value);
                    if (!Number.isFinite(nextLocationId) || nextLocationId <= 0) {
                      return;
                    }
                    setSelectedLocationId(nextLocationId);
                    void load(nextLocationId, selectedBusinessDate);
                  }}
                >
                  <option value="" disabled>
                    Select a location
                  </option>
                  {locationOptions.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="text-sm font-semibold text-ink">Business date</span>
              <input
                className="input mt-1"
                type="date"
                value={selectedBusinessDate}
                onChange={(event) => {
                  const nextBusinessDate = event.target.value;
                  setSelectedBusinessDate(nextBusinessDate);
                  void load(selectedLocationId ?? undefined, nextBusinessDate);
                }}
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {currentSession && !completed ? (
            <>
              {canSyncSales ? (
                <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={saving !== null} onClick={() => void syncSales()}>
                  <RefreshCw className="h-4 w-4" />
                  {saving === "sync-sales" ? "Syncing..." : "Sync sales"}
                </button>
              ) : null}
              <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={saving !== null} onClick={() => void finalizeClose()}>
                <Lock className="h-4 w-4" />
                Complete close
              </button>
            </>
          ) : !currentSession ? (
            <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!selectedLocationId || saving !== null} onClick={() => void openClose()}>
              <RefreshCw className="h-4 w-4" />
              Start close
            </button>
          ) : null}
          {completed ? <Badge tone="success"><Lock className="mr-1 h-3.5 w-3.5" /> Completed snapshot</Badge> : null}
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">{message}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted" aria-busy="true">Loading daily close…</div> : null}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="workspace-card">
          <SectionHeader
            title={completed ? "Completed daily close" : currentSession ? "Active daily close" : "Start a daily close"}
            description={
              completed
                ? "This saved close is read-only and kept as a historical snapshot."
                : "Use notes for unusual items and finalize once the numbers are ready."
            }
          />

          {currentSession ? (
            <div className="mt-5 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(snapshot?.healthStatus ?? currentSession.status)}>{snapshot?.healthStatus ?? currentSession.status}</Badge>
                <Badge tone={squareSynced ? "success" : "orange"}>{squareStatus}</Badge>
                <Badge tone={locationMapped ? "success" : "orange"}>{locationMapped ? "Mapped" : "Unmapped"}</Badge>
                {Number(cashReconciliation.openShiftCount ?? 0) > 0 ? <Badge tone="orange">{cashReconciliation.openShiftCount} cash drawer open</Badge> : null}
                {completed ? (
                  <Badge tone="neutral">
                    <Lock className="mr-1 h-3.5 w-3.5" />
                    Read only
                  </Badge>
                ) : null}
              </div>

              <div>
                <div className="rounded-3xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Sales snapshot</p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Net sales</dt>
                      <dd className="font-semibold text-ink">{formatMoney(Number(sales.netSales ?? 0))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Orders</dt>
                      <dd className="font-semibold text-ink">{formatNumber(Number(sales.orders ?? 0))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Refunds</dt>
                      <dd className="font-semibold text-ink">{formatMoney(Number(sales.refunds ?? 0))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Cancelled</dt>
                      <dd className="font-semibold text-ink">{formatNumber(Number(sales.cancelledOrders ?? 0))}</dd>
                    </div>
                  </dl>
                </div>

              </div>


              <div className="rounded-3xl border border-line bg-slate-50 p-4">
                <SectionHeader title="Cash reconciliation" description="Close the cash drawer against the sales data available for this business date." />
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Expected cash</p>
                    <p className="mt-1 text-lg font-semibold text-ink">{expectedCash == null ? "Unavailable" : formatMoney(expectedCash)}</p>
                  </div>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Counted cash</span>
                    <input
                      className="input mt-1"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={squareClosedCash == null ? countedCash : String(squareClosedCash)}
                      disabled={completed || expectedCash == null || squareClosedCash != null}
                      onChange={(event) => setCountedCash(event.target.value)}
                      placeholder={expectedCash == null ? "Unavailable" : "0.00"}
                    />
                  </label>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Over / short</p>
                    <p className={`mt-1 text-lg font-semibold ${cashDifference == null ? "text-muted" : cashDifference === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                      {cashDifference == null ? "—" : cashDifference === 0 ? "Balanced" : cashDifference > 0 ? `${formatMoney(cashDifference)} over` : `${formatMoney(Math.abs(cashDifference))} short`}
                    </p>
                  </div>
                </div>
                {expectedCash == null ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-line px-3 py-2 text-sm text-muted">
                    <p>{cashReconciliation.reason ?? "Square has not provided tender-level cash for this close."} No cash count is required from this screen.</p>
                    {cashReconciliation.reconnectRequired ? <Link className="mt-2 inline-flex font-semibold text-ink underline" to="/app/square">Reconnect Square →</Link> : null}
                  </div>
                ) : null}
                {squareClosedCash != null ? <p className="mt-3 text-sm text-muted">Square counted close: {formatMoney(squareClosedCash)}. Manual counting is not required.</p> : null}
                {cashDifference != null && cashDifference !== 0 ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    {cashReconciliation.possibleMatches?.length ? (
                      <>
                        <p className="font-semibold">Possible matches</p>
                        <ul className="mt-2 space-y-2">
                          {cashReconciliation.possibleMatches.map((match, index) => (
                            <li key={`${match.shiftId ?? "shift"}-${match.createdAt ?? index}-${match.type}`} className="flex items-start justify-between gap-3">
                              <span>{match.description ?? match.type.replaceAll("_", " ")}{match.createdAt ? ` · ${formatDateTime(match.createdAt)}` : ""}</span>
                              <span className="shrink-0 font-semibold">{formatMoney(match.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold">Likely causes</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          <li>Check for a missed cash sale or incorrect tender type.</li>
                          <li>Review paid-out, float, refund, and change entries.</li>
                          <li>Confirm the counted amount and add a note before completing the close.</li>
                        </ul>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              {displayAttentionItems.length ? (
                <div className="daily-close-exceptions rounded-3xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">Needs attention</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-950">
                    {displayAttentionItems.map((item) => (
                      <li key={`${item.type}-${item.title}`} className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{item.title}</strong>{item.detail ? ` — ${item.detail}` : ""}</span></div>
                        {item.href ? <Link className="shrink-0 font-semibold text-amber-900 underline" to={item.href}>{item.label ?? (item.type === "usage_variance" ? "Review usage" : item.type === "unmapped_square_sales" ? "Review mappings" : "Review sales")} →</Link> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="daily-close-no-blockers rounded-3xl border border-line bg-slate-50 p-3 text-sm text-muted"><p className="font-semibold text-ink">No current exceptions.</p></div>
              )}

              <div className="rounded-3xl border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-ink">Notes</p>
                  {completed ? <span className="text-xs font-semibold uppercase tracking-wide text-muted">Read only</span> : null}
                </div>
                <textarea
                  className="input mt-3 min-h-10 w-full"
                  rows={1}
                  value={notes}
                  disabled={completed}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add context for unusual sales, waste, or count discrepancies."
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={completed || !currentSession || saving !== null}
                    onClick={() => void saveNotes()}
                  >
                    <Save className="h-4 w-4" />
                    Save notes
                  </button>
                  {currentSession ? (
                    <span className="inline-flex items-center rounded-full border border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      {completed ? `Completed ${formatDateTime(currentSession.completedAt)}` : "Draft"}
                    </span>
                  ) : null}
                </div>
              </div>


              <div className="rounded-3xl border border-line bg-slate-50 p-4">
                <SectionHeader title="Additional context" description="Optional operational context for this close." />
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Waste</p><p className="mt-1 font-semibold text-ink">{wasteLabel}</p></div>
                  {Number(snapshot?.reconciliation?.otherAdjustmentQuantity ?? 0) !== 0 ? <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Adjustments</p><p className="mt-1 font-semibold text-ink">{formatSignedNumber(Number(snapshot?.reconciliation?.otherAdjustmentQuantity))}</p></div> : null}
                  <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Physical comparison</p><p className="mt-1 font-semibold text-ink">{usage?.totals?.actualUsage == null ? "Not available for this date" : "Available"}</p></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-dashed border-line bg-slate-50 p-6 text-sm leading-6 text-muted">
              <p className="font-semibold text-ink">Start a daily close for this location.</p>
              <p className="mt-2">
                Flowtally will snapshot sales, usage, and exceptions so you can review the day before marking it complete.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/app/square">
                  Review Square
                </Link>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="workspace-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Square</p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <Badge tone={squareConnected ? "success" : "neutral"}>{squareStatus}</Badge>
                  <Badge tone={locationMapped ? "success" : "warning"}>{locationMapped ? "Location mapped" : "Location unmapped"}</Badge>
                  {squareSynced ? <Badge tone="neutral">Synced</Badge> : null}
                </div>
              </div>
              <Link className="font-semibold text-ink underline" to="/app/square">Open Square →</Link>
            </div>
          </Card>

          <Card className="workspace-card">
            <SectionHeader title="History" description="Completed and draft closes for this location." />
            <div className="mt-4 space-y-3">
              {history.length ? (
                history.slice(0, 6).map((session) => (
                  <div key={session.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{formatDate(session.businessDate)}</p>
                        <p className="mt-1 text-xs text-muted">
                          {session.status === "COMPLETED" ? `Completed ${formatDateTime(session.completedAt)}` : "Draft"}
                        </p>
                      </div>
                      <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                    </div>
                    {session.notes ? <p className="mt-3 text-sm leading-6 text-slate-700">{session.notes}</p> : null}
                    <div className="mt-3">
                      <button
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:bg-slate-50"
                        type="button"
                        onClick={() => openHistorySession(session.businessDate)}
                      >
                        Open {formatDate(session.businessDate)}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-6 text-sm text-muted">No daily close history yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
