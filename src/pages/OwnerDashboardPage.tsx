import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  FileText,
  Gauge,
  Package,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";
import type { DemoProfileSlug } from "../data/demoProfiles";
import { buildOwnerDashboardModel } from "../lib/ownerDashboard";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

const actionLinkClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50";

type CommandCenterSnapshot = {
  menu: {
    costedItems: number;
    marginRisks: number;
    squareReady: number;
    recipeLinks: number;
  };
  schedule: {
    staffCount: number;
    openShifts: number;
    conflicts: number;
    draftStatus: string;
  };
};

const commandCenterSnapshots: Record<DemoProfileSlug, CommandCenterSnapshot> = {
  cafe: {
    menu: { costedItems: 10, marginRisks: 3, squareReady: 7, recipeLinks: 9 },
    schedule: { staffCount: 8, openShifts: 1, conflicts: 2, draftStatus: "Draft" },
  },
  "quick-service": {
    menu: { costedItems: 14, marginRisks: 4, squareReady: 9, recipeLinks: 12 },
    schedule: { staffCount: 11, openShifts: 2, conflicts: 1, draftStatus: "Draft" },
  },
  "full-service": {
    menu: { costedItems: 18, marginRisks: 5, squareReady: 12, recipeLinks: 15 },
    schedule: { staffCount: 15, openShifts: 2, conflicts: 3, draftStatus: "Draft" },
  },
};

type CommandCenterAlert = {
  title: string;
  detail: string;
  ctaLabel: string;
  to: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
};

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
  if (status === "Ready" || status === "Balanced" || status === "Done" || status === "Clear") {
    return "success";
  }
  if (status === "Blocked" || status === "Needs review" || status === "Attention" || status === "Not ready") {
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

  const commandCenter = commandCenterSnapshots[profileSlug];
  const purchasesRoute = buildDemoPath(profileSlug, "purchases");
  const inventoryRoute = buildDemoPath(profileSlug, "inventory");
  const menuCostingRoute = buildDemoPath(profileSlug, "menu-costing");
  const scheduleRoute = buildDemoPath(profileSlug, "schedule");
  const closeReportsRoute = buildDemoPath(profileSlug, "close-reports");
  const exportReady = summary.invoiceReviewQueueCount === 0 && summary.unresolvedReconciliationCount === 0;
  const heroDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }).format(new Date());

  const attentionAlerts = useMemo<CommandCenterAlert[]>(() => {
    const alerts: CommandCenterAlert[] = [];

    if (summary.invoiceReviewQueueCount > 0) {
      alerts.push({
        title: `${summary.invoiceReviewQueueCount} invoices need review`,
        detail: "Confirm OCR fields, item mapping, and save the purchases before the history is considered final.",
        ctaLabel: "Open purchases",
        to: purchasesRoute,
        tone: "warning",
      });
    }

    if (dashboard.priceIncreaseCount > 0) {
      alerts.push({
        title: `${dashboard.priceIncreaseCount} price changes to check`,
        detail: "Review the biggest supplier shifts before the next order lands.",
        ctaLabel: "Review purchases",
        to: purchasesRoute,
        tone: "danger",
      });
    }

    if (summary.inventoryItemsToReorderCount > 0 || summary.inventoryLowStockCount > 0) {
      alerts.push({
        title: `${summary.inventoryItemsToReorderCount} inventory items need attention`,
        detail: "Low-stock items and reorder suggestions are already available in Inventory.",
        ctaLabel: "Open inventory",
        to: inventoryRoute,
        tone: "warning",
      });
    }

    if (commandCenter.schedule.conflicts > 0 || commandCenter.schedule.openShifts > 0) {
      alerts.push({
        title: `${commandCenter.schedule.conflicts} schedule conflicts and ${commandCenter.schedule.openShifts} open shifts`,
        detail: "Keep staffing simple: review the draft schedule before the next service period.",
        ctaLabel: "Open schedule",
        to: scheduleRoute,
        tone: "warning",
      });
    }

    if (!exportReady || summary.unresolvedReconciliationCount > 0) {
      alerts.push({
        title: `${summary.unresolvedReconciliationCount} closes still need review`,
        detail: exportReady
          ? "The accounting-ready CSV is available in Close & Reports."
          : "Finish the daily close review before marking the export ready.",
        ctaLabel: "Open close & reports",
        to: closeReportsRoute,
        tone: exportReady ? "info" : "danger",
      });
    }

    return alerts.slice(0, 5);
  }, [
    closeReportsRoute,
    commandCenter.schedule.conflicts,
    commandCenter.schedule.openShifts,
    dashboard.priceIncreaseCount,
    exportReady,
    inventoryRoute,
    purchasesRoute,
    scheduleRoute,
    summary.inventoryItemsToReorderCount,
    summary.inventoryLowStockCount,
    summary.invoiceReviewQueueCount,
    summary.unresolvedReconciliationCount,
  ]);

  const workflowSteps = useMemo<CommandCenterWorkflowStep[]>(() => {
    return [
      {
        title: "Purchase uploaded",
        detail: recentInvoices.length > 0 ? `${recentInvoices[0].supplier} is the latest saved record.` : "Upload the first invoice or receipt.",
        status: recentInvoices.length > 0 ? "Done" : "Next",
        tone: recentInvoices.length > 0 ? "success" : "info",
        to: purchasesRoute,
      },
      {
        title: "Review / map",
        detail: summary.invoiceReviewQueueCount > 0 ? `${summary.invoiceReviewQueueCount} invoices still need confirmation.` : "Purchase review queue is clear.",
        status: summary.invoiceReviewQueueCount > 0 ? "Needs review" : "Clear",
        tone: summary.invoiceReviewQueueCount > 0 ? "warning" : "success",
        to: purchasesRoute,
      },
      {
        title: "Receive inventory",
        detail: summary.inventoryReceiptCount > 0 ? `${summary.inventoryReceiptCount} receipts are stored locally.` : "Receive items from the latest purchase.",
        status: summary.inventoryReceiptCount > 0 ? "Tracked" : "Pending",
        tone: summary.inventoryReceiptCount > 0 ? "success" : "info",
        to: inventoryRoute,
      },
      {
        title: "Reorder / check stock",
        detail: summary.inventoryItemsToReorderCount > 0 ? `${summary.inventoryItemsToReorderCount} items need ordering.` : "No reorder action needed right now.",
        status: summary.inventoryItemsToReorderCount > 0 ? "Attention" : "Clear",
        tone: summary.inventoryItemsToReorderCount > 0 ? "warning" : "success",
        to: inventoryRoute,
      },
      {
        title: "Close day",
        detail:
          summary.todayReconciliationStatus === "Incomplete"
            ? "Enter the day's totals and compare to POS."
            : `Today is ${summary.todayReconciliationStatus.toLowerCase()} with variance ${formatCurrency(summary.todayReconciliationVariance)}.`,
        status: summary.todayReconciliationStatus,
        tone: toneForStatus(summary.todayReconciliationStatus),
        to: closeReportsRoute,
      },
      {
        title: "Export report",
        detail: exportReady ? "Accounting-ready CSV can be prepared now." : "Finish review and close before exporting.",
        status: exportReady ? "Ready" : "Not ready",
        tone: exportReady ? "success" : "warning",
        to: closeReportsRoute,
      },
    ];
  }, [
    closeReportsRoute,
    exportReady,
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

  const menuSnapshot = commandCenter.menu;
  const scheduleSnapshot = commandCenter.schedule;

  const modulePanels = [
    {
      title: "Purchases",
      eyebrow: "Supplier spend / review queue",
      summary:
        dashboard.supplierSpend.length > 0
          ? `Top supplier: ${dashboard.supplierSpend[0].supplier}.`
          : "Use purchases to capture invoices, receipts, and price changes.",
      metrics: [
        { label: "This week", value: String(summary.weeklyInvoiceCount) },
        { label: "Need review", value: String(summary.invoiceReviewQueueCount) },
        { label: "Price changes", value: String(dashboard.priceIncreaseCount) },
      ],
      actionLabel: "Open purchases",
      to: purchasesRoute,
    },
    {
      title: "Inventory",
      eyebrow: "Receive / count / adjust / waste / reorder",
      summary:
        dashboard.reorderSuggestions.length > 0
          ? `Top reorder: ${dashboard.reorderSuggestions[0].itemName}.`
          : "Inventory receives purchase flow updates and keeps reorder triggers visible.",
      metrics: [
        { label: "Low stock", value: String(summary.inventoryLowStockCount) },
        { label: "Reorder now", value: String(summary.inventoryItemsToReorderCount) },
        { label: "Count drafts", value: String(summary.inventoryCountSessionDraftCount) },
      ],
      actionLabel: "Open inventory",
      to: inventoryRoute,
    },
    {
      title: "Menu & Costing",
      eyebrow: "Recipe -> cost -> margin",
      summary: "Demo-real costing stays lightweight: menu item, recipe ingredients, current cost, estimated item cost, and margin.",
      metrics: [
        { label: "Costed items", value: String(menuSnapshot.costedItems) },
        { label: "Margin risks", value: String(menuSnapshot.marginRisks) },
        { label: "Square-ready", value: String(menuSnapshot.squareReady) },
      ],
      actionLabel: "Open menu & costing",
      to: menuCostingRoute,
    },
    {
      title: "Schedule",
      eyebrow: "Availability / weekly roster",
      summary: "Simple staffing overview with availability, preferences, generated shifts, and conflict warnings.",
      metrics: [
        { label: "Staff", value: String(scheduleSnapshot.staffCount) },
        { label: "Open shifts", value: String(scheduleSnapshot.openShifts) },
        { label: "Conflicts", value: String(scheduleSnapshot.conflicts) },
      ],
      actionLabel: "Open schedule",
      to: scheduleRoute,
    },
    {
      title: "Close & Reports",
      eyebrow: "Daily close / exports",
      summary: exportReady ? "Accounting-ready CSV can be prepared now. QuickBooks sync stays future-only." : "Finish the close review before export is marked ready.",
      metrics: [
        { label: "Closes to review", value: String(summary.unresolvedReconciliationCount) },
        { label: "Today", value: summary.todayReconciliationStatus },
        { label: "Export", value: exportReady ? "Ready" : "Pending" },
      ],
      actionLabel: "Open close & reports",
      to: closeReportsRoute,
    },
  ];


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
            Export CSV
          </Link>
        </div>
      </Card>

      <section className="mt-7">
        <SectionHeader title="Needs attention today" description="Open these before the next shift." />
        {attentionAlerts.length > 0 ? (
          <Card className="p-4 sm:p-5">
            <div className="space-y-3">
              {attentionAlerts.slice(0, 5).map((alert) => (
                <div key={alert.title} className="flex flex-col gap-3 rounded-xl border border-line bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={alert.tone}>{alert.title}</Badge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{alert.detail}</p>
                  </div>
                  <Link className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={alert.to}>
                    {alert.ctaLabel}
                  </Link>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <p className="text-sm font-semibold text-ink">No urgent items right now.</p>
            <p className="mt-1 text-sm leading-6 text-muted">Upload a purchase or enter a close to surface owner actions.</p>
          </Card>
        )}
      </section>

      <section className="mt-7">
        <SectionHeader title="Today's key numbers" description="The smallest set that still tells the owner what needs action." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Purchases this week" value={String(summary.weeklyInvoiceCount)} helper={summary.weeklyInvoiceCount > 0 ? formatCurrency(summary.weeklyInvoiceSpend) : "No purchases yet"} icon={<FileText className="h-5 w-5" />} />
          <StatCard label="Invoices needing review" value={String(summary.invoiceReviewQueueCount)} helper={summary.invoiceReviewQueueCount > 0 ? "Confirm OCR and mapping" : "Queue is clear"} icon={<AlertTriangle className="h-5 w-5" />} />
          <StatCard label="Low-stock items" value={String(summary.inventoryLowStockCount)} helper={`${summary.inventoryReorderNowCount} need reorder now`} icon={<Package className="h-5 w-5" />} />
          <StatCard label="Reorder suggestions" value={String(summary.inventoryItemsToReorderCount)} helper={summary.inventoryItemsToReorderCount > 0 ? "Order before stockouts" : "No reorder action"} icon={<TrendingUp className="h-5 w-5" />} />
        </div>
      </section>

      <section className="mt-7">
        <SectionHeader title="Today's workflow" description="One connected loop from purchase to export." />
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            {workflowSteps.map((step, index) => (
              <div key={step.title} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-slate-50 px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-ink shadow-sm">{index + 1}</span>
                  <p className="text-sm font-semibold text-ink">{step.title}</p>
                </div>
                <Badge tone={step.tone}>{step.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-7">
        <SectionHeader title="Section summary" />
        <Card className="p-4 sm:p-5">
          <div className="divide-y divide-line">
            {modulePanels.map((panel) => (
              <div key={panel.title} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="mt-1 text-base font-bold text-ink">{panel.title}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {panel.metrics.slice(0, 3).map((metric) => (
                        <span key={metric.label} className="inline-flex items-center rounded-full border border-line bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {metric.label}: {metric.value}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Link className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={panel.to}>
                    {panel.actionLabel}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-7">
        <SectionHeader title="Recent activity" description="Latest 5 saved events." />
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
        <SectionHeader title="Accounting readiness" description="CSV first. QuickBooks stays future-only." />
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={exportReady ? "success" : "warning"}>{exportReady ? "Ready" : "Not ready"}</Badge>
            <Badge tone="neutral">3 blockers</Badge>
            <Badge tone="info">QuickBooks future-only</Badge>
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
    </PageLayout>
  );
}

