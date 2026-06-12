import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { PilotCtaPanel } from "../components/PilotCtaPanel";
import { SectionHeader } from "../components/SectionHeader";
import { categorySpend, monthlyInsights, priceChanges, recommendedActions, supplierSpend } from "../data/mockData";
import type { CategorySpend, PriceChange, SupplierSpend } from "../types";
import { formatCurrency, formatPercent } from "../utils/format";

export function ReportsPage() {
  const [message, setMessage] = useState("");
  const biggestIncreases = priceChanges
    .filter((item) => item.status === "Increased")
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 5);

  const supplierColumns: Column<SupplierSpend>[] = [
    { header: "Supplier", accessor: "supplier" },
    { header: "Monthly spend", accessor: (row) => formatCurrency(row.spend) },
    { header: "Invoices", accessor: "invoices" },
    { header: "Avg price move", accessor: (row) => <Badge tone={row.change >= 8 ? "danger" : row.change >= 5 ? "warning" : "neutral"}>{formatPercent(row.change)}</Badge> },
  ];

  const categoryColumns: Column<CategorySpend>[] = [
    { header: "Category", accessor: "category" },
    { header: "Spend", accessor: (row) => formatCurrency(row.spend) },
    { header: "Share of spend", accessor: (row) => `${row.share.toFixed(1)}%` },
  ];

  const increaseColumns: Column<PriceChange>[] = [
    { header: "Item", accessor: "item" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Category", accessor: "category" },
    { header: "Was", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Now", accessor: (row) => formatCurrency(row.currentPrice) },
    { header: "Change", accessor: (row) => <Badge tone={row.severity === "High" ? "danger" : "warning"}>{formatPercent(row.changePercent)}</Badge> },
  ];

  const showExportMessage = () => {
    setMessage("Demo only: PDF export would be generated from this report.");
    window.setTimeout(() => setMessage(""), 2600);
  };

  return (
    <PageLayout
      title="Monthly Cost Report"
      eyebrow="Harbourfront Cafe / May 2026"
      description="Screenshot-friendly owner report showing what changed, where money went, and what to do next."
    >
      <Card className="surface-panel p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-ink p-3 text-white">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Executive summary</p>
                <h2 className="text-2xl font-bold tracking-normal text-ink">Packaging and produce costs need attention this month.</h2>
              </div>
            </div>
            <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-700">
              Harbourfront Cafe reviewed 29 supplier invoices in May. Total supplier spend is concentrated across GFS,
              Sysco, Local Produce Co., and packaging vendors. The clearest margin risks are tomatoes, butter, takeout
              containers, sanitizer, and chicken thighs.
            </p>
          </div>
          <div className="shrink-0">
            <Button onClick={showExportMessage} icon={<Download className="h-4 w-4" />}>
              Export PDF
            </Button>
            {message ? <p className="mt-2 max-w-48 text-xs leading-5 text-muted">{message}</p> : null}
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {monthlyInsights.map((insight) => (
          <Card key={insight.label} className="p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{insight.label}</p>
            <p className="mt-3 text-2xl font-bold text-ink">{insight.value}</p>
            <p className="mt-2 text-sm leading-5 text-muted">{insight.helper}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section>
          <SectionHeader title="Supplier spending" description="Where the restaurant spent money this month." />
          <DataTable columns={supplierColumns} data={supplierSpend} getRowKey={(row) => row.supplierId} />
        </section>
        <section>
          <SectionHeader title="Category spending" description="The simplest view of food, packaging, beverage, and operating supply costs." />
          <DataTable columns={categoryColumns} data={categorySpend} getRowKey={(row) => row.category} />
        </section>
      </div>

      <section className="mt-8">
        <SectionHeader title="Biggest price increases" description="Items most likely to affect menu margin or delivery profitability." />
        <DataTable columns={increaseColumns} data={biggestIncreases} getRowKey={(row) => row.id} />
      </section>

      <section className="mt-8">
        <SectionHeader title="Recommended owner actions" description="Short, practical next steps generated from invoice patterns." />
        <Card className="p-6">
          <div className="grid gap-4 md:grid-cols-2">
            {recommendedActions.map((action, index) => (
              <div key={action} className="flex gap-3 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
                  {index + 1}
                </span>
                {action}
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-8">
        <PilotCtaPanel />
      </section>
    </PageLayout>
  );
}
