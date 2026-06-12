import { AlertTriangle, FileText, ReceiptText, Store, TrendingUp } from "lucide-react";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { PilotCtaPanel } from "../components/PilotCtaPanel";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import {
  categorySpend,
  dashboardAlerts,
  invoices,
  monthlyInsights,
  monthlySummary,
  priceChanges,
  recommendedActions,
  supplierSpend,
} from "../data/mockData";
import type { CategorySpend, InvoiceSummary, PriceChange, SupplierSpend } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

export function DashboardPage() {
  const flaggedChanges = priceChanges.filter((item) => item.status === "Increased");
  const highRiskChanges = priceChanges
    .filter((item) => item.severity === "High")
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 5);
  const recentInvoices = [...invoices].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)).slice(0, 5);

  const supplierColumns: Column<SupplierSpend>[] = [
    { header: "Supplier", accessor: "supplier" },
    { header: "Spend", accessor: (row) => formatCurrency(row.spend) },
    { header: "Invoices", accessor: "invoices" },
    {
      header: "Avg move",
      accessor: (row) => <Badge tone={row.change >= 8 ? "danger" : row.change >= 5 ? "warning" : "neutral"}>{formatPercent(row.change)}</Badge>,
    },
  ];

  const categoryColumns: Column<CategorySpend>[] = [
    { header: "Category", accessor: "category" },
    { header: "Spend", accessor: (row) => formatCurrency(row.spend) },
    {
      header: "Share",
      accessor: (row) => (
        <div className="min-w-32">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
            <span>{row.share.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-slate-700" style={{ width: `${row.share}%` }} />
          </div>
        </div>
      ),
    },
  ];

  const invoiceColumns: Column<InvoiceSummary>[] = [
    { header: "Invoice", accessor: "invoiceNumber" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Date", accessor: (row) => formatDate(row.invoiceDate) },
    { header: "Total", accessor: (row) => formatCurrency(row.totalAmount) },
    {
      header: "Status",
      accessor: (row) => <Badge tone={row.status === "Price Changes Found" ? "warning" : row.status === "Needs Review" ? "danger" : "success"}>{row.status}</Badge>,
    },
  ];

  const priceColumns: Column<PriceChange>[] = [
    { header: "Item", accessor: "item" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Previous", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Current", accessor: (row) => formatCurrency(row.currentPrice) },
    { header: "Change", accessor: (row) => <Badge tone="danger">{formatPercent(row.changePercent)}</Badge> },
  ];

  return (
    <PageLayout
      title="Restaurant cost-control dashboard"
      eyebrow="Harbourfront Cafe / May 2026"
      description="Sample restaurant data showing how Flowtally turns supplier invoices into spend visibility, price-change alerts, and owner-ready actions."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Monthly invoice spend" value={formatCurrency(monthlySummary.totalSpend)} helper={`${monthlySummary.invoicesReviewed} invoices reviewed; 6 recent shown`} icon={<ReceiptText className="h-5 w-5" />} />
        <StatCard label="Suppliers tracked" value={String(monthlySummary.suppliersTracked)} helper="GFS, Sysco, Costco, produce, packaging, coffee" icon={<Store className="h-5 w-5" />} />
        <StatCard label="Price changes detected" value={String(monthlySummary.priceChangesDetected)} helper={`${flaggedChanges.length} increases need review`} icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="Estimated cost increase" value={formatCurrency(monthlySummary.estimatedCostIncrease)} helper="Approximate monthly impact from flagged items" icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <Card className="surface-panel p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-ink p-3 text-white">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-muted">Plain-English insight</p>
              <h2 className="mt-2 text-2xl font-bold tracking-normal text-ink">
                Your total spend is not the only issue. Packaging and produce prices are moving fastest.
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Tomatoes, butter, takeout containers, and sanitizer have the sharpest increases. Flowtally would flag
                these before the owner places another order or changes menu pricing.
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <SectionHeader title="Owner actions" description="The report should leave the owner with a short list, not a spreadsheet." />
          <ol className="space-y-3">
            {recommendedActions.map((action, index) => (
              <li key={action} className="flex gap-3 text-sm leading-6 text-slate-700">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-ink">
                  {index + 1}
                </span>
                {action}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <section className="mt-8">
        <SectionHeader title="Top flagged price changes" description="Line items that changed enough to affect menu margin or delivery costs." />
        <DataTable columns={priceColumns} data={highRiskChanges} getRowKey={(row) => row.id} />
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section>
          <SectionHeader title="Spend by supplier" description="Where invoice dollars went this month." />
          <DataTable columns={supplierColumns} data={supplierSpend} getRowKey={(row) => row.supplierId} />
        </section>
        <section>
          <SectionHeader title="Spend by category" description="Food, packaging, beverage, and operating supply buckets." />
          <DataTable columns={categoryColumns} data={categorySpend} getRowKey={(row) => row.category} />
        </section>
      </div>

      <section className="mt-8">
        <SectionHeader title="Recent invoices" description="Prototype review queue using mock supplier invoices." />
        <DataTable columns={invoiceColumns} data={recentInvoices} getRowKey={(row) => row.id} />
      </section>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {monthlyInsights.map((insight) => (
          <Card key={insight.label} className="p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{insight.label}</p>
            <p className="mt-3 text-2xl font-bold text-ink">{insight.value}</p>
            <p className="mt-2 text-sm leading-5 text-muted">{insight.helper}</p>
          </Card>
        ))}
      </div>

      <section className="mt-8">
        <SectionHeader title="What Flowtally would flag" />
        <div className="grid gap-3 md:grid-cols-2">
          {dashboardAlerts.map((alert) => (
            <Card key={alert} className="p-4">
              <p className="text-sm leading-6 text-slate-700">{alert}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <PilotCtaPanel />
      </section>
    </PageLayout>
  );
}
