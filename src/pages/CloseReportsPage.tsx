import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { useDemoProfile } from "../lib/demoProfile";
import { buildExportCsv, buildExportReadinessModel, downloadTextFile } from "../lib/demoReadiness";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import { formatCurrency, formatDate } from "../utils/format";

export function CloseReportsPage() {
  const demo = useDemoProfile();
  const { recentInvoices, inventoryReceipts, reconciliations, summary } = usePilotWorkspace();
  const [message, setMessage] = useState("");

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

  const latestBalancedClose = [...reconciliations].find((record) => record.status === "Balanced") ?? reconciliations[0] ?? null;
  const latestReviewClose = [...reconciliations].find((record) => record.status !== "Balanced") ?? null;
  const recentPurchases = [...recentInvoices].slice(0, 3);
  const supplierSpend = [...demo.supplierSpend].slice(0, 3);
  const categorySpend = [...demo.categories].slice(0, 3);

  const handleDownload = () => {
    const rows = [
      {
        section: "Purchase CSV",
        status: exportReadiness.purchaseCsv,
        detail: exportReadiness.purchaseCsv === "Ready" ? `${recentInvoices.length} purchases stored locally` : "Review the invoice queue first",
      },
      {
        section: "Supplier spend",
        status: exportReadiness.supplierSpendSummary,
        detail: exportReadiness.supplierSpendSummary === "Ready" ? `${supplierSpend.length} supplier summaries ready` : "Purchase review is still open",
      },
      {
        section: "Category spend",
        status: exportReadiness.categorySpendSummary,
        detail: exportReadiness.categorySpendSummary === "Ready" ? `${categorySpend.length} category totals ready` : "Purchase review is still open",
      },
      {
        section: "Inventory movement",
        status: exportReadiness.inventoryMovementSummary,
        detail: `${summary.inventoryMovementCount} movement records`,
      },
      {
        section: "Daily close",
        status: exportReadiness.dailyCloseSummary,
        detail: summary.todayReconciliationStatus === "Incomplete" ? "Enter the daily totals first" : `${summary.todayReconciliationDate} variance ${formatCurrency(summary.todayReconciliationVariance)}`,
      },
      {
        section: "Monthly owner report",
        status: exportReadiness.monthlyOwnerReport,
        detail: exportReadiness.blockers.length > 0 ? exportReadiness.blockers.join(" | ") : "Ready for accountant review",
      },
      {
        section: "QuickBooks",
        status: exportReadiness.quickBooksStatus,
        detail: "Future only / demo placeholder",
      },
    ];

    const csv = buildExportCsv(rows);
    downloadTextFile(`flowtally-export-readiness-${summary.todayReconciliationDate}.csv`, csv);
    setMessage("Demo CSV downloaded. QuickBooks sync stays future-only.");
    window.setTimeout(() => setMessage(""), 2600);
  };

  return (
    <PageLayout
      title="Close & Reports"
      eyebrow="Back Office Core / export home"
      description="Daily close, report readiness, and accountant-ready CSV previews."
    >
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={exportReadiness.dailyCloseSummary === "Ready" ? "success" : "warning"}>{summary.todayReconciliationStatus}</Badge>
              <Badge tone={exportReadiness.monthlyOwnerReport === "Ready" ? "success" : "warning"}>{exportReadiness.monthlyOwnerReport}</Badge>
              <Badge tone="info">QuickBooks future-only</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Daily close, export readiness, and reporting live here.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              {demo.customization.restaurantName} keeps the accounting story simple: capture clean purchase records, resolve the daily close, and hand the accountant a believable CSV set.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" to="../daily-reconciliation">
              Open daily close
            </Link>
            <Button type="button" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={handleDownload}>
              Download sample CSV
            </Button>
          </div>
        </div>
        {message ? <p className="mt-3 text-sm leading-6 text-muted">{message}</p> : null}
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ReadinessCard label="Purchase CSV" status={exportReadiness.purchaseCsv} detail="Reviewed invoices only" />
        <ReadinessCard label="Supplier spend" status={exportReadiness.supplierSpendSummary} detail="Monthly supplier summary" />
        <ReadinessCard label="Category spend" status={exportReadiness.categorySpendSummary} detail="Tea, dairy, packaging, bakery" />
        <ReadinessCard label="Inventory movement" status={exportReadiness.inventoryMovementSummary} detail={`${summary.inventoryMovementCount} records stored locally`} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ReadinessCard label="Daily close" status={exportReadiness.dailyCloseSummary} detail={summary.todayReconciliationStatus === "Incomplete" ? "Needs entry" : `${summary.todayReconciliationDate} variance ${formatCurrency(summary.todayReconciliationVariance)}`} />
        <ReadinessCard label="Monthly owner report" status={exportReadiness.monthlyOwnerReport} detail={exportReadiness.blockers.length > 0 ? exportReadiness.blockers.join(" · ") : "Ready for accountant review"} />
      </div>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="Close history" description="One balanced day and one review day stay visible." />
          <div className="mt-4 space-y-2">
            {latestBalancedClose ? <CloseRow record={latestBalancedClose} tone="success" /> : null}
            {latestReviewClose ? <CloseRow record={latestReviewClose} tone="warning" /> : null}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Purchase preview" description="Recent purchase records that feed the export-ready summary." />
          <div className="mt-4 space-y-2">
            {recentPurchases.map((invoice) => (
              <div key={invoice.id} className="rounded-xl border border-line bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{invoice.supplier}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">
                      {invoice.invoiceNumber || "No invoice number"} · {formatDate(invoice.invoiceDate)}
                    </p>
                  </div>
                  <Badge tone={invoice.status === "Ready" ? "success" : "warning"}>{formatCurrency(invoice.totalAmount)}</Badge>
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {invoice.status} · {invoice.lineItems.length} items
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="Supplier spend summary" description="The biggest supplier buckets stay compact and believable." />
          <div className="mt-4 space-y-2">
            {supplierSpend.map((supplier) => (
              <div key={supplier.supplierId} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{supplier.supplier}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{supplier.invoices} invoices this month</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-ink">{formatCurrency(supplier.spend)}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{supplier.change.toFixed(1)}% avg move</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Category spend summary" description="The core restaurant categories that flow into accountant-ready reporting." />
          <div className="mt-4 space-y-2">
            {categorySpend.map((category) => (
              <div key={category.category} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{category.category}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{category.share.toFixed(1)}% of spend</p>
                </div>
                <Badge tone="neutral">{formatCurrency(category.spend)}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Accounting export</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              The MVP is a clean CSV preview and report status. QuickBooks sync stays future only, and no live accounting integration is claimed.
            </p>
          </div>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="../reports">
            Open reports
          </Link>
        </div>
      </Card>
    </PageLayout>
  );
}

function ReadinessCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-lg font-bold text-ink">{status}</p>
      <p className="mt-1 text-sm leading-6 text-muted">{detail}</p>
    </Card>
  );
}

function CloseRow({
  record,
  tone,
}: {
  record: { date: string; status: string; variance: number; notes: string };
  tone: "success" | "warning";
}) {
  return (
    <div className="rounded-xl border border-line bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{formatDate(record.date)}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted">{record.notes}</p>
        </div>
        <Badge tone={tone}>{record.status}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        <span>Variance {formatCurrency(record.variance)}</span>
      </div>
    </div>
  );
}
