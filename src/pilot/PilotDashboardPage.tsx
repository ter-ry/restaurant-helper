import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ClipboardList, PackageSearch, RefreshCcw, ShoppingCart } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { WorkspacePageHeader } from "./workspace/WorkspacePageHeader";
import { fetchPilotDashboard, type PilotDashboardResponse } from "./pilotApi";
import { formatDate, formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

export function PilotDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<PilotDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try { setData(await fetchPilotDashboard()); } catch (err) { setError(err instanceof Error ? err.message : "Could not load the dashboard."); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const summary = (data?.summary ?? {}) as Record<string, number>;
  const attentionItems = useMemo(() => [
    { key: "reorder", title: "Reorder pressure", detail: `${data?.operationalAttention?.reorder.count ?? summary.inventoryItemsToReorderCount ?? 0} item(s) need ordering now.`, count: data?.operationalAttention?.reorder.count ?? summary.inventoryItemsToReorderCount ?? 0, to: "/app/inventory?view=reorder", action: "Review reorder", tone: "warning" as const },
    { key: "invoice", title: "Invoices need review", detail: `${data?.summary.invoiceReviewQueueCount ?? 0} invoice(s) are waiting for review.`, count: data?.summary.invoiceReviewQueueCount ?? 0, to: "/app/purchases", action: "Review invoices", tone: "warning" as const },
    { key: "price", title: "Supplier price changes", detail: `${data?.summary.recentPriceChangeCount ?? 0} captured change(s) this week.`, count: data?.summary.recentPriceChangeCount ?? 0, to: "/app/purchases", action: "Review price changes", tone: "orange" as const },
    { key: "close", title: "Daily Close is outstanding", detail: "Today's close is still open or has not been started.", count: data?.operationalAttention?.dailyClose.count ?? 0, to: "/app/daily-close", action: "Complete close", tone: "warning" as const },
    { key: "square", title: "Square sync needs attention", detail: "The connected Square integration has an active sync issue.", count: data?.operationalAttention?.square.syncErrorCount ?? 0, to: "/app/square", action: "Review Square", tone: "danger" as const },
  ].filter((item) => item.count > 0), [data?.operationalAttention, data?.summary, summary.inventoryItemsToReorderCount]);

  const topMetrics = [
    { label: "Inventory value", value: loading ? "—" : formatMoney(data?.summary.inventoryValue), helper: `${formatNumber(data?.summary.inventoryItemCount)} items tracked` },
    { label: "Purchases this week", value: loading ? "—" : formatMoney(data?.summary.weeklyInvoiceSpend), helper: `${formatNumber(data?.summary.weeklyInvoiceCount)} invoices` },
    { label: "Month-to-date spend", value: loading ? "—" : formatMoney(data?.summary.monthlyInvoiceSpend), helper: `${formatNumber(data?.summary.monthlyInvoiceCount)} invoices this month` },
  ];

  return <div className="workspace-page">
    <WorkspacePageHeader eyebrow="Dashboard" title="Today" actions={<button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void load()}><RefreshCcw className="h-4 w-4" />Refresh</button>} metrics={topMetrics} />
    {error ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
    {loading && !data ? <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-muted" aria-busy="true">Loading dashboard data...</div> : null}

    {data?.insights ? <Card className="border-brand-100 bg-brand-50/30 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-muted">How are we doing?</p><p className="mt-1 text-4xl font-bold tracking-tight text-ink">{formatMoney(data.insights.today.totalCollected)}</p><p className="mt-2 text-sm text-muted">{formatNumber(data.insights.today.orderCount)} orders</p></div>
        <div className="flex flex-wrap gap-5 text-sm"><div><p className="text-xs uppercase tracking-wide text-muted">Estimated food cost</p><p className="mt-1 font-bold text-ink">{data.insights.estimatedFoodCost.estimatedFoodCostPercent == null ? "—" : `${data.insights.estimatedFoodCost.estimatedFoodCostPercent.toFixed(1)}%`}</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Coverage</p><p className="mt-1 font-bold text-ink">{data.insights.estimatedFoodCost.costCoveragePercent.toFixed(0)}%</p></div></div>
        <Link className="text-sm font-semibold text-brand-700" to="/app/dashboard?view=daily">Open daily report <ArrowUpRight className="inline h-4 w-4" /></Link>
      </div>
    </Card> : null}

    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-800">Needs attention</p><h2 className="mt-1 text-xl font-bold text-ink">What should you do next?</h2></div>{attentionItems.length ? <Badge tone="warning">{formatNumber(attentionItems.length)} actions</Badge> : null}</div>
      {attentionItems.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">{attentionItems.slice(0, 5).map((item) => <Link key={item.key} to={item.to} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-slate-50 px-4 py-3 transition hover:shadow-soft"><div><p className="font-semibold text-ink">{item.title}</p><p className="mt-1 text-sm text-muted">{item.detail}</p><p className="mt-2 text-xs font-semibold text-brand-700">{item.action}</p></div><Badge tone={item.tone}>{formatNumber(item.count)}</Badge></Link>)}</div> : <p className="mt-4 text-sm text-muted">No operational alerts right now.</p>}
    </Card>

    <Card className="p-5">
      <SectionHeader title="Operating snapshot" description="The numbers that help plan the next shift." />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[
        ["Inventory", data?.workflow.inventory ?? "Not ready", "/app/inventory", ShoppingCart],
        ["Reorder", data?.workflow.reorder ?? "Alert", "/app/inventory?view=reorder", PackageSearch],
        ["Close", data?.workflow.close ?? "Open", "/app/daily-close", CalendarDays],
        ["Purchases", data?.workflow.purchase ?? "Needs review", "/app/purchases", ClipboardList],
        ["Square", data?.operationalAttention?.square.syncErrorCount ? "Needs review" : "Ready", "/app/square", RefreshCcw],
      ].map(([label, status, to, Icon]) => <Link key={String(label)} to={String(to)} className="rounded-xl border border-line bg-slate-50 p-3 transition hover:-translate-y-0.5 hover:shadow-soft"><div className="flex items-center justify-between"><span className="rounded-lg bg-brand-50 p-2 text-brand-700"><Icon className="h-4 w-4" /></span><Badge tone={statusTone(String(status))}>{String(status)}</Badge></div><p className="mt-3 text-sm font-bold text-ink">{String(label)}</p></Link>)}</div>
    </Card>

    <details className="rounded-2xl border border-line bg-white p-5">
      <summary className="cursor-pointer font-semibold text-ink">View recent activity</summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><h2 className="text-sm font-bold text-ink">Recent price changes</h2><div className="mt-3 space-y-2">{(data?.recentPriceChanges ?? []).slice(0, 5).map((change) => <div key={String(change.id)} className="rounded-xl bg-slate-50 p-3"><p className="font-semibold text-ink">{String(change.itemName ?? change.item ?? "Item")}</p><p className="text-sm text-muted">{String(change.supplier ?? "")} · {String(change.invoiceDate ?? change.dateDetected ?? "")}</p></div>)}{!(data?.recentPriceChanges?.length) ? <p className="text-sm text-muted">No price changes yet.</p> : null}</div></div>
        <div><h2 className="text-sm font-bold text-ink">Inventory activity</h2><div className="mt-3 space-y-2">{(data?.recentMovements ?? []).slice(0, 5).map((movement) => <div key={movement.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><div><p className="font-semibold text-ink">{movement.inventoryItemName}</p><p className="text-sm text-muted">{movement.reason}</p></div><span className="text-sm font-semibold text-ink">{movement.quantityDelta > 0 ? "+" : ""}{formatNumber(movement.quantityDelta)} {movement.unit}<br /><span className="text-xs text-muted">{formatDateTime(movement.createdAt)}</span></span></div>)}</div></div>
      </div>
    </details>
  </div>;
}
