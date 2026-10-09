import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCcw } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { fetchPilotReport, type PilotReportResponse } from "./pilotApi";
import { formatMoney, formatNumber } from "./workspace/pilotWorkspaceUtils";

function Change({ value }: { value: Record<string, any> | null | undefined }) {
  if (!value) return <span className="text-muted">No comparison</span>;
  const positive = Number(value.delta) >= 0;
  return <span className={positive ? "text-emerald-700" : "text-rose-700"}>{positive ? <ArrowUpRight className="mr-1 inline h-4 w-4" /> : <ArrowDownRight className="mr-1 inline h-4 w-4" />}{value.percent == null ? "New" : `${Math.abs(Number(value.percent)).toFixed(1)}%`}</span>;
}

export function PilotReportsPage() {
  const [view, setView] = useState<"daily" | "weekly">("daily");
  const [date, setDate] = useState("");
  const [data, setData] = useState<PilotReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fetchPilotReport(view, date || undefined)); } catch (err) { setError(err instanceof Error ? err.message : "Could not load the report."); } finally { setLoading(false); }
  }, [date, view]);
  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-6">
    <Card className="surface-panel p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Reporting</p><h1 className="mt-2 text-3xl font-bold text-ink">{view === "daily" ? "Daily report" : "Weekly report"}</h1><p className="mt-2 text-sm text-muted">Read-only sales, purchasing, inventory and exception insight for the active restaurant location.</p></div>
        <div className="flex flex-wrap items-center gap-2"><div className="flex rounded-xl border border-line bg-slate-50 p-1"><button type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === "daily" ? "bg-white text-ink shadow-sm" : "text-muted"}`} onClick={() => setView("daily")}>Daily</button><button type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === "weekly" ? "bg-white text-ink shadow-sm" : "text-muted"}`} onClick={() => setView("weekly")}>Weekly</button></div><input aria-label="Report date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} onBlur={() => void load()} /><Button type="button" variant="secondary" onClick={() => void load()}><RefreshCcw className="h-4 w-4" />Refresh</Button></div>
      </div>
      {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
      {loading && !data ? <p className="mt-6 text-sm text-muted" aria-busy="true">Loading report...</p> : null}
    </Card>
    {data ? <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[["Gross item sales", formatMoney(data.sales.grossItemSales)], ["Total collected", formatMoney(data.sales.totalCollected)], ["Orders", formatNumber(data.sales.orderCount)], ["Estimated food cost", data.costing.estimatedFoodCostPercent == null ? "Unavailable" : `${data.costing.estimatedFoodCostPercent.toFixed(1)}%`]].map(([label, value]) => <Card key={label} className="p-5"><p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p><p className="mt-2 text-2xl font-bold text-ink">{value}</p>{label === "Estimated food cost" ? <p className="mt-1 text-xs text-muted">Current-cost estimate · {data.costing.costCoveragePercent.toFixed(0)}% sales coverage</p> : null}</Card>)}
      </div>
      {view === "weekly" && data.changes ? <Card className="p-6"><SectionHeader title="Period-over-period changes" description="Compared with the immediately preceding equal-length business period." /><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><p className="text-sm text-muted">Collected sales</p><p className="mt-1 text-xl font-bold text-ink">{formatMoney(data.changes.sales?.current)}</p><Change value={data.changes.sales} /></div><div><p className="text-sm text-muted">Orders</p><p className="mt-1 text-xl font-bold text-ink">{formatNumber(data.changes.orders?.current)}</p><Change value={data.changes.orders} /></div><div><p className="text-sm text-muted">Purchase spend</p><p className="mt-1 text-xl font-bold text-ink">{formatMoney(data.changes.purchaseSpend?.current)}</p><Change value={data.changes.purchaseSpend} /></div></div></Card> : null}
      <Card className="p-6"><SectionHeader title="Menu-item performance" description="Mapped Square sales with current recipe-cost estimates." /><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-3">Item</th><th className="px-3 py-3 text-right">Units</th><th className="px-3 py-3 text-right">Gross item sales</th><th className="px-3 py-3 text-right">Net item sales</th><th className="px-3 py-3 text-right">Food cost</th><th className="px-3 py-3 text-right">Change</th></tr></thead><tbody>{data.sales.byMenuItem.map((row) => <tr key={row.menuItemId} className="border-b border-line"><td className="px-3 py-3"><p className="font-semibold text-ink">{row.name}</p><p className="text-xs text-muted">{row.category}{row.costAvailable ? "" : " · cost unavailable"}</p></td><td className="px-3 py-3 text-right">{formatNumber(row.quantity)}</td><td className="px-3 py-3 text-right">{formatMoney(row.grossAmount)}</td><td className="px-3 py-3 text-right">{formatMoney(row.netAmount)}</td><td className="px-3 py-3 text-right">{row.costAvailable && row.estimatedFoodCostPercent != null ? `${Number(row.estimatedFoodCostPercent).toFixed(1)}%` : "—"}</td><td className="px-3 py-3 text-right"><Change value={{ delta: row.quantityDelta, percent: row.quantityDeltaPercent }} /></td></tr>)}</tbody></table></div>{data.sales.unmappedLines.length ? <p className="mt-4 text-sm text-amber-800">{data.sales.unmappedLines.length} Square line(s) are not mapped to Flowtally menu items.</p> : null}</Card>
      {view === "weekly" && data.changes ? <Card className="p-6"><SectionHeader title="Menu movers" description="Only items with a real prior-period comparison are included." /><div className="grid gap-3 md:grid-cols-2">{[...data.changes.menuMovers].sort((a, b) => Number(b.quantityDelta) - Number(a.quantityDelta)).slice(0, 4).map((row) => <div key={row.menuItemId} className="flex items-center justify-between rounded-xl border border-line bg-slate-50 p-3"><div><p className="text-sm font-semibold text-ink">{row.name}</p><p className="text-xs text-muted">{formatNumber(row.currentQuantity)} units vs {formatNumber(row.priorQuantity)} prior</p></div><Change value={{ delta: row.quantityDelta, percent: row.quantityDeltaPercent }} /></div>)}</div></Card> : null}
      <div className="grid gap-6 xl:grid-cols-2"><Card className="p-6"><SectionHeader title="What needs attention" /><div className="mt-4 space-y-3">{data.exceptions.length ? data.exceptions.map((entry, index) => <div key={`${entry.type}-${index}`} className="flex items-start gap-3 rounded-xl border border-line bg-slate-50 p-3"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" /><div><p className="text-sm font-semibold text-ink">{entry.title as string}</p><p className="text-xs text-muted">{entry.detail as string || "Review the linked operational page."}</p></div></div>) : <p className="text-sm text-muted">No report exceptions for this period.</p>}</div></Card><Card className="p-6"><SectionHeader title="Usage variance" description="Physical usage requires completed opening and closing counts." />{data.usageVariance.valid ? <div className="mt-4 space-y-2">{data.usageVariance.rows.map((row) => <div key={row.inventoryItemId} className="flex items-center justify-between border-b border-line py-2 text-sm"><span className="font-semibold text-ink">{row.itemName} <span className="text-xs text-muted">({row.unit})</span></span><Badge tone={Math.abs(row.variance) > 0 ? "warning" : "success"}>{row.variance >= 0 ? "+" : ""}{row.variance} · {row.variancePercent == null ? "—" : `${row.variancePercent.toFixed(1)}%`}</Badge></div>)}</div> : <p className="mt-4 text-sm text-muted">No completed count evidence.</p>}</Card></div>
    </> : null}
  </div>;
}
