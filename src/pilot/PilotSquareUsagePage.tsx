import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";
import { PageLayout } from "../components/PageLayout";
import { usePilotSession } from "./PilotSessionProvider";
import { fetchSquareUsage, type SquareUsageIngredientRow, type SquareUsageReport } from "../lib/squareIntegration";
import { locationDatetimeLocalToUtcIso, locationNowDatetimeLocal } from "./workspace/timezone";

function formatQuantity(value: number | null | undefined) {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 4 }).format(Number(value ?? 0));
}

function formatBoundary(quantity: number | null, completedAt: string | null, sessionId: number | null) {
  if (quantity == null || !completedAt) return "Unavailable";
  const timestamp = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(completedAt));
  return `${formatQuantity(quantity)} · ${timestamp}${sessionId == null ? "" : ` · session ${sessionId}`}`;
}

function defaultRange(timezone: string) {
  const now = new Date();
  return {
    startAt: locationNowDatetimeLocal(timezone, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
    endAt: locationNowDatetimeLocal(timezone, now),
  };
}

function varianceTone(row: SquareUsageIngredientRow) {
  if (row.discrepancy == null) return "text-muted";
  return row.discrepancy === 0 ? "text-emerald-700" : "text-amber-700";
}

function UsageRow({ row, onSelect }: { row: SquareUsageIngredientRow; onSelect: () => void }) {
  return (
    <tr className="cursor-pointer border-t border-line hover:bg-brand-50/40" onClick={onSelect} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}>
      <td className="px-3 py-3 align-top"><div className="font-semibold text-ink">{row.inventoryItemName}</div><div className="text-xs text-muted">{row.unit}</div></td>
      <td className="px-3 py-3 text-right font-semibold text-ink">{formatQuantity(row.soldMenuUnits)}</td>
      <td className="px-3 py-3 text-right font-semibold text-ink">{formatQuantity(row.theoreticalUsage)}</td>
      <td className="px-3 py-3 text-right font-semibold text-ink">{row.actualUsage == null ? "—" : formatQuantity(row.actualUsage)}</td>
      <td className={`px-3 py-3 text-right font-semibold ${varianceTone(row)}`}>{row.discrepancy == null ? "—" : formatQuantity(row.discrepancy)}</td>
      <td className="px-3 py-3 text-right font-semibold text-ink">{row.discrepancyPercent == null ? "—" : `${formatQuantity(row.discrepancyPercent)}%`}</td>
    </tr>
  );
}

export function PilotSquareUsagePage() {
  const { organization, currentLocation, locations } = usePilotSession();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(currentLocation?.id ?? null);
  const timezone = locations.find((location) => location.id === selectedLocationId)?.timezone ?? currentLocation?.timezone ?? "America/Toronto";
  const initialRange = useMemo(() => defaultRange(timezone), [timezone]);
  const [startAt, setStartAt] = useState(initialRange.startAt);
  const [endAt, setEndAt] = useState(initialRange.endAt);
  const [appliedRange, setAppliedRange] = useState(initialRange);
  const [usage, setUsage] = useState<SquareUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVarianceId, setSelectedVarianceId] = useState<number | null>(null);
  const locationOptions = locations.length ? locations : currentLocation ? [currentLocation] : [];

  const load = useCallback(async () => {
    if (!organization) { setUsage(null); setLoading(false); return; }
    setRefreshing(true);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchSquareUsage({
        organizationId: organization.id,
        locationId: selectedLocationId ?? undefined,
        startAt: locationDatetimeLocalToUtcIso(appliedRange.startAt, timezone),
        endAt: locationDatetimeLocalToUtcIso(appliedRange.endAt, timezone),
      });
      setUsage(response.usage);
    } catch (err) {
      setUsage(null);
      setError(err instanceof Error ? err.message : "Could not load usage data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appliedRange.endAt, appliedRange.startAt, organization, selectedLocationId, timezone]);

  useEffect(() => { void load(); }, [load]);

  const applyRange = () => {
    if (startAt && endAt) setAppliedRange({ startAt, endAt });
  };

  const rows = usage?.ingredientUsage ?? [];
  const attentionRows = useMemo(() => rows.filter((row) => row.discrepancy != null && row.discrepancy !== 0).sort((a, b) => Math.abs(Number(b.discrepancyPercent ?? 0)) - Math.abs(Number(a.discrepancyPercent ?? 0))).slice(0, 4), [rows]);
  const matchedRows = rows.filter((row) => row.actualUsage != null && row.discrepancy === 0);
  const physicalRows = rows.filter((row) => row.actualUsage != null);
  const selectedRow = rows.find((row) => row.inventoryItemId === selectedVarianceId) ?? null;

  if (!organization) {
    return <PageLayout title="Usage & Variance" eyebrow="Operations workspace" className="pilot-usage-shell" embedded><Card className="p-6"><h1 className="text-2xl font-bold text-ink">Choose an organization first</h1><p className="mt-3 text-sm leading-6 text-muted">The usage workspace needs an active organization and location.</p></Card></PageLayout>;
  }

  return <PageLayout title="Usage & Variance" eyebrow="Operations workspace" className="pilot-usage-shell" embedded>
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Usage window</p><h1 className="mt-2 text-3xl font-bold text-ink">Usage &amp; Variance</h1></div>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void load()} disabled={refreshing}><RefreshCw className="h-4 w-4" />{refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="text-sm font-semibold text-ink">Location</span><select className="input mt-1" value={selectedLocationId ?? ""} onChange={(event) => setSelectedLocationId(event.target.value ? Number(event.target.value) : null)}><option value="">All locations</option>{locationOptions.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label className="block"><span className="text-sm font-semibold text-ink">Start at</span><input className="input mt-1" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
          <label className="block"><span className="text-sm font-semibold text-ink">End at</span><input className="input mt-1" type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>
        </div>
        <div className="mt-4 flex justify-end"><button className="inline-flex min-h-10 items-center rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white" type="button" onClick={applyRange}>Apply</button></div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Usage data unavailable</div><p className="mt-2">{error}</p></div> : null}
      {loading ? <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-muted" aria-busy="true">Loading usage data…</div> : null}

      {usage ? <Card className="p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Sales coverage</p><p className="mt-2 text-2xl font-bold text-ink">{usage.coverage.mappedSalesCoveragePercent}%</p><p className="mt-1 text-xs text-muted">Mapped Square sales</p></div>
          <div className="rounded-2xl border border-line bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Menu units sold</p><p className="mt-2 text-2xl font-bold text-ink">{formatQuantity(usage.coverage.totalSoldUnits)}</p><p className="mt-1 text-xs text-muted">Units driving theoretical usage</p></div>
          <div className="rounded-2xl border border-line bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Physical comparison</p><p className="mt-2 text-2xl font-bold text-ink">{physicalRows.length ? `${physicalRows.length}/${rows.length}` : "Not available"}</p><p className="mt-1 text-xs text-muted">{physicalRows.length ? "Count-derived usage available" : "Requires completed counts that bracket the period"}</p></div>
        </div>

        {usage.coverage.unmappedVariationCount > 0 ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><span>{usage.coverage.unmappedVariationCount} Square variation(s) need mapping.</span><Link className="font-semibold text-amber-900 underline" to="/app/square">Review mappings →</Link></div> : null}

        {attentionRows.length ? <section className="mt-6"><h2 className="text-xl font-bold text-ink">Needs attention</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{attentionRows.map((row) => <button key={row.inventoryItemId} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left" type="button" onClick={() => setSelectedVarianceId(row.inventoryItemId)}><div className="flex items-center justify-between gap-3"><span className="font-semibold text-ink">{row.inventoryItemName}</span><span className="font-semibold text-amber-900">{row.discrepancyPercent == null ? "Review" : `${Math.abs(Number(row.discrepancyPercent)).toFixed(1)}% variance`}</span></div><p className="mt-2 text-sm text-muted">Expected: {formatQuantity(row.theoreticalUsage)} {row.unit} · Physical usage: {row.actualUsage == null ? "Unavailable" : formatQuantity(row.actualUsage) + " " + row.unit}</p></button>)}</div></section> : null}

        {matchedRows.length ? <div className="mt-6 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted"><span className="font-semibold text-ink">Matched expected usage</span> · {matchedRows.length} item(s)</div> : null}

        <section className="mt-6"><div className="flex items-center gap-2 text-lg font-bold text-ink"><BarChart3 className="h-4 w-4 text-brand-700" />Theoretical usage</div><div className="mt-3 max-h-[34rem] overflow-auto rounded-2xl border border-line bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-3">Inventory item</th><th className="px-3 py-3 text-right">Sold menu units</th><th className="px-3 py-3 text-right">Theoretical usage</th><th className="px-3 py-3 text-right">Physical usage</th><th className="px-3 py-3 text-right">Variance</th><th className="px-3 py-3 text-right">Variance %</th></tr></thead><tbody>{rows.length ? rows.map((row) => <UsageRow key={row.inventoryItemId} row={row} onSelect={() => setSelectedVarianceId(row.inventoryItemId)} />) : <tr><td className="px-3 py-8 text-center text-muted" colSpan={6}>No theoretical usage rows are available yet.</td></tr>}</tbody></table></div></section>
      </Card> : null}

      {selectedRow ? <Modal title={`Variance detail · ${selectedRow.inventoryItemName}`} onClose={() => setSelectedVarianceId(null)} size="large"><p className="text-sm leading-6 text-muted">Count-derived usage reuses completed physical counts and qualifying Flowtally movements. POS-driven Square depletion is excluded.</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Opening count</dt><dd className="font-semibold text-ink">{formatBoundary(selectedRow.actualUsageBasis.openingQuantity, selectedRow.actualUsageBasis.openingCountCompletedAt, selectedRow.actualUsageBasis.openingCountSessionId)}</dd></div><div><dt className="text-muted">Closing count</dt><dd className="font-semibold text-ink">{formatBoundary(selectedRow.actualUsageBasis.closingQuantity, selectedRow.actualUsageBasis.closingCountCompletedAt, selectedRow.actualUsageBasis.closingCountSessionId)}</dd></div><div><dt className="text-muted">Qualifying movement net</dt><dd className="font-semibold text-ink">{selectedRow.actualUsageBasis.movementNet == null ? "Unavailable" : formatQuantity(selectedRow.actualUsageBasis.movementNet)}</dd></div><div><dt className="text-muted">Count-derived usage</dt><dd className="font-semibold text-ink">{selectedRow.actualUsage == null ? "Unavailable" : formatQuantity(selectedRow.actualUsage)}</dd></div><div><dt className="text-muted">POS theoretical usage</dt><dd className="font-semibold text-ink">{formatQuantity(selectedRow.theoreticalUsage)}</dd></div><div><dt className="text-muted">Variance</dt><dd className="font-semibold text-ink">{selectedRow.discrepancy == null ? "Unavailable" : formatQuantity(selectedRow.discrepancy)}{selectedRow.discrepancyPercent == null ? "" : ` (${formatQuantity(selectedRow.discrepancyPercent)}%)`}</dd></div></dl><div className="mt-4 rounded-xl border border-line bg-slate-50 p-3 text-sm text-muted"><p className="font-semibold text-ink">Calculation</p><p className="mt-1">Opening + qualifying movements − closing = count-derived usage</p><p className="mt-1">Count-derived usage − theoretical usage = variance</p><div className="mt-3 border-t border-line pt-3"><p className="font-semibold text-ink">Sign meaning</p><p className="mt-1">Positive: more physical stock disappeared than theoretical usage predicted.</p><p className="mt-1">Negative: less physical stock disappeared than theoretical usage predicted.</p><p className="mt-1">Zero: physical usage matches theoretical usage.</p></div></div><div className="mt-5 flex flex-wrap gap-2"><Link className="text-sm font-semibold text-brand-700" to="/app/inventory">Review inventory</Link><Link className="text-sm font-semibold text-brand-700" to="/app/purchases">Review purchases</Link><Link className="text-sm font-semibold text-brand-700" to="/app/menu-costing">Review Menu Costing</Link><Link className="text-sm font-semibold text-brand-700" to="/app/inventory?view=counts">Review stock counts</Link></div></Modal> : null}
    </div>
  </PageLayout>;
}
