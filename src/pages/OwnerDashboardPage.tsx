import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  FileText,
  Gauge,
  Package,
  Sparkles,
  X,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";
import type { DemoProfileSlug } from "../data/demoProfiles";
import { buildOwnerDashboardModel } from "../lib/ownerDashboard";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import { buildDemoWalkthroughSteps, buildExportReadinessModel, getDemoCommandCenterSnapshot } from "../lib/demoReadiness";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

const actionLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50";

type CommandCenterWorkflowStep = {
  title: string;
  detail: string;
  status: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  to: string;
};

type CommandCenterActivity = {
  kind: "purchase" | "inventory" | "price" | "count" | "schedule" | "close";
  title: string;
  detail: string;
  when: string;
  to: string;
};

type WalkthroughStep = {
  title: string;
  detail: string;
  to: string;
  ctaLabel: string;
};

function dateMillis(value: string | undefined | null) {
  const millis = value ? new Date(value).getTime() : 0;
  return Number.isFinite(millis) ? millis : 0;
}

function weekLabel(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `Week of ${formatter.format(date)}`;
}

function formatWhen(value: string) {
  const millis = dateMillis(value);
  return millis > 0 ? formatDate(new Date(millis).toISOString().slice(0, 10)) : "Today";
}

function iconForActivity(kind: CommandCenterActivity["kind"]) {
  switch (kind) {
    case "purchase":
      return <FileText className="h-4 w-4" />;
    case "inventory":
      return <Package className="h-4 w-4" />;
    case "price":
      return <TrendingUp className="h-4 w-4" />;
    case "count":
      return <Gauge className="h-4 w-4" />;
    case "schedule":
      return <CalendarDays className="h-4 w-4" />;
    case "close":
      return <CalendarClock className="h-4 w-4" />;
  }
}

function toneForStatus(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "Ready" || status === "Balanced" || status === "Done" || status === "Clear" || status === "Updated") {
    return "success";
  }
  if (status === "Blocked" || status === "Needs review" || status === "Attention" || status === "Not ready" || status === "Incomplete" || status === "Alert") {
    return "warning";
  }
  if (status === "Overdue" || status === "Issue") {
    return "danger";
  }
  return "info";
}

export function OwnerDashboardPage() {
  const demo = useDemoProfile();
  const profileSlug = (demo.slug || defaultDemoProfileSlug) as DemoProfileSlug;
  const [demoFlowOpen, setDemoFlowOpen] = useState(false);
  const walkthroughStorageKey = `flowtally.demoFlow.${profileSlug}`;
  const {
    recentInvoices,
    reviewQueue,
    priceChanges,
    unresolvedReconciliations,
    inventoryItems,
    inventoryReorderIntents,
    inventoryReceipts,
    inventoryCountSessions,
    inventoryMovements,
    reconciliations,
    summary,
    resetWorkspace,
  } = usePilotWorkspace();
  const walkthroughSteps = useMemo(() => buildDemoWalkthroughSteps(profileSlug), [profileSlug]);
  const [walkthroughProgress, setWalkthroughProgress] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedValue = Number(window.localStorage.getItem(walkthroughStorageKey));
    setWalkthroughProgress(Number.isFinite(storedValue) ? Math.max(0, Math.min(storedValue, walkthroughSteps.length)) : 0);
  }, [walkthroughStorageKey, walkthroughSteps.length]);

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

  const commandCenter = getDemoCommandCenterSnapshot(profileSlug);
  const purchasesRoute = buildDemoPath(profileSlug, "purchases");
  const inventoryRoute = buildDemoPath(profileSlug, "inventory");
  const scheduleRoute = buildDemoPath(profileSlug, "schedule");
  const closeReportsRoute = buildDemoPath(profileSlug, "close-reports");
  const exportReadiness = useMemo(
    () =>
      buildExportReadinessModel({
        invoices: recentInvoices,
        inventoryReceipts,
        reconciliations,
        summary,
      }),
    [inventoryReceipts, recentInvoices, reconciliations, summary],
  );
  const exportReady = exportReadiness.monthlyOwnerReport === "Ready";
  const heroDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }).format(new Date());
  const weekComparison = useMemo(() => {
    const now = new Date();
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - 7);
    const previousWeekStart = new Date(now);
    previousWeekStart.setDate(now.getDate() - 14);

    const totals = recentInvoices.reduce(
      (acc, invoice) => {
        const millis = new Date(invoice.invoiceDate || "").getTime();
        if (!Number.isFinite(millis)) {
          return acc;
        }
        if (millis >= currentWeekStart.getTime()) {
          acc.current += Number.isFinite(invoice.totalAmount) ? invoice.totalAmount : 0;
        } else if (millis >= previousWeekStart.getTime()) {
          acc.previous += Number.isFinite(invoice.totalAmount) ? invoice.totalAmount : 0;
        }
        return acc;
      },
      { current: 0, previous: 0 },
    );

    if (totals.previous <= 0) {
      return null;
    }

    const deltaPercent = ((totals.current - totals.previous) / totals.previous) * 100;
    return {
      current: totals.current,
      previous: totals.previous,
      deltaPercent: Number(deltaPercent.toFixed(1)),
    };
  }, [recentInvoices]);
  const currentWalkthroughIndex = Math.min(walkthroughProgress, Math.max(0, walkthroughSteps.length - 1));
  const heroFlowLabel = walkthroughProgress > 0 ? "Resume walkthrough" : "View demo flow";

  const saveWalkthroughProgress = (nextProgress: number) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(walkthroughStorageKey, String(nextProgress));
    }
    setWalkthroughProgress(nextProgress);
  };

  const advanceWalkthroughProgress = (stepIndex: number) => {
    setWalkthroughProgress((current) => {
      const nextProgress = Math.min(walkthroughSteps.length, Math.max(current, stepIndex + 1));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(walkthroughStorageKey, String(nextProgress));
      }
      return nextProgress;
    });
  };

  const restartWalkthrough = () => {
    saveWalkthroughProgress(0);
  };

  const workflowSteps = useMemo<CommandCenterWorkflowStep[]>(() => {
    const hasInvoices = recentInvoices.length > 0;
    const needsReview = summary.invoiceReviewQueueCount > 0;
    const hasInventoryReceipts = summary.inventoryReceiptCount > 0;
    const needsReorder = summary.inventoryItemsToReorderCount > 0;
    const closeStatus = summary.todayReconciliationStatus;
    const closeNeedsReview = closeStatus === "Needs Review";
    const closeDone = closeStatus === "Balanced";

    return [
      {
        title: "Invoice",
        detail: hasInvoices ? `${recentInvoices[0].supplier} is the latest saved purchase.` : "Upload the first invoice or receipt.",
        status: hasInvoices ? "Done" : "Not ready",
        tone: hasInvoices ? "success" : "warning",
        to: purchasesRoute,
      },
      {
        title: "Review + match",
        detail: needsReview ? `${summary.invoiceReviewQueueCount} invoices still need confirmation.` : "Matched items are ready for the inventory update.",
        status: needsReview ? "Needs review" : "Done",
        tone: needsReview ? "warning" : "success",
        to: purchasesRoute,
      },
      {
        title: "Inventory",
        detail: hasInventoryReceipts ? `${summary.inventoryReceiptCount} receipts are stored locally.` : "Inventory updates once confirmed matches are saved.",
        status: hasInventoryReceipts ? "Updated" : "Incomplete",
        tone: hasInventoryReceipts ? "success" : "warning",
        to: inventoryRoute,
      },
      {
        title: "Reorder check",
        detail: needsReorder ? `${summary.inventoryItemsToReorderCount} items need ordering.` : "No reorder action needed right now.",
        status: needsReorder ? "Alert" : "Done",
        tone: needsReorder ? "warning" : "success",
        to: inventoryRoute,
      },
      {
        title: "Close",
        detail: closeStatus === "Incomplete" ? "Enter the day's totals and compare to POS." : `Today is ${closeStatus.toLowerCase()} with variance ${formatCurrency(summary.todayReconciliationVariance)}.`,
        status: closeStatus === "Incomplete" ? "Incomplete" : closeNeedsReview ? "Needs review" : closeDone ? "Done" : closeStatus,
        tone: closeStatus === "Incomplete" ? "warning" : closeNeedsReview ? "warning" : closeDone ? "success" : toneForStatus(closeStatus),
        to: closeReportsRoute,
      },
    ];
  }, [
    closeReportsRoute,
    inventoryRoute,
    purchasesRoute,
    recentInvoices,
    summary.inventoryItemsToReorderCount,
    summary.inventoryReceiptCount,
    summary.invoiceReviewQueueCount,
    summary.todayReconciliationStatus,
    summary.todayReconciliationVariance,
  ]);

  const activityFeed = useMemo<CommandCenterActivity[]>(() => {
    const feed: CommandCenterActivity[] = [];

    const latestInvoice = recentInvoices[0];
    if (latestInvoice) {
      feed.push({
        kind: "purchase",
        title: "Invoice saved",
        detail: `${latestInvoice.supplier} - ${latestInvoice.invoiceNumber} - ${formatCurrency(latestInvoice.totalAmount)}`,
        when: latestInvoice.savedAt || latestInvoice.updatedAt || latestInvoice.createdAt,
        to: purchasesRoute,
      });
    }

    const latestReceipt = [...inventoryReceipts].sort((a, b) => dateMillis(b.updatedAt || b.createdAt) - dateMillis(a.updatedAt || a.createdAt))[0];
    if (latestReceipt) {
      feed.push({
        kind: "inventory",
        title: "Item received",
        detail: `${latestReceipt.inventoryItemName} linked from ${latestReceipt.invoiceNumber}`,
        when: latestReceipt.updatedAt || latestReceipt.createdAt,
        to: inventoryRoute,
      });
    }

    const latestPriceChange = priceChanges[0];
    if (latestPriceChange) {
      feed.push({
        kind: "price",
        title: "Price changed",
        detail: `${latestPriceChange.itemName} moved from ${formatCurrency(latestPriceChange.previousPrice)} to ${formatCurrency(latestPriceChange.currentPrice)} (${formatPercent(latestPriceChange.changePercent)})`,
        when: latestPriceChange.invoiceDate,
        to: purchasesRoute,
      });
    }

    const latestCountSession = [...inventoryCountSessions].sort((a, b) => dateMillis(b.updatedAt || b.createdAt) - dateMillis(a.updatedAt || a.createdAt))[0];
    if (latestCountSession) {
      feed.push({
        kind: "count",
        title: "Stock counted",
        detail: `${latestCountSession.itemCount} items in ${latestCountSession.status.toLowerCase()} status`,
        when: latestCountSession.updatedAt || latestCountSession.createdAt,
        to: inventoryRoute,
      });
    } else if (inventoryMovements.length > 0) {
      const latestMovement = inventoryMovements[0];
      feed.push({
        kind: "count",
        title: "Stock movement logged",
        detail: `${latestMovement.inventoryItemName} - ${latestMovement.movementType}`,
        when: latestMovement.updatedAt || latestMovement.createdAt,
        to: inventoryRoute,
      });
    }

    feed.push({
      kind: "schedule",
      title: "Schedule generated",
      detail: `${commandCenter.schedule.staffCount} staff - ${commandCenter.schedule.openShifts} open shifts - ${commandCenter.schedule.conflicts} conflict${commandCenter.schedule.conflicts === 1 ? "" : "s"}`,
      when: heroDate,
      to: scheduleRoute,
    });

    const latestReconciliation = [...reconciliations].sort((a, b) => dateMillis(b.savedAt || b.updatedAt || b.createdAt) - dateMillis(a.savedAt || a.updatedAt || a.createdAt))[0];
    if (latestReconciliation) {
      feed.push({
        kind: "close",
        title: "Daily close saved",
        detail: `${formatDate(latestReconciliation.date)} - ${latestReconciliation.status} - variance ${formatCurrency(latestReconciliation.variance)}`,
        when: latestReconciliation.savedAt || latestReconciliation.updatedAt || latestReconciliation.createdAt,
        to: closeReportsRoute,
      });
    } else if (summary.todayReconciliationStatus !== "Incomplete") {
      feed.push({
        kind: "close",
        title: "Daily close saved",
        detail: `${summary.todayReconciliationStatus} - variance ${formatCurrency(summary.todayReconciliationVariance)}`,
        when: summary.todayReconciliationDate,
        to: closeReportsRoute,
      });
    }

    return feed.slice(0, 6);
  }, [
    closeReportsRoute,
    commandCenter.schedule.conflicts,
    commandCenter.schedule.openShifts,
    commandCenter.schedule.staffCount,
    heroDate,
    inventoryCountSessions,
    inventoryMovements,
    inventoryReceipts,
    priceChanges,
    purchasesRoute,
    reconciliations,
    scheduleRoute,
    summary.todayReconciliationDate,
    summary.todayReconciliationStatus,
    summary.todayReconciliationVariance,
  ]);

  const topSupplier = dashboard.supplierSpend[0];
  const topIncrease = dashboard.costChanges.find((change) => change.status === "Increased");
  const topDecrease = dashboard.costChanges.find((change) => change.status === "Decreased");
  const lowStockItem = dashboard.reorderSuggestions[0];
  const fastestUsageItem = [...inventoryItems]
    .filter((item) => typeof item.averageDailyUsage === "number" && item.averageDailyUsage > 0)
    .sort((a, b) => (b.averageDailyUsage ?? 0) - (a.averageDailyUsage ?? 0) || a.name.localeCompare(b.name))[0];
  const changedPriceChips = dashboard.costChanges.slice(0, 3);
  const insightCards = [
    {
      title: "Largest supplier spend",
      value: topSupplier ? topSupplier.supplier : "No supplier yet",
      detail: topSupplier ? `${formatCurrency(topSupplier.spend)} across ${topSupplier.invoiceCount} invoices` : "Upload a purchase to see supplier spend.",
      tone: topSupplier ? "neutral" : "info",
    },
    {
      title: "Top price increase",
      value: topIncrease ? `${topIncrease.itemName} ${formatPercent(topIncrease.changePercent)}` : "No increases yet",
      detail: topIncrease ? `${topIncrease.supplier} · ${formatCurrency(topIncrease.previousUnitPrice)} → ${formatCurrency(topIncrease.currentUnitPrice)}` : "Price increases will appear here once purchases are saved.",
      tone: topIncrease ? "warning" : "success",
    },
    {
      title: "Biggest price decrease",
      value: topDecrease ? `${topDecrease.itemName} ${formatPercent(topDecrease.changePercent)}` : "No decreases yet",
      detail: topDecrease ? `${topDecrease.supplier} · ${formatCurrency(topDecrease.previousUnitPrice)} → ${formatCurrency(topDecrease.currentUnitPrice)}` : "Price decreases will appear here once they are detected.",
      tone: topDecrease ? "success" : "info",
    },
    {
      title: "Inventory running low",
      value: lowStockItem ? lowStockItem.itemName : "Inventory healthy",
      detail: lowStockItem
        ? `${Math.max(0, Math.round(lowStockItem.estimatedDaysRemaining ?? 0))} days left · ${fastestUsageItem ? `Fastest mover: ${fastestUsageItem.name}` : "Usage not configured"}`
        : fastestUsageItem
          ? `Fastest mover: ${fastestUsageItem.name} at ${fastestUsageItem.averageDailyUsage?.toFixed(1)} / day`
          : "No reorder pressure right now.",
      tone: lowStockItem ? "warning" : "success",
    },
  ] as const;


  return (
    <PageLayout title="Dashboard" description="Back-office control between POS and QuickBooks.">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{demo.customization.restaurantName}</Badge>
              <Badge tone="neutral">{weekLabel()}</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Back-office control between POS and QuickBooks.</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" to={purchasesRoute}>
              Upload purchase
            </Link>
            <Button type="button" variant="secondary" onClick={() => setDemoFlowOpen(true)} icon={<Sparkles className="h-4 w-4" />}>
              {heroFlowLabel}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link className="font-semibold text-ink underline decoration-slate-300 decoration-1 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500" to={inventoryRoute}>
            Start stock count
          </Link>
          <Link className="font-semibold text-ink underline decoration-slate-300 decoration-1 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500" to={closeReportsRoute}>
            Enter daily close
          </Link>
          <Link className="font-semibold text-ink underline decoration-slate-300 decoration-1 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500" to={closeReportsRoute}>
            Open export
          </Link>
        </div>
      </Card>

      <section className="mt-7">
        <SectionHeader title="Numbers to know" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Purchases this week" value={String(summary.weeklyInvoiceCount)} helper={summary.weeklyInvoiceCount > 0 ? formatCurrency(summary.weeklyInvoiceSpend) : "No purchases yet"} icon={<FileText className="h-5 w-5" />} />
          <StatCard label="Total purchasing spend" value={formatCurrency(summary.weeklyInvoiceSpend)} helper="Week to date on saved purchases" icon={<TrendingUp className="h-5 w-5" />} />
          <StatCard
            label="Spend vs last week"
            value={weekComparison ? `${weekComparison.deltaPercent > 0 ? "+" : ""}${formatPercent(weekComparison.deltaPercent)}` : "-"}
            helper={weekComparison ? `Last 7 days ${formatCurrency(weekComparison.current)} vs prior ${formatCurrency(weekComparison.previous)}` : "Need two weeks of invoices"}
            icon={<Gauge className="h-5 w-5" />}
          />
          <StatCard label="Inventory value" value={formatCurrency(summary.inventoryValue)} helper={summary.inventoryItemCount > 0 ? `${summary.inventoryItemCount} items tracked` : "No inventory yet"} icon={<Package className="h-5 w-5" />} />
          <StatCard label="Supplier price increases" value={String(dashboard.priceIncreaseCount)} helper={dashboard.priceIncreaseCount > 0 ? "Check the biggest changes" : "No supplier price increases"} icon={<AlertTriangle className="h-5 w-5" />} />
          <StatCard label="Items needing reorder" value={String(summary.inventoryItemsToReorderCount)} helper={summary.inventoryItemsToReorderCount > 0 ? `${summary.inventoryReorderNowCount} need reorder now` : "No reorder action"} icon={<TrendingUp className="h-5 w-5" />} />
        </div>
      </section>

      <section className="mt-7">
        <SectionHeader title="This week's changes" />
        <Card className="p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {insightCards.map((card) => (
              <div key={card.title} className="rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{card.title}</p>
                <p className="mt-2 text-base font-bold text-ink">{card.value}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{card.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Products that changed price</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {changedPriceChips.length > 0 ? (
                changedPriceChips.map((change) => (
                  <Badge key={`${change.itemName}-${change.invoiceDate}`} tone={change.status === "Increased" ? "warning" : change.status === "Decreased" ? "success" : "neutral"}>
                    {change.itemName} {formatPercent(change.changePercent)}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted">No price changes yet.</span>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-7">
        <SectionHeader title="Today's workflow" />
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:justify-between">
            {workflowSteps.map((step, index) => (
              <div key={step.title} className="relative flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-line bg-slate-50 px-4 py-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-ink shadow-sm">{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{step.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{step.detail}</p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <Badge tone={step.tone}>{step.status}</Badge>
                  <Link className="text-xs font-semibold uppercase tracking-wide text-brand-700 hover:text-brand-800" to={step.to}>
                    Open
                  </Link>
                </div>
                {index < workflowSteps.length - 1 ? <div className="hidden xl:block absolute right-[-14px] top-1/2 -translate-y-1/2 text-slate-300">-&gt;</div> : null}
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-7">
        <SectionHeader title="Recent activity" />
        {activityFeed.length > 0 ? (
          <Card className="p-4 sm:p-5">
            <div className="space-y-2">
              {activityFeed.slice(0, 5).map((item) => (
                <Link
                  key={`${item.kind}-${item.title}-${item.when}`}
                  className="flex flex-col gap-3 rounded-xl border border-line bg-slate-50 p-3 transition hover:bg-slate-100 sm:flex-row sm:items-center sm:justify-between"
                  to={item.to}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-white p-2 text-ink shadow-sm">{iconForActivity(item.kind)}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{item.detail}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{formatWhen(item.when)}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">Open</span>
                </Link>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <p className="text-sm font-semibold text-ink">No activity yet.</p>
            <p className="mt-1 text-sm leading-6 text-muted">Upload a purchase or enter the first close to start the feed.</p>
          </Card>
        )}
      </section>

      <section className="mt-7">
        <SectionHeader title="Bookkeeping-ready export" />
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={exportReady ? "success" : "warning"}>{exportReady ? "Ready" : "Not ready"}</Badge>
            <Badge tone="neutral">{exportReadiness.blockers.length} blockers</Badge>
            <Badge tone="info">QuickBooks future-only</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <TinyMetric label="Purchase CSV" value={exportReadiness.purchaseCsv} helper="Bookkeeping-ready records only" />
            <TinyMetric label="Supplier spend" value={exportReadiness.supplierSpendSummary} helper="Ready when purchases are reviewed" />
            <TinyMetric label="Inventory summary" value={exportReadiness.inventoryMovementSummary} helper="Receipts and movements are captured locally" />
            <TinyMetric label="Daily close" value={exportReadiness.dailyCloseSummary} helper={summary.todayReconciliationStatus === "Incomplete" ? "Needs entry" : formatCurrency(summary.todayReconciliationVariance)} />
          </div>
          <div className="mt-4 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm leading-6 text-muted">
            Weekly and monthly handoff stays compact. Blockers: {exportReadiness.blockers.join(" | ")}. QuickBooks remains future-only.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" to={closeReportsRoute}>
              Open Close &amp; Reports
            </Link>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" onClick={resetWorkspace}>
              Reset demo
            </button>
          </div>
        </Card>
      </section>
      <DemoFlowDrawer
        open={demoFlowOpen}
        steps={walkthroughSteps}
        activeStepIndex={currentWalkthroughIndex}
        progress={walkthroughProgress}
        onAdvanceStep={advanceWalkthroughProgress}
        onRestart={restartWalkthrough}
        onClose={() => setDemoFlowOpen(false)}
      />
    </PageLayout>
  );
}

function TinyMetric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-lg font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{helper}</p>
    </div>
  );
}

function DemoFlowDrawer({
  open,
  steps,
  activeStepIndex,
  progress,
  onAdvanceStep,
  onRestart,
  onClose,
}: {
  open: boolean;
  steps: WalkthroughStep[];
  activeStepIndex: number;
  progress: number;
  onAdvanceStep: (stepIndex: number) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Demo flow</p>
            <h2 className="mt-1 text-lg font-bold text-ink sm:text-xl">Walk through the restaurant story</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Step {Math.min(progress + 1, steps.length)} of {steps.length}. Resume where you left off or jump directly to a page.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button type="button" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose}>
              Close
            </Button>
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              to={steps[Math.min(activeStepIndex, steps.length - 1)]?.to ?? "#"}
              onClick={() => onAdvanceStep(activeStepIndex)}
            >
              {progress > 0 ? "Resume walkthrough" : "Start walkthrough"}
            </Link>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" onClick={onRestart}>
              Start over
            </button>
            <span className="text-sm text-muted">Current step is highlighted below.</span>
          </div>
          <div className="space-y-2">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className={`rounded-2xl border p-4 ${
                  index === activeStepIndex
                    ? "border-brand-200 bg-brand-50 shadow-sm"
                    : index < activeStepIndex
                      ? "border-brand-100 bg-white"
                      : "border-line bg-white"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Step {index + 1}</p>
                      {index === activeStepIndex ? <Badge tone="info">Current step</Badge> : null}
                      {index < activeStepIndex ? <Badge tone="success">Completed</Badge> : null}
                      {index > activeStepIndex ? <Badge tone="neutral">Next</Badge> : null}
                    </div>
                    <p className="mt-1 text-base font-bold text-ink">{step.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{step.detail}</p>
                  </div>
                  <Link className={actionLinkClass} to={step.to} onClick={() => onAdvanceStep(index)}>
                    {step.ctaLabel}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

