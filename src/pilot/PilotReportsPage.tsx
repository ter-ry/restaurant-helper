import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, RefreshCcw } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { usePilotSession } from "./PilotSessionProvider";
import { fetchPilotReport, type PilotReportResponse } from "./pilotApi";
import { locationDateKey } from "./workspace/timezone";
import { formatMoney, formatNumber } from "./workspace/pilotWorkspaceUtils";

type ReportView = "daily" | "weekly";

function shiftDate(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayDate(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(value + "T12:00:00Z"));
}

function Change({ value }: { value: Record<string, any> | null | undefined }) {
  if (!value) return <span className="text-muted">No comparison</span>;
  const positive = Number(value.delta) >= 0;
  return <span className="text-brand-700">{positive ? <ArrowUpRight className="mr-1 inline h-4 w-4" /> : <ArrowDownRight className="mr-1 inline h-4 w-4" />}{value.percent == null ? "New" : Math.abs(Number(value.percent)).toFixed(1) + "%"}</span>;
}

const EXCEPTION_LINKS: Record<string, [string, string]> = {
  reorder_now: ["/app/inventory?view=reorder", "Review reorder"],
  unmapped_square_sales: ["/app/square", "Review mappings"],
  usage_variance: ["/app/inventory?view=usage", "Review usage"],
  stock_count: ["/app/inventory?view=counts", "Review count"],
  stock_counts: ["/app/inventory?view=counts", "Review count"],
  count: ["/app/inventory?view=counts", "Review count"],
  variance: ["/app/inventory?view=counts", "Review count"],
  purchase: ["/app/purchases", "Review invoices"],
  invoice: ["/app/purchases", "Review invoices"],
  purchase_review: ["/app/purchases", "Review invoices"],
  menu: ["/app/menu-costing", "Open Menu Costing"],
  recipe: ["/app/menu-costing", "Open Menu Costing"],
  menu_costing: ["/app/menu-costing", "Open Menu Costing"],
  square: ["/app/square", "Review Square"],
  mapping: ["/app/square", "Review Square"],
  square_mapping: ["/app/square", "Review Square"],
  close: ["/app/daily-close", "Complete close"],
  daily_close: ["/app/daily-close", "Complete close"],
};

function exceptionLink(type: unknown) {
  return EXCEPTION_LINKS[String(type ?? "").toLowerCase().replace(/-/g, "_")] ?? [null, null];
}

export function PilotReportsPage({ initialView = "daily" }: { initialView?: ReportView }) {
  const { currentLocation } = usePilotSession();
  const timezone = currentLocation?.timezone ?? "America/Toronto";
  const today = useMemo(() => locationDateKey(new Date().toISOString(), timezone), [timezone]);
  const view = initialView;
  const [dailyDate, setDailyDate] = useState("");
  const [weeklyStart, setWeeklyStart] = useState("");
  const [weeklyEnd, setWeeklyEnd] = useState("");
  const [data, setData] = useState<PilotReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDailyDate((current) => current || today);
    setWeeklyEnd((current) => current || today);
    setWeeklyStart((current) => current || shiftDate(today, -6));
  }, [today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = view === "weekly"
        ? await fetchPilotReport(view, { startDate: weeklyStart || undefined, endDate: weeklyEnd || undefined })
        : await fetchPilotReport(view, dailyDate || undefined);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [dailyDate, view, weeklyEnd, weeklyStart]);

  useEffect(() => {
    if (view === "daily" ? dailyDate : weeklyStart && weeklyEnd) void load();
  }, [dailyDate, load, view, weeklyEnd, weeklyStart]);

  const sales = data?.sales;
  const period = data?.period ?? {};
  const metrics = [
    ["Orders", formatNumber(sales?.orderCount)],
    ["Units sold", sales?.unitsSold == null ? "Unavailable" : formatNumber(sales.unitsSold)],
    ["Estimated food cost", data?.costing?.estimatedFoodCostPercent == null ? "Unavailable" : data.costing.estimatedFoodCostPercent.toFixed(1) + "%"],
    ["Cost coverage", data ? data.costing.costCoveragePercent.toFixed(0) + "%" : "—"],
  ];
  const mostOrdered = [...(sales?.byMenuItem ?? [])].sort((left, right) => Number(right.quantity ?? 0) - Number(left.quantity ?? 0))[0];
  const actionableExceptions = (data?.exceptions ?? []).filter((entry) => String(entry.type ?? "").toLowerCase() !== "missing_count_evidence");
  const menuMovers = [...(data?.changes?.menuMovers ?? [])].sort((left, right) =>
    Math.abs(Number(right.quantityDelta ?? 0)) - Math.abs(Number(left.quantityDelta ?? 0))
    || String(left.name).localeCompare(String(right.name)),
  );
  const breakdown = [
    ["Gross item sales", formatMoney(sales?.grossItemSales)],
    ["Discounts", formatMoney((sales as any)?.discounts)],
    ["Net item sales", formatMoney((sales as any)?.netItemSales)],
    ["Tax", formatMoney((sales as any)?.tax)],
    ["Tips", formatMoney((sales as any)?.tips)],
  ];

  return <div className="space-y-5">
    <Card className="surface-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-ink">{view === "daily" ? "Daily report" : "Weekly report"}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {view === "daily" ? <label className="text-sm font-semibold text-muted">Business date<input aria-label="Report date" className="input mt-1" type="date" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)} /></label> : <><label className="text-sm font-semibold text-muted">Start date<input aria-label="Weekly start date" className="input mt-1" type="date" value={weeklyStart} onChange={(event) => setWeeklyStart(event.target.value)} /></label><label className="text-sm font-semibold text-muted">End date<input aria-label="Weekly end date" className="input mt-1" type="date" value={weeklyEnd} onChange={(event) => setWeeklyEnd(event.target.value)} /></label></>}
          <Button type="button" variant="secondary" onClick={() => void load()}><RefreshCcw className="h-4 w-4" />Refresh</Button>
        </div>
      </div>
      {view === "weekly" && data ? <p className="mt-4 text-sm text-muted">Selected period: <strong className="text-ink">{displayDate(period.startDate)} – {displayDate(period.endDate)}</strong> · Compared with: <strong className="text-ink">{displayDate(period.priorStartDate)} – {displayDate(period.priorEndDate)}</strong></p> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
      {loading && !data ? <p className="mt-4 text-sm text-muted" aria-busy="true">Loading report...</p> : null}
    </Card>
    {data ? <><Card className="border-brand-100 bg-brand-50/30 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-bold uppercase tracking-wide text-muted">Total collected</p><p className="mt-1 text-4xl font-bold tracking-tight text-ink">{formatMoney(sales?.totalCollected)}</p>{view === "weekly" ? <p className="mt-2 text-sm text-muted">{displayDate(period.startDate)} – {displayDate(period.endDate)}</p> : null}</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">{metrics.map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-lg font-bold text-ink">{value}</p></div>)}</div>
      </div>
    </Card>
    <Card className="p-5"><SectionHeader title="Sales breakdown" /><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{breakdown.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 font-semibold text-ink">{value}</p></div>)}</div></Card>
    {view === "daily" ? <div className={`grid gap-5 ${mostOrdered && actionableExceptions.length ? "lg:grid-cols-2" : ""}`}>
      {mostOrdered ? <Card className="p-5"><SectionHeader title="Menu performance" /><div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Most ordered</p><p className="mt-1 text-lg font-bold text-ink">{mostOrdered.name}</p><p className="mt-1 text-sm text-muted">{formatNumber(mostOrdered.quantity)} units</p></div></Card> : null}
      {actionableExceptions.length ? <Card className="p-5"><SectionHeader title="Needs attention" /><div className="mt-3 space-y-2">{actionableExceptions.map((entry, index) => { const [to, label] = exceptionLink(entry.type); return <div key={String(entry.type) + index} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-slate-50 p-3"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" /><div><p className="text-sm font-semibold text-ink">{entry.title as string}</p><p className="text-xs text-muted">{entry.detail as string}</p></div></div>{to ? <Link className="shrink-0 text-xs font-semibold text-brand-700" to={to}>{label}</Link> : null}</div>; })}</div></Card> : null}
    </div> : null}
    {view === "weekly" && data.changes ? <div className={`grid gap-5 ${data.changes.menuMovers?.length ? "lg:grid-cols-2" : ""}`}>
      <Card className="p-5"><SectionHeader title="Period comparison" /><div className="mt-4 grid gap-3 sm:grid-cols-3"><div><p className="text-sm text-muted">Collected sales</p><p className="mt-1 text-xl font-bold text-ink">{formatMoney(data.changes.sales?.current)}</p><Change value={data.changes.sales} /></div><div><p className="text-sm text-muted">Orders</p><p className="mt-1 text-xl font-bold text-ink">{formatNumber(data.changes.orders?.current)}</p><Change value={data.changes.orders} /></div><div><p className="text-sm text-muted">Purchase spend</p><p className="mt-1 text-xl font-bold text-ink">{formatMoney(data.changes.purchaseSpend?.current)}</p><Change value={data.changes.purchaseSpend} /></div></div></Card>
      {data.changes.menuMovers?.length ? <Card className="p-5"><SectionHeader title="Menu movers" /><div className="mt-4 grid gap-3 sm:grid-cols-2">{menuMovers.slice(0, 4).map((row) => <div key={row.menuItemId} className="flex items-center justify-between rounded-xl border border-line bg-slate-50 p-3"><div><p className="text-sm font-semibold text-ink">{row.name}</p><p className="text-xs text-muted">{formatNumber(row.currentQuantity)} units vs {formatNumber(row.priorQuantity)} prior</p></div><Change value={{ delta: row.quantityDelta, percent: row.quantityDeltaPercent }} /></div>)}</div></Card> : null}
    </div> : null}
    {view === "weekly" && actionableExceptions.length ? <Card className="p-5"><SectionHeader title="Needs attention" /><div className="mt-3 space-y-2">{actionableExceptions.map((entry, index) => { const [to, label] = exceptionLink(entry.type); return <div key={String(entry.type) + index} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-slate-50 p-3"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" /><div><p className="text-sm font-semibold text-ink">{entry.title as string}</p><p className="text-xs text-muted">{entry.detail as string}</p></div></div>{to ? <Link className="shrink-0 text-xs font-semibold text-brand-700" to={to}>{label}</Link> : null}</div>; })}</div></Card> : null}
    <Card className="p-5"><SectionHeader title="Usage variance" />{data.usageVariance.valid ? <div className="mt-3 space-y-2">{data.usageVariance.rows.slice(0, 4).map((row) => <div key={row.inventoryItemId} className="flex items-center justify-between border-b border-line py-2 text-sm"><span className="font-semibold text-ink">{row.itemName} <span className="text-xs text-muted">({row.unit})</span></span><Badge tone={Math.abs(row.variance) > 0 ? "warning" : "success"}>{row.variance >= 0 ? "+" : ""}{row.variance} · {row.variancePercent == null ? "—" : Number(row.variancePercent).toFixed(1) + "%"}</Badge></div>)}{data.usageVariance.rows.length > 4 ? <p className="mt-2 text-xs text-muted">Showing the first four rows.</p> : null}</div> : <p className="mt-2 text-sm text-muted">Physical variance not available for this full business day. Flowtally will calculate it when valid opening and closing counts bracket the period.</p>}</Card>
    <details className="rounded-2xl border border-line bg-white p-5"><summary className="cursor-pointer font-semibold text-ink">Menu-item breakdown</summary><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-3">Item</th><th className="px-3 py-3 text-right">Units</th><th className="px-3 py-3 text-right">Gross item sales</th><th className="px-3 py-3 text-right">Net item sales</th><th className="px-3 py-3 text-right">Food cost</th><th className="px-3 py-3 text-right">Change</th></tr></thead><tbody>{data.sales.byMenuItem.map((row) => <tr key={row.menuItemId} className="border-b border-line"><td className="px-3 py-3"><p className="font-semibold text-ink">{row.name}</p><p className="text-xs text-muted">{row.category}{row.costAvailable ? "" : " · cost unavailable"}</p></td><td className="px-3 py-3 text-right">{formatNumber(row.quantity)}</td><td className="px-3 py-3 text-right">{formatMoney(row.grossAmount)}</td><td className="px-3 py-3 text-right">{formatMoney(row.netAmount)}</td><td className="px-3 py-3 text-right">{row.costAvailable && row.estimatedFoodCostPercent != null ? Number(row.estimatedFoodCostPercent).toFixed(1) + "%" : "—"}</td><td className="px-3 py-3 text-right"><Change value={{ delta: row.quantityDelta, percent: row.quantityDeltaPercent }} /></td></tr>)}</tbody></table></div>{data.sales.unmappedLines.length ? <p className="mt-4 text-sm text-amber-800">{data.sales.unmappedLines.length} Square line(s) are not mapped to Flowtally menu items.</p> : null}</details>
    </> : null}
  </div>;
}
