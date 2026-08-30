import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Lock, RefreshCw, Save } from "lucide-react";
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

export function PilotDailyClosePage() {
  const { currentLocation, locations } = usePilotSession();
  const location = useLocation();
  const queryLocationId = Number(new URLSearchParams(location.search).get("locationId"));
  const queryBusinessDate = new URLSearchParams(location.search).get("businessDate")?.trim() || "";
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(() =>
    Number.isFinite(queryLocationId) && queryLocationId > 0 ? queryLocationId : currentLocation?.id ?? locations[0]?.id ?? null,
  );
  const [selectedBusinessDate, setSelectedBusinessDate] = useState<string>(() => queryBusinessDate || new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<PilotDailyCloseResponse | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"open" | "notes" | "finalize" | "sync-sales" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const currentSession = data?.session ?? null;
  const snapshot = currentSession?.currentSnapshot ?? data?.snapshot ?? null;
  const sales = (snapshot?.sales ?? {}) as Record<string, any>;
  const usage = snapshot?.usage ?? null;
  const ingredientUsage = (usage?.ingredientUsage ?? []) as Array<Record<string, any>>;
  const history = data?.history ?? [];
  const locationOptions = locations;

  const load = async (locationId = selectedLocationId, businessDate = selectedBusinessDate) => {
    if (!locationId) {
      setData(null);
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

  const metrics = useMemo(
    () => [
      {
        label: "Sales",
        value: snapshot ? formatMoney(Number(sales.netSales ?? 0)) : "—",
        helper: snapshot ? `${formatNumber(Number(sales.orders ?? 0))} orders` : "Load a location to see sales",
      },
      {
        label: "Theoretical usage",
        value: snapshot ? formatNumber(Number(usage?.totals?.theoreticalUsage ?? 0)) : "—",
        helper: "Recipe-driven usage from menu sales",
      },
      {
        label: "Actual usage",
        value: snapshot ? (usage?.totals?.actualUsage == null ? "Unavailable" : formatNumber(Number(usage.totals.actualUsage))) : "—",
        helper: "Stock-count and movement basis",
      },
      {
        label: "Variance",
        value: snapshot ? `${formatSignedNumber(snapshot.variance.quantity)} (${snapshot.variance.percent == null ? "—" : `${formatNumber(snapshot.variance.percent)}%`})` : "—",
        helper: snapshot ? formatMoney(Number(snapshot.variance.value ?? 0)) : "Waiting for a snapshot",
      },
      {
        label: "Inventory value",
        value: snapshot ? formatMoney(Number(snapshot.inventoryValue ?? 0)) : "—",
        helper: "Weighted-average cost basis",
      },
      {
        label: "Exceptions",
        value: snapshot ? formatNumber(data?.exceptions.length ?? 0) : "—",
        helper: snapshot ? (data?.exceptions.length ? "Review before finalize" : "No blockers") : "Load a location to see blockers",
      },
    ],
    [data?.exceptions.length, sales.netSales, sales.orders, snapshot, usage?.totals?.actualUsage, usage?.totals?.theoreticalUsage],
  );

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
      const response = await updatePilotDailyClose(currentSession.id, { notes });
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
      const response = await finalizePilotDailyClose(currentSession.id);
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
  const squareConnected = squareStatus === "Connected";
  const completed = currentSession?.status === "COMPLETED";
  const canSyncSales = Boolean(currentSession && !completed && squareConnected && locationMapped);

  const openHistorySession = (sessionDate: string) => {
    setSelectedBusinessDate(sessionDate);
    void load(selectedLocationId ?? undefined, sessionDate);
  };

  return (
    <div className="space-y-6">
      <WorkspacePageHeader
        eyebrow="Daily close"
        title="Close the day with a clear snapshot"
        description="Review Square sales, weighted-average inventory usage, and any exceptions before you lock the day."
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
        metrics={metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          helper: metric.helper,
        }))}
      />

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Location</p>
            <h2 className="text-xl font-bold text-ink">{selectedLocation?.name ?? "No location selected"}</h2>
            <p className="text-sm leading-6 text-muted">
              {data?.businessDate ? `Business date ${formatDate(data.businessDate)}` : "Choose a location to start the close."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/app/square">
          Setup & Sync
        </Link>
        <Link aria-current="page" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white shadow-soft" to="/app/square-usage">
          Usage & Variance
        </Link>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">{message}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted" aria-busy="true">Loading daily close…</div> : null}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="p-6">
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
                {completed ? (
                  <Badge tone="neutral">
                    <Lock className="mr-1 h-3.5 w-3.5" />
                    Read only
                  </Badge>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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

                <div className="rounded-3xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Close snapshot</p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Inventory value</dt>
                      <dd className="font-semibold text-ink">{formatMoney(Number(snapshot?.inventoryValue ?? 0))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Theoretical usage</dt>
                      <dd className="font-semibold text-ink">{formatNumber(Number(usage?.totals?.theoreticalUsage ?? 0))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Actual usage</dt>
                      <dd className="font-semibold text-ink">{usage?.totals?.actualUsage == null ? "Unavailable" : formatNumber(Number(usage.totals.actualUsage))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted">Variance</dt>
                      <dd className="font-semibold text-ink">{snapshot ? `${formatSignedNumber(snapshot.variance.quantity)} · ${snapshot.variance.percent == null ? "—" : `${formatNumber(snapshot.variance.percent)}%`}` : "—"}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="rounded-3xl border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-ink">Notes</p>
                  {completed ? <span className="text-xs font-semibold uppercase tracking-wide text-muted">Read only</span> : null}
                </div>
                <textarea
                  className="input mt-3 min-h-32 w-full"
                  value={notes}
                  disabled={completed}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add context for unusual sales, waste, or count discrepancies."
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  {canSyncSales ? (
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-800 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={saving !== null}
                      onClick={() => void syncSales()}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {saving === "sync-sales" ? "Syncing..." : "Sync sales"}
                    </button>
                  ) : !completed ? (
                    <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/app/square">
                      <ExternalLink className="h-4 w-4" />
                      Connect Square
                    </Link>
                  ) : null}
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={completed || !currentSession || saving !== null}
                    onClick={() => void saveNotes()}
                  >
                    <Save className="h-4 w-4" />
                    Save notes
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={completed || !currentSession || saving !== null}
                    onClick={() => void finalizeClose()}
                  >
                    <Lock className="h-4 w-4" />
                    Finalize daily close
                  </button>
                  {currentSession ? (
                    <span className="inline-flex items-center rounded-full border border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      {completed ? `Completed ${formatDateTime(currentSession.completedAt)}` : "Draft"}
                    </span>
                  ) : null}
                </div>
              </div>

              {data?.exceptions?.length ? (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">Exceptions to review</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-950">
                    {data.exceptions.map((exception) => (
                      <li key={exception} className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{exception}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                  <div className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    No blockers
                  </div>
                  <p className="mt-2">The snapshot is ready to finalize when you are.</p>
                </div>
              )}

              <div className="rounded-3xl border border-line bg-slate-50 p-4">
                <SectionHeader title="Ingredient usage" description="Weighted-average cost flow for the current close." />
                {ingredientUsage.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full divide-y divide-line text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-muted">
                          <th className="py-2 pr-4">Item</th>
                          <th className="py-2 pr-4">Theoretical</th>
                          <th className="py-2 pr-4">Actual</th>
                          <th className="py-2 pr-4">Variance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-white">
                        {ingredientUsage.slice(0, 8).map((row) => (
                          <tr key={String(row.inventoryItemId ?? row.inventoryItemName)} className="align-top">
                            <td className="py-3 pr-4 font-medium text-ink">
                              <div>{String(row.inventoryItemName ?? "Item")}</div>
                              {Array.isArray(row.warnings) && row.warnings.length ? (
                                <div className="mt-1 text-xs text-amber-700">{row.warnings[0]}</div>
                              ) : null}
                            </td>
                            <td className="py-3 pr-4 text-muted">{formatNumber(Number(row.theoreticalUsage ?? 0))}</td>
                            <td className="py-3 pr-4 text-muted">{row.actualUsage == null ? "—" : formatNumber(Number(row.actualUsage))}</td>
                            <td className="py-3 pr-4 text-muted">
                              {row.discrepancy == null ? "—" : formatSignedNumber(Number(row.discrepancy))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl border border-dashed border-line bg-white px-4 py-6 text-sm text-muted">No ingredient usage rows are available yet.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-dashed border-line bg-slate-50 p-6 text-sm leading-6 text-muted">
              <p className="font-semibold text-ink">Start a daily close for this location.</p>
              <p className="mt-2">
                Flowtally will snapshot sales, usage, and exceptions so you can review the day before marking it complete.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!selectedLocationId}
                  onClick={() => void openClose()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Start daily close
                </button>
                <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/app/square">
                  Review Square
                </Link>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="Square context" description="Connection, mapping, and sync state that feed the close." />
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Connection</p>
                <p className="mt-2 font-semibold text-ink">{squareStatus}</p>
                <p className="mt-1 text-muted">{squareSynced ? "Square has synced into the close snapshot." : "Square is not yet connected for this location."}</p>
              </div>
              <div className="rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Location mapping</p>
                <p className="mt-2 font-semibold text-ink">{locationMapped ? "Mapped" : "Unmapped"}</p>
                <p className="mt-1 text-muted">Daily close uses the mapped Square location when one is available.</p>
              </div>
              <div className="rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Next step</p>
                <Link className="mt-2 inline-flex items-center gap-2 font-semibold text-brand-700 transition hover:text-brand-800" to="/app/square">
                  Open Square integration
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </Card>

          <Card className="p-6">
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
