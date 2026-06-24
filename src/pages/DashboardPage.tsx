import { ArrowRight, CalendarClock, FileText, Gauge, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import { formatCurrency, formatDate } from "../utils/format";

type AttentionItem = {
  title: string;
  detail: string;
  to: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
};

type WorkflowStep = {
  title: string;
  status: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  to: string;
};

type ModuleRow = {
  title: string;
  detail: string;
  status: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  to: string;
};

type ActivityRow = {
  title: string;
  detail: string;
  when: string;
  to: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
};

function weekLabel(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `Week of ${formatter.format(date)}`;
}

function formatWhen(value: string) {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis) || millis <= 0) {
    return "Today";
  }
  return formatDate(new Date(millis).toISOString().slice(0, 10));
}

export function DashboardPage() {
  const demo = useDemoProfile();
  const { priceChanges, recentInvoices, reviewQueue, unresolvedReconciliations, summary, inventoryReceipts, inventoryCountSessions, inventoryMovements, reconciliations } = usePilotWorkspace();

  const purchasesRoute = buildDemoPath(defaultDemoProfileSlug, "purchases");
  const inventoryRoute = buildDemoPath(defaultDemoProfileSlug, "inventory");
  const closeReportsRoute = buildDemoPath(defaultDemoProfileSlug, "close-reports");
  const scheduleRoute = buildDemoPath(defaultDemoProfileSlug, "schedule");
  const menuCostingRoute = buildDemoPath(defaultDemoProfileSlug, "menu-costing");

  const attentionItems: AttentionItem[] = [
    {
      title: `${summary.invoiceReviewQueueCount} invoices need review`,
      detail: "Confirm OCR fields and save the purchase record.",
      to: purchasesRoute,
      tone: "warning",
    },
    {
      title: `${summary.inventoryItemsToReorderCount} items need reorder`,
      detail: summary.inventoryItemsToReorderCount > 0 ? `Estimated reorder cost ${formatCurrency(summary.inventoryEstimatedReorderCost)}` : "No reorder action needed right now.",
      to: inventoryRoute,
      tone: summary.inventoryItemsToReorderCount > 0 ? "danger" : "success",
    },
    {
      title: `${summary.unresolvedReconciliationCount} closes need review`,
      detail: summary.todayReconciliationStatus === "Incomplete" ? "No daily close saved for today yet." : `Variance ${formatCurrency(summary.todayReconciliationVariance)}`,
      to: closeReportsRoute,
      tone: summary.unresolvedReconciliationCount > 0 ? "warning" : "success",
    },
    {
      title: `${priceChanges.length} price changes`,
      detail: "Check the latest supplier shifts before the next order.",
      to: purchasesRoute,
      tone: priceChanges.length > 0 ? "info" : "success",
    },
  ];

  const workflowSteps: WorkflowStep[] = [
    { title: "Purchase", status: summary.invoiceReviewQueueCount > 0 ? "Needs review" : "Done", tone: summary.invoiceReviewQueueCount > 0 ? "warning" : "success", to: purchasesRoute },
    { title: "Review", status: summary.invoiceReviewQueueCount > 0 ? "Attention" : "Clear", tone: summary.invoiceReviewQueueCount > 0 ? "warning" : "success", to: purchasesRoute },
    { title: "Receive", status: summary.inventoryReceiptCount > 0 ? "Tracked" : "Pending", tone: summary.inventoryReceiptCount > 0 ? "success" : "info", to: inventoryRoute },
    { title: "Reorder", status: summary.inventoryItemsToReorderCount > 0 ? "Attention" : "Clear", tone: summary.inventoryItemsToReorderCount > 0 ? "warning" : "success", to: inventoryRoute },
    { title: "Close", status: summary.todayReconciliationStatus === "Incomplete" ? "Incomplete" : summary.todayReconciliationStatus, tone: summary.todayReconciliationStatus === "Balanced" ? "success" : summary.todayReconciliationStatus === "Incomplete" ? "warning" : "info", to: closeReportsRoute },
    { title: "Export", status: summary.invoiceReviewQueueCount === 0 && summary.unresolvedReconciliationCount === 0 ? "Ready" : "Not ready", tone: summary.invoiceReviewQueueCount === 0 && summary.unresolvedReconciliationCount === 0 ? "success" : "warning", to: closeReportsRoute },
  ];

  const moduleRows: ModuleRow[] = [
    { title: "Purchases", detail: `${summary.invoiceReviewQueueCount} need review`, status: "Open", tone: summary.invoiceReviewQueueCount > 0 ? "warning" : "success", to: purchasesRoute },
    { title: "Inventory", detail: `${summary.inventoryItemsToReorderCount} reorder`, status: "Open", tone: summary.inventoryItemsToReorderCount > 0 ? "warning" : "success", to: inventoryRoute },
    { title: "Menu & Costing", detail: "Recipe and margin workspace", status: "Ready", tone: "info", to: menuCostingRoute },
    { title: "Schedule", detail: "Weekly roster and conflicts", status: "Ready", tone: "info", to: scheduleRoute },
    { title: "Close & Reports", detail: `${summary.unresolvedReconciliationCount} need review`, status: summary.unresolvedReconciliationCount > 0 ? "Attention" : "Ready", tone: summary.unresolvedReconciliationCount > 0 ? "warning" : "success", to: closeReportsRoute },
  ];

  const activityRows: ActivityRow[] = [];
  const latestInvoice = recentInvoices[0];
  if (latestInvoice) {
    activityRows.push({
      title: "Invoice saved",
      detail: `${latestInvoice.supplier} · ${latestInvoice.invoiceNumber || "No invoice number"} · ${formatCurrency(latestInvoice.totalAmount)}`,
      when: latestInvoice.savedAt || latestInvoice.updatedAt || latestInvoice.createdAt,
      to: purchasesRoute,
      tone: "success",
    });
  }

  const latestReceipt = [...inventoryReceipts].sort((a, b) => new Date((b.updatedAt || b.createdAt) ?? "").getTime() - new Date((a.updatedAt || a.createdAt) ?? "").getTime())[0];
  if (latestReceipt) {
    activityRows.push({
      title: "Item received",
      detail: `${latestReceipt.inventoryItemName} · ${latestReceipt.invoiceNumber}`,
      when: latestReceipt.updatedAt || latestReceipt.createdAt,
      to: inventoryRoute,
      tone: "info",
    });
  }

  const latestPriceChange = priceChanges[0];
  if (latestPriceChange) {
    activityRows.push({
      title: "Price changed",
      detail: `${latestPriceChange.itemName} · ${formatCurrency(latestPriceChange.previousPrice)} → ${formatCurrency(latestPriceChange.currentPrice)}`,
      when: latestPriceChange.invoiceDate,
      to: purchasesRoute,
      tone: latestPriceChange.status === "Increased" ? "danger" : "success",
    });
  }

  const latestCountSession = [...inventoryCountSessions].sort((a, b) => new Date((b.updatedAt || b.createdAt) ?? "").getTime() - new Date((a.updatedAt || a.createdAt) ?? "").getTime())[0];
  if (latestCountSession) {
    activityRows.push({
      title: "Stock counted",
      detail: `${latestCountSession.itemCount} items · ${latestCountSession.status}`,
      when: latestCountSession.updatedAt || latestCountSession.createdAt,
      to: inventoryRoute,
      tone: "warning",
    });
  } else if (inventoryMovements.length > 0) {
    const latestMovement = inventoryMovements[0];
    activityRows.push({
      title: "Stock movement",
      detail: `${latestMovement.inventoryItemName} · ${latestMovement.movementType}`,
      when: latestMovement.updatedAt || latestMovement.createdAt,
      to: inventoryRoute,
      tone: "info",
    });
  }

  const latestReconciliation = [...reconciliations].sort((a, b) => new Date((b.savedAt || b.updatedAt || b.createdAt) ?? "").getTime() - new Date((a.savedAt || a.updatedAt || a.createdAt) ?? "").getTime())[0];
  if (latestReconciliation) {
    activityRows.push({
      title: "Daily close saved",
      detail: `${formatDate(latestReconciliation.date)} · ${latestReconciliation.status} · ${formatCurrency(latestReconciliation.variance)}`,
      when: latestReconciliation.savedAt || latestReconciliation.updatedAt || latestReconciliation.createdAt,
      to: closeReportsRoute,
      tone: latestReconciliation.status === "Balanced" ? "success" : "warning",
    });
  }

  const exportReady = summary.invoiceReviewQueueCount === 0 && summary.unresolvedReconciliationCount === 0;
  const heroPeriod = weekLabel();

  return (
    <PageLayout title="Dashboard" description="Back-office control between POS and QuickBooks.">
      <Card className="p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
              {demo.customization.restaurantName} · {heroPeriod}
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Back-office control between POS and QuickBooks.</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" to={purchasesRoute}>
              Upload purchase
            </Link>
            <div className="flex flex-wrap gap-2 text-sm font-semibold text-muted">
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-ink transition hover:bg-slate-50" to={inventoryRoute}>
                Stock count
              </Link>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-ink transition hover:bg-slate-50" to={closeReportsRoute}>
                Daily close
              </Link>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 py-2 text-ink transition hover:bg-slate-50" to={closeReportsRoute}>
                Export
              </Link>
            </div>
          </div>
        </div>
      </Card>

      <section className="mt-6">
        <SectionHeader title="Needs attention" description="The fastest actions to clear before the next shift." />
        <div className="space-y-2">
          {attentionItems.map((item) => (
            <Link key={item.title} to={item.to} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 transition hover:bg-slate-50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
              </div>
              <Badge tone={item.tone}>Open</Badge>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Needs review" value={String(summary.invoiceReviewQueueCount)} helper={`${summary.invoiceCount} invoices stored locally`} icon={<FileText className="h-5 w-5" />} />
          <StatCard label="Low stock" value={String(summary.inventoryLowStockCount)} helper={`${summary.inventoryOutOfStockCount} out of stock`} icon={<Gauge className="h-5 w-5" />} />
          <StatCard label="Reorder now" value={String(summary.inventoryReorderNowCount)} helper={`Estimated reorder cost ${formatCurrency(summary.inventoryEstimatedReorderCost)}`} icon={<TrendingUp className="h-5 w-5" />} />
          <StatCard label="Close issues" value={String(summary.unresolvedReconciliationCount)} helper={summary.todayReconciliationStatus === "Incomplete" ? "No close saved today" : `Variance ${formatCurrency(summary.todayReconciliationVariance)}`} icon={<CalendarClock className="h-5 w-5" />} />
        </div>
      </section>

      <section className="mt-6">
        <SectionHeader title="Today's workflow" description="One connected loop from purchase to export." />
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {workflowSteps.map((step, index) => (
              <Link key={step.title} to={step.to} className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-ink transition hover:bg-white">
                <span>{step.title}</span>
                <Badge tone={step.tone}>{step.status}</Badge>
                {index < workflowSteps.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-muted" /> : null}
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <SectionHeader title="Modules" description="Compact status across the six visible sections." />
        <Card className="p-4">
          <div className="space-y-2">
            {moduleRows.map((row) => (
              <Link key={row.title} to={row.to} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 transition hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{row.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{row.detail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={row.tone}>{row.status}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
        <Card className="p-5">
          <SectionHeader title="Inventory watch" description="The compact stock signal from saved purchases and movement history." action={<Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={inventoryRoute}>Open inventory</Link>} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TinyMetric label="Inventory items" value={String(summary.inventoryItemCount)} helper={`${summary.inventoryReceiptCount} invoice receipts`} />
            <TinyMetric label="Items to reorder" value={String(summary.inventoryItemsToReorderCount)} helper={formatCurrency(summary.inventoryEstimatedReorderCost)} />
            <TinyMetric label="Draft count sessions" value={String(summary.inventoryCountSessionDraftCount)} helper="Saved locally" />
            <TinyMetric label="Large adjustments" value={String(summary.inventoryRecentLargeAdjustmentCount)} helper="Needs review" />
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Recent activity" description="Latest saved events from the pilot workspace." />
          <div className="space-y-2">
            {activityRows.length > 0 ? (
              activityRows.map((item) => (
                <Link key={`${item.title}-${item.when}`} to={item.to} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 transition hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {item.detail} · {formatWhen(item.when)}
                    </p>
                  </div>
                  <Badge tone={item.tone}>Open</Badge>
                </Link>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-line bg-slate-50 px-4 py-3 text-sm leading-6 text-muted">No activity yet. Upload a purchase or save a daily close to populate the feed.</p>
            )}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Accounting export readiness</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={exportReady ? "success" : "warning"}>{exportReady ? "Accounting export ready" : "Not ready"}</Badge>
                <Badge tone="info">QuickBooks sync future only</Badge>
              </div>
            </div>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={closeReportsRoute}>
              Open Close & Reports
            </Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <TinyMetric label="Invoice review" value={String(summary.invoiceReviewQueueCount)} helper={summary.invoiceReviewQueueCount === 0 ? "Clear" : "Blocker"}/>
            <TinyMetric label="Close variance" value={summary.todayReconciliationStatus} helper={summary.todayReconciliationStatus === "Incomplete" ? "Needs entry" : formatCurrency(summary.todayReconciliationVariance)} />
            <TinyMetric label="Monthly CSV" value={exportReady ? "Ready" : "Pending"} helper={exportReady ? "Can export now" : "Still blocked"} />
          </div>
          {!exportReady ? (
            <div className="mt-4 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm leading-6 text-muted">
              Blockers: invoice review queue open, daily close variance unresolved, or monthly CSV not ready.
            </div>
          ) : null}
        </Card>
      </section>

      <section className="mt-6">
        <SectionHeader title="Recent invoices" description="The latest saved invoice records in this pilot workspace." />
        <Card className="p-5">
          <ul className="space-y-2">
            {recentInvoices.slice(0, 5).map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{invoice.supplier}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {invoice.invoiceNumber || "No invoice number"} · {formatDate(invoice.invoiceDate)}
                  </p>
                </div>
                <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{formatCurrency(invoice.totalAmount)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </section>
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
