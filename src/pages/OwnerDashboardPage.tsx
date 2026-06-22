import { AlertTriangle, CalendarClock, FileText, Gauge, Sparkles, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";
import { buildOwnerDashboardModel } from "../lib/ownerDashboard";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

const actionLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50";

export function OwnerDashboardPage() {
  const demo = useDemoProfile();
  const {
    recentInvoices,
    reviewQueue,
    priceChanges,
    unresolvedReconciliations,
    inventoryItems,
    inventoryReorderIntents,
    inventoryReceipts,
    summary,
    resetWorkspace,
  } = usePilotWorkspace();

  const dashboard = useMemo(
    () =>
      buildOwnerDashboardModel({
        invoices: recentInvoices,
        reviewQueue,
        priceChanges,
        unresolvedReconciliations,
        inventoryItems,
        inventoryReorderIntents,
        inventoryReceipts,
        summary,
      }),
    [
      inventoryItems,
      inventoryReceipts,
      inventoryReorderIntents,
      priceChanges,
      recentInvoices,
      reviewQueue,
      unresolvedReconciliations,
      summary,
    ],
  );

  const profileSlug = (demo.slug || defaultDemoProfileSlug) as Parameters<typeof buildDemoPath>[0];
  const openInvoices = buildDemoPath(profileSlug, "invoices");
  const openInventory = buildDemoPath(profileSlug, "inventory");
  const dailyClose = buildDemoPath(profileSlug, "daily-reconciliation");

  const handleRestoreSampleData = () => {
    if (typeof window !== "undefined" && window.confirm("Restore the seeded sample restaurant data in this browser?")) {
      resetWorkspace();
    }
  };

  return (
    <PageLayout
      title={demo.copy.dashboard.title}
      eyebrow={demo.copy.dashboard.eyebrow}
      description={demo.copy.dashboard.description}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboard.cards.map((card) => {
          const icon =
            card.label === "Month-to-date spend" ? (
              <Gauge className="h-5 w-5" />
            ) : card.label === "Supplier spend" ? (
              <FileText className="h-5 w-5" />
            ) : card.label === "Price increases" ? (
              <TrendingUp className="h-5 w-5" />
            ) : card.label === "Invoices needing action" ? (
              <AlertTriangle className="h-5 w-5" />
            ) : card.label === "Inventory alerts" ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CalendarClock className="h-5 w-5" />
            );

          return (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              helper={card.helper}
              icon={icon}
            />
          );
        })}
      </div>

      <Card className="mt-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Start here</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink">See cost changes and actions first.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Then open invoices or inventory for details. This browser keeps the sample restaurant data locally so the owner view stays instant.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={actionLinkClass} to={openInvoices}>
              Open invoices
            </Link>
            <Link className={actionLinkClass} to={openInvoices}>
              Review price changes
            </Link>
            <Link className={actionLinkClass} to={openInventory}>
              Open inventory
            </Link>
            <Link className={actionLinkClass} to={dailyClose}>
              View daily close
            </Link>
            <Button type="button" variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={handleRestoreSampleData}>
              Load sample restaurant data
            </Button>
          </div>
        </div>
      </Card>

      <section className="mt-8">
        <SectionHeader
          title="Needs attention"
          description="The fastest actions an owner can clear before the next shift."
        />
        {dashboard.needsAttention.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {dashboard.needsAttention.map((item) => (
              <Card key={item.title} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Badge tone={item.tone}>{item.title}</Badge>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{item.detail}</p>
                  </div>
                  <Link className="shrink-0 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={item.to}>
                    {item.ctaLabel}
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyStateCard
            actionLabel="Load sample restaurant data"
            actionOnClick={handleRestoreSampleData}
            description="No open dashboard actions yet. Load sample restaurant data or upload an invoice to surface cost changes and reorder items."
            title="No current action items"
          />
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Spend by supplier"
          description="Suppliers with the biggest spend are shown first, using saved invoice totals from this browser."
          action={
            <Link className={actionLinkClass} to={openInvoices}>
              Open invoices
            </Link>
          }
        />
        {dashboard.supplierSpend.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.supplierSpend.map((row) => (
              <Card key={row.supplier} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-ink">{row.supplier}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {row.invoiceCount} invoices - {row.latestInvoiceDate ? formatDate(row.latestInvoiceDate) : "-"}
                    </p>
                  </div>
                  <Badge tone="info">{row.share.toFixed(1)}%</Badge>
                </div>
                <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">{formatCurrency(row.spend)}</p>
                <p className="mt-1 text-sm leading-6 text-muted">Share of supplier spend in the saved invoices.</p>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyStateCard
            actionLabel="Open invoices"
            actionHref={openInvoices}
            description="Upload or load a sample invoice to see supplier spend grouped automatically."
            title="No supplier spend yet"
          />
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Cost changes to review"
          description="Meaningful supplier price moves are shown here, including decreases as useful context."
          action={
            <Link className={actionLinkClass} to={openInvoices}>
              Review price changes
            </Link>
          }
        />
        {dashboard.costChanges.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.costChanges.map((row) => {
              const badgeTone = row.status === "Increased" ? "danger" : row.status === "Decreased" ? "success" : "neutral";
              const badgeLabel = row.status === "Increased" ? "Price increased" : row.status === "Decreased" ? "Price decreased" : "No change";
              const changeAmount = formatCurrency(Math.abs(row.deltaAmount));
              const changePrefix = row.deltaAmount > 0 ? "+" : row.deltaAmount < 0 ? "-" : "";

              return (
              <Card key={`${row.itemName}-${row.invoiceDate}-${row.supplier}`} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink">{row.itemName}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">{row.supplier}</p>
                  </div>
                  <Badge tone={badgeTone}>{badgeLabel}</Badge>
                </div>
                <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">
                  <p>
                    Previous: <span className="font-semibold text-ink">{formatCurrency(row.previousUnitPrice)}</span>
                  </p>
                  <p>
                    Current: <span className="font-semibold text-ink">{formatCurrency(row.currentUnitPrice)}</span>
                  </p>
                  <p>
                    Change: <span className="font-semibold text-ink">{changePrefix}{changeAmount}</span>
                  </p>
                  <p>
                    Movement: <span className="font-semibold text-ink">{formatPercent(row.changePercent)}</span>
                  </p>
                  <p>
                    Invoice date: <span className="font-semibold text-ink">{row.invoiceDate ? formatDate(row.invoiceDate) : "-"}</span>
                  </p>
                  <p>
                    Prior date: <span className="font-semibold text-ink">{row.previousInvoiceDate ? formatDate(row.previousInvoiceDate) : "-"}</span>
                  </p>
                </div>
              </Card>
              );
            })}
          </div>
        ) : (
          <EmptyStateCard
            actionLabel="Open invoices"
            actionHref={openInvoices}
            description="Load sample restaurant data to see supplier price changes."
            title="No supplier price changes detected yet"
          />
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Top purchased items"
          description="The items below are grouped by matching key so the owner can see where the budget is going."
          action={
            <Link className={actionLinkClass} to={openInventory}>
              Open inventory
            </Link>
          }
        />
        {dashboard.topItems.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.topItems.map((row) => (
              <Card key={`${row.itemName}-${row.latestInvoiceDate}`} className="p-5">
                <p className="text-base font-bold text-ink">{row.itemName}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{row.supplierLabel}</p>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">Recent price movement</p>
                {row.priceMovement ? (
                  <div className="mt-2">
                    <Badge tone={row.priceMovement === "Increased" ? "warning" : row.priceMovement === "Decreased" ? "success" : "neutral"}>
                      {row.priceMovement === "Increased" ? "Up" : row.priceMovement === "Decreased" ? "Down" : "Unchanged"}
                    </Badge>
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-muted">No prior comparison</p>
                )}
                <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">
                  <p>
                    Total spend: <span className="font-semibold text-ink">{formatCurrency(row.totalSpend)}</span>
                  </p>
                  <p>
                    Quantity purchased: <span className="font-semibold text-ink">{Number.isFinite(row.quantity) ? row.quantity.toFixed(2).replace(/\.00$/, "") : "-"}</span>
                  </p>
                  <p>
                    Latest unit price: <span className="font-semibold text-ink">{formatCurrency(row.latestUnitPrice)}</span>
                  </p>
                  <p>
                    Latest invoice: <span className="font-semibold text-ink">{row.latestInvoiceDate ? formatDate(row.latestInvoiceDate) : "-"}</span>
                  </p>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyStateCard
            actionLabel="Open invoices"
            actionHref={openInvoices}
            description="Upload or load a sample invoice to see top purchased items appear here."
            title="No purchased items yet"
          />
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Inventory / reorder snapshot"
          description="Low-stock and reorder-needed items stay visible without leaving the owner dashboard."
          action={
            <Link className={actionLinkClass} to={openInventory}>
              Open inventory
            </Link>
          }
        />
        {dashboard.reorderSuggestions.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.reorderSuggestions.slice(0, 6).map((item) => (
              <Card key={item.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-ink">{item.itemName}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">{item.supplier}</p>
                  </div>
                  <Badge tone={item.stockStatus === "Out of stock" || item.stockStatus === "Reorder now" ? "danger" : "warning"}>{item.stockStatus}</Badge>
                </div>
                <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">
                  <p>
                    On hand: <span className="font-semibold text-ink">{item.currentQuantity} {item.unit}</span>
                  </p>
                  <p>
                    Suggested order: <span className="font-semibold text-ink">{item.suggestedQuantity} {item.unit}</span>
                  </p>
                  <p>
                    Estimated cost:{" "}
                    <span className="font-semibold text-ink">
                      {item.estimatedCost === null ? "Not priced yet" : formatCurrency(item.estimatedCost)}
                    </span>
                  </p>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyStateCard
            actionLabel="Open inventory"
            actionHref={openInventory}
            description="No reorder alerts yet. Load sample data or record a count to surface a reorder snapshot."
            title="No reorder alerts"
          />
        )}
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Daily close snapshot"
          description="A secondary view of the unresolved daily reconciliation records."
          action={
            <Link className={actionLinkClass} to={dailyClose}>
              View daily close
            </Link>
          }
        />
        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Today</p>
              <p className="mt-2 text-2xl font-bold text-ink">{dashboard.dailyCloseStatus}</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                {dashboard.dailyCloseStatus === "Incomplete"
                  ? "No close saved for today yet."
                  : `Variance ${formatCurrency(dashboard.dailyCloseVariance)} on ${dashboard.dailyCloseDate ? formatDate(dashboard.dailyCloseDate) : "-"}.`}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Unresolved variance</p>
              <p className="mt-2 text-2xl font-bold text-ink">{formatCurrency(summary.weeklyUnresolvedVariance)}</p>
              <p className="mt-2 text-sm leading-6 text-muted">Weekly exposure that still needs a review.</p>
            </div>
            <div className="rounded-xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Recent unresolved days</p>
              <p className="mt-2 text-2xl font-bold text-ink">{dashboard.unresolvedDailyCloseCount}</p>
              <p className="mt-2 text-sm leading-6 text-muted">These entries remain open until balanced or reviewed.</p>
            </div>
          </div>

          {unresolvedReconciliations.length > 0 ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {unresolvedReconciliations.slice(0, 3).map((record) => (
                <div key={record.id} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-ink">{record.date ? formatDate(record.date) : "Unknown date"}</p>
                      <p className="mt-1 text-sm leading-6 text-muted">{record.notes || "Needs review"}</p>
                    </div>
                    <Badge tone={record.status === "Balanced" ? "success" : "warning"}>{record.status}</Badge>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-700">
                    Variance: <span className="font-semibold text-ink">{formatCurrency(record.variance)}</span>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted">No unresolved daily close records yet. Open daily reconciliation to add one.</p>
          )}
        </Card>
      </section>
    </PageLayout>
  );
}

function EmptyStateCard({
  title,
  description,
  actionLabel,
  actionHref,
  actionOnClick,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionHref?: string;
  actionOnClick?: () => void;
}) {
  return (
    <Card className="p-5">
      <p className="text-base font-bold text-ink">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
      {actionHref ? (
        <Link className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={actionHref}>
          {actionLabel}
        </Link>
      ) : (
        <Button className="mt-4" type="button" variant="secondary" onClick={actionOnClick}>
          {actionLabel}
        </Button>
      )}
    </Card>
  );
}
