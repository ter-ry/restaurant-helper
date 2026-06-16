import { AlertTriangle, CalendarClock, FileText, TrendingUp } from "lucide-react";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { useDemoProfile } from "../lib/demoProfile";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { PilotInvoiceRecord, PilotPriceChangeRecord, PilotReconciliationRecord } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

export function DashboardPage() {
  const demo = useDemoProfile();
  const { priceChanges, recentInvoices, reviewQueue, unresolvedReconciliations, summary } = usePilotWorkspace();

  const reviewColumns: Column<PilotInvoiceRecord>[] = [
    { header: "Supplier", accessor: "supplier" },
    { header: "Invoice", accessor: "invoiceNumber" },
    { header: "Date", accessor: (row) => formatDate(row.invoiceDate) },
    { header: "Total", accessor: (row) => formatCurrency(row.totalAmount) },
    { header: "Notes", accessor: "notes", className: "min-w-72" },
    { header: "Status", accessor: (row) => <Badge tone={row.status === "Ready" ? "success" : "warning"}>{row.status}</Badge> },
  ];

  const changeColumns: Column<PilotPriceChangeRecord>[] = [
    { header: "Item", accessor: "itemName" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Previous date", accessor: (row) => formatDate(row.previousInvoiceDate) },
    { header: "Current date", accessor: (row) => formatDate(row.invoiceDate) },
    { header: "Previous", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Current", accessor: (row) => formatCurrency(row.currentPrice) },
    { header: "Change", accessor: (row) => <Badge tone={row.status === "Increased" ? "danger" : row.status === "Decreased" ? "success" : "neutral"}>{formatPercent(row.changePercent)}</Badge> },
    { header: "Severity", accessor: (row) => <Badge tone={row.severity === "High" ? "danger" : row.severity === "Medium" ? "warning" : "neutral"}>{row.severity}</Badge> },
  ];

  const reconciliationColumns: Column<PilotReconciliationRecord>[] = [
    { header: "Date", accessor: (row) => formatDate(row.date) },
    { header: "Uber Eats", accessor: (row) => formatCurrency(row.uberEats) },
    { header: "DoorDash", accessor: (row) => formatCurrency(row.doorDash) },
    { header: "Skip", accessor: (row) => formatCurrency(row.skip) },
    { header: "Cash", accessor: (row) => formatCurrency(row.cash) },
    { header: "Card", accessor: (row) => formatCurrency(row.card) },
    { header: "Other", accessor: (row) => formatCurrency(row.other) },
    { header: "Expected POS", accessor: (row) => formatCurrency(row.expectedPosSales) },
    { header: "Variance", accessor: (row) => <Badge tone={Math.abs(row.variance) >= 1 ? "danger" : "success"}>{formatCurrency(row.variance)}</Badge> },
    { header: "Status", accessor: (row) => <Badge tone={row.status === "Balanced" ? "success" : "warning"}>{row.status}</Badge> },
    { header: "Notes", accessor: "notes", className: "min-w-72" },
  ];

  return (
    <PageLayout
      title="Owner summary"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="A single-restaurant view of invoice review, supplier price changes, and daily reconciliation exceptions."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Invoices needing review"
          value={String(summary.invoiceReviewQueueCount)}
          helper={`${summary.invoiceCount} invoices stored locally`}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          label="Recent price changes"
          value={String(summary.recentPriceChangeCount)}
          helper="Derived automatically from invoice history"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Unresolved reconciliations"
          value={String(summary.unresolvedReconciliationCount)}
          helper={`${summary.reconciliationCount} daily closes logged`}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Weekly invoice spend"
          value={formatCurrency(summary.weeklyInvoiceSpend)}
          helper={`${summary.weeklyInvoiceCount} invoices in the last 7 days`}
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="surface-panel p-6">
          <SectionHeader title="Pilot summary" description="Weekly and monthly rollups from the local restaurant records in this browser." />
          <div className="grid gap-4 md:grid-cols-2">
            <SummaryBlock
              title="Weekly view"
              lines={[
                `${summary.weeklyInvoiceCount} invoices worth ${formatCurrency(summary.weeklyInvoiceSpend)}`,
                `${summary.weeklyVariance >= 0 ? "Positive" : "Negative"} reconciliation variance of ${formatCurrency(summary.weeklyVariance)}`,
              ]}
            />
            <SummaryBlock
              title="Monthly view"
              lines={[
                `${summary.monthlyInvoiceCount} invoices worth ${formatCurrency(summary.monthlyInvoiceSpend)}`,
                `${summary.monthlyVariance >= 0 ? "Positive" : "Negative"} reconciliation variance of ${formatCurrency(summary.monthlyVariance)}`,
              ]}
            />
          </div>
        </Card>
        <Card className="p-6">
          <SectionHeader title="What to test next" description="The pilot is intentionally narrow so a restaurant can try it without new integrations." />
          <ul className="space-y-3 text-sm leading-6 text-slate-700">
            <li>Upload a supplier invoice, correct the extracted fields, and save the record.</li>
            <li>Enter one daily close, compare the variance, and mark it Balanced or Needs Review.</li>
            <li>Open this summary again to see the unresolved items update automatically.</li>
          </ul>
        </Card>
      </div>

      <section className="mt-8">
        <SectionHeader
          title="Invoices needing review"
          description="These are the invoice records that still need an owner check before they are marked ready."
        />
        <DataTable columns={reviewColumns} data={reviewQueue.slice(0, 8)} getRowKey={(row) => row.id} />
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Recent supplier price changes"
          description="Only changes that were detected from the invoice history stored locally."
        />
        <DataTable columns={changeColumns} data={priceChanges.slice(0, 8)} getRowKey={(row) => row.id} />
      </section>

      <section className="mt-8">
        <SectionHeader
          title="Unresolved reconciliation differences"
          description="Daily close entries where the totals are not yet balanced or still need attention."
        />
        <DataTable columns={reconciliationColumns} data={unresolvedReconciliations.slice(0, 8)} getRowKey={(row) => row.id} />
      </section>

      <section className="mt-8">
        <SectionHeader title="Recent invoices" description="The latest stored invoice records in this pilot workspace." />
        <DataTable columns={reviewColumns} data={recentInvoices.slice(0, 8)} getRowKey={(row) => row.id} />
      </section>
    </PageLayout>
  );
}

function SummaryBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
      <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}
