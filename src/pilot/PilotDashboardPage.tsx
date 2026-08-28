import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, CalendarDays, ChevronRight, ClipboardList, PackageSearch, RefreshCcw, ShoppingCart, TrendingUp } from "lucide-react";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { SectionHeader } from "../components/SectionHeader";
import { WorkspacePageHeader } from "./workspace/WorkspacePageHeader";
import { fetchPilotDashboard, type PilotDashboardResponse } from "./pilotApi";
import { formatDate, formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

const attentionOrder = [
  ["invoiceReviewQueueCount", "Invoices to review", "Review"],
  ["recentPriceChangeCount", "Supplier price changes", "Prices"],
  ["inventoryLowStockCount", "Low stock", "Stock"],
  ["inventoryReorderNowCount", "Reorder now", "Reorder"],
];

export function PilotDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<PilotDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dashboardLoading = loading && !data;

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchPilotDashboard();
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const topMetrics = useMemo(
    () => [
      {
        label: "Purchases this week",
        value: dashboardLoading ? "—" : formatMoney(data?.summary.weeklyInvoiceSpend),
        helper: dashboardLoading ? "Loading weekly spend" : `${formatNumber(data?.summary.weeklyInvoiceCount)} invoices`,
        to: "/app/purchases",
      },
      {
        label: "Month-to-date spend",
        value: dashboardLoading ? "—" : formatMoney(data?.summary.monthlyInvoiceSpend),
        helper: dashboardLoading ? "Loading month-to-date spend" : `${formatNumber(data?.summary.monthlyInvoiceCount)} invoices this month`,
        to: "/app/purchases",
      },
      {
        label: "Inventory value",
        value: dashboardLoading ? "—" : formatMoney(data?.summary.inventoryValue),
        helper: dashboardLoading ? "Loading inventory totals" : `${formatNumber(data?.summary.inventoryItemCount)} items tracked`,
        to: "/app/inventory",
      },
      {
        label: "Reorder now",
        value: dashboardLoading ? "—" : formatNumber(data?.summary.inventoryReorderNowCount),
        helper: dashboardLoading ? "Loading reorder status" : `${formatNumber(data?.summary.inventoryLowStockCount)} low stock`,
        to: "/app/reorder-plan",
      },
      {
        label: "Invoices to review",
        value: dashboardLoading ? "—" : formatNumber(data?.summary.invoiceReviewQueueCount),
        helper: dashboardLoading ? "Loading review queue" : `${formatNumber(data?.summary.inventoryCountNeededCount)} count checks due`,
        to: "/app/purchases",
      },
      {
        label: "Price changes this week",
        value: dashboardLoading ? "—" : formatNumber(data?.summary.recentPriceChangeCount),
        helper: dashboardLoading ? "Loading price changes" : "supplier updates captured",
        to: "/app/purchases",
      },
    ],
    [dashboardLoading, data?.summary],
  );

  const summary = (data?.summary ?? {}) as Record<string, number>;
  const pendingPurchaseDrafts = data?.pendingDraftInvoices ?? [];
  const pendingCountDrafts = data?.pendingDraftCountSessions ?? [];
  const pendingReorderDrafts = data?.pendingDraftReorderPlans ?? [];

  const draftCards = [
    {
      title: "Purchases",
      items: pendingPurchaseDrafts.slice(0, 3).map((invoice) => ({
        key: `purchase-${invoice.id}`,
        title: invoice.invoiceNumber,
        detail: `${invoice.supplier?.name ?? "Supplier"} · ${formatDate(invoice.invoiceDate)}`,
        badge: invoice.status,
        onClick: () => navigate(`/app/purchases?invoiceId=${invoice.id}`),
      })),
      empty: "No draft purchases waiting to continue.",
      fallback: () => navigate("/app/purchases"),
      fallbackLabel: "Open purchases",
    },
    {
      title: "Stock counts",
      items: pendingCountDrafts.slice(0, 3).map((session) => ({
        key: `count-${session.id}`,
        title: `Count #${session.id}`,
        detail: `${formatNumber(session.countedLineCount)}/${formatNumber(session.itemCount)} counted · ${formatNumber(session.varianceTotal)} variance`,
        badge: session.status,
        onClick: () => navigate(`/app/stock-counts?sessionId=${session.id}`),
      })),
      empty: "No draft stock counts waiting to continue.",
      fallback: () => navigate("/app/stock-counts"),
      fallbackLabel: "Open stock counts",
    },
    {
      title: "Reorder plans",
      items: pendingReorderDrafts.slice(0, 3).map((plan) => ({
        key: `reorder-${plan.id}`,
        title: plan.name,
        detail: `${formatNumber(plan.lineCount)} lines · ${formatNumber(plan.supplierCount)} suppliers`,
        badge: plan.status,
        onClick: () => navigate(`/app/reorder-plan?planId=${plan.id}`),
      })),
      empty: "No draft reorder plans waiting to continue.",
      fallback: () => navigate("/app/reorder-plan"),
      fallbackLabel: "Open reorder plan",
    },
  ];

  return (
    <div className="space-y-6">
      <WorkspacePageHeader
        eyebrow="Dashboard"
        title="What the owner needs to know today"
        description="Back-office control between POS and accounting, with today&apos;s work and this week&apos;s changes in one place."
        actions={
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void load()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        }
        metrics={topMetrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          helper: metric.helper,
        }))}
      />

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{error}</div>
      ) : null}
      {dashboardLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted" aria-busy="true">
          Loading dashboard data...
        </div>
      ) : null}

      <Card className="p-6">
        <SectionHeader title="Today&apos;s workflow" description="The connected loop from invoice to export readiness." />
        <div className="grid gap-3 lg:grid-cols-6">
            {[
            { label: "Invoice", icon: <ClipboardList className="h-4 w-4" />, status: data?.workflow.purchase ?? "Needs review", to: "/app/purchases" },
            { label: "Review", icon: <RefreshCcw className="h-4 w-4" />, status: data?.workflow.review ?? "Needs review", to: "/app/purchases" },
            { label: "Inventory", icon: <ShoppingCart className="h-4 w-4" />, status: data?.workflow.inventory ?? "Not ready", to: "/app/inventory" },
            { label: "Reorder", icon: <PackageSearch className="h-4 w-4" />, status: data?.workflow.reorder ?? "Alert", to: "/app/reorder-plan" },
            { label: "Close", icon: <CalendarDays className="h-4 w-4" />, status: data?.workflow.close ?? "Not ready", to: "/app/stock-counts" },
            { label: "Export", icon: <ArrowUpRight className="h-4 w-4" />, status: data?.workflow.export ?? "Not ready", to: "/app/purchases" },
          ].map((step, index, list) => (
            <button key={step.label} type="button" className="rounded-2xl border border-line bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft" onClick={() => navigate(step.to)}>
              <div className="flex items-center justify-between gap-2">
                <div className="rounded-xl bg-brand-50 p-2 text-brand-700">{step.icon}</div>
                <Badge tone={statusTone(step.status)}>{step.status}</Badge>
              </div>
              <p className="mt-3 text-sm font-bold text-ink">{step.label}</p>
              {index < list.length - 1 ? <p className="mt-1 text-xs text-muted">Connects to the next step</p> : <p className="mt-1 text-xs text-muted">Ready for bookkeeping export</p>}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader title="Continue draft work" description="These are unfinished records, not history. Reopen the exact invoice, count, or reorder draft you last touched." />
        <div className="grid gap-4 xl:grid-cols-3">
          {draftCards.map((card) => (
            <div key={card.title} className="rounded-3xl border border-brand-100 bg-brand-50/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink">{card.title}</p>
                <button className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 transition hover:text-brand-800" type="button" onClick={card.fallback}>
                  {card.fallbackLabel}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {card.items.length ? (
                  card.items.map((item) => (
                    <button key={item.key} className="flex w-full items-start justify-between gap-3 rounded-2xl border border-line bg-white px-3 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-soft" type="button" onClick={item.onClick}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                        <p className="mt-1 text-xs text-muted">{item.detail}</p>
                      </div>
                      <Badge tone={statusTone(item.badge)}>{item.badge}</Badge>
                    </button>
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-line bg-white px-3 py-4 text-sm text-muted">{card.empty}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card className="p-6">
          <SectionHeader title="This week&apos;s changes" description="The biggest shifts that affect pricing, stock, and spend." />
          <div className="space-y-3">
            {(data?.recentPriceChanges ?? []).slice(0, 5).map((change) => (
              <div key={`${String(change.id)}`} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">{String(change.itemName ?? change.item ?? "Item")}</p>
                    <p className="text-sm text-muted">{String(change.supplier ?? "")}</p>
                  </div>
                  <Badge tone={Number(change.changePercent ?? 0) >= 0 ? "orange" : "success"}>{Number(change.changePercent ?? 0) >= 0 ? "+" : ""}{formatNumber(Number(change.changePercent ?? 0))}%</Badge>
                </div>
                <p className="mt-2 text-sm text-muted">Detected on {String(change.invoiceDate ?? change.dateDetected ?? "")}</p>
              </div>
            ))}
            {!(data?.recentPriceChanges?.length) ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No price changes yet. They appear here once invoices are received.</p> : null}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Needs attention" description="Compact signals for the next 15 seconds, with reorder urgency first." />
          <div className="space-y-3">
            {attentionOrder.map(([key, label]) => {
              const value = summary[key] ?? 0;
              return (
              <div key={key} className="flex items-center justify-between rounded-2xl border border-line bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{label}</p>
                  <p className="text-xs text-muted">One tap to jump into the right workflow</p>
                </div>
                <Badge tone={statusTone(String(value))}>
                  {formatNumber(value)}
                </Badge>
              </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionHeader title="Recent activity" description="New purchases, inventory moves, and count updates." />
          <div className="space-y-3">
            {(data?.recentMovements ?? []).slice(0, 5).map((movement) => (
              <div key={movement.id} className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-ink">{movement.inventoryItemName}</p>
                  <p className="text-sm text-muted">{movement.reason}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold text-ink">{movement.quantityDelta > 0 ? "+" : ""}{formatNumber(movement.quantityDelta)} {movement.unit}</p>
                  <p className="text-muted">{formatDateTime(movement.createdAt)}</p>
                </div>
              </div>
            ))}
            {!(data?.recentMovements?.length) ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Recent activity will appear after purchases, counts, and adjustments are saved.</p> : null}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Reorder plan preview" description="The items that need attention now, from low stock through urgent reorder." />
          <div className="space-y-3">
            {(data?.reorderSuggestions ?? []).slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{item.inventoryItemName}</p>
                    <p className="text-sm text-muted">{item.supplier}</p>
                  </div>
                  <Badge tone={statusTone(item.stockStatus)}>{item.stockStatus}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Current</p>
                    <p className="mt-1 text-ink">{formatNumber(item.currentQuantity)} {item.unit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Suggest</p>
                    <p className="mt-1 text-ink">{formatNumber(item.suggestedQuantity)} {item.unit}</p>
                  </div>
                </div>
              </div>
            ))}
            {!(data?.reorderSuggestions?.length) ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Reorder suggestions appear once items fall below PAR or minimum.</p> : null}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader title="Supplier spend" description="Who drove this month&apos;s purchasing so far." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data?.supplierSpend ?? []).slice(0, 6).map((supplier) => (
            <div key={String(supplier.supplier ?? supplier.id)} className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="font-semibold text-ink">{String(supplier.supplier ?? "Supplier")}</p>
              <p className="mt-1 text-sm text-muted">{String(supplier.invoiceCount ?? supplier.invoices ?? 0)} invoices this month</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xl font-bold text-ink">{formatMoney(Number(supplier.spend ?? 0))}</p>
                <Badge tone={Number(supplier.change ?? 0) >= 0 ? "warning" : "success"}>
                  {Number(supplier.change ?? 0) >= 0 ? "+" : ""}{formatNumber(Number(supplier.change ?? 0))}%
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
