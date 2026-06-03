import { AlertTriangle, DollarSign, Store, TrendingUp } from "lucide-react";
import { AlertCard } from "../components/AlertCard";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { categorySpend, dashboardAlerts, priceChanges, recommendedActions, supplierSpend } from "../data/mockData";
import type { CategorySpend, PriceChange, SupplierSpend } from "../types";
import { formatCurrency, formatPercent } from "../utils/format";

export function DashboardPage() {
  const topPriceIncreases = [...priceChanges]
    .filter((item) => item.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 5);
  const supplierSpendByDollars = [...supplierSpend].sort((a, b) => b.spend - a.spend);

  const supplierColumns: Column<SupplierSpend>[] = [
    { header: "Supplier", accessor: "supplier" },
    { header: "Where money went", accessor: (row) => formatCurrency(row.spend) },
    { header: "Invoices", accessor: "invoices" },
    { header: "Avg price move", accessor: (row) => <Badge tone={row.change > 7 ? "danger" : "warning"}>{formatPercent(row.change)}</Badge> },
  ];
  const categoryColumns: Column<CategorySpend>[] = [
    { header: "Category", accessor: "category" },
    { header: "Spend", accessor: (row) => formatCurrency(row.spend) },
    { header: "Share of total", accessor: (row) => `${row.share.toFixed(1)}%` },
  ];
  const changeColumns: Column<PriceChange>[] = [
    { header: "Item", accessor: "item" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Was", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Now", accessor: (row) => formatCurrency(row.currentPrice) },
    { header: "Change", accessor: (row) => <Badge tone={row.severity === "High" ? "danger" : "warning"}>{formatPercent(row.changePercent)}</Badge> },
  ];

  return (
    <PageLayout
      title="What changed in your costs?"
      description="For May 1-15, 2026: the fastest read on what got more expensive, where spending went, and what needs attention before the next order."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total supplier spend" value="$8,420" helper="May 1-15 across 34 invoices" icon={<DollarSign className="h-5 w-5" />} />
        <StatCard label="Most expensive category" value="Meat & Seafood" helper="$2,900, 34.4% of spend" icon={<Store className="h-5 w-5" />} />
        <StatCard label="Items that got pricier" value="18" helper="3 items need margin review" icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="Biggest jump" value="+21.8%" helper="Cooking Oil 16L" icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section>
          <SectionHeader title="Needs attention first" description="These are the items an owner should ask about before placing the next order." />
          <div className="grid gap-3">
            {dashboardAlerts.map((alert) => (
              <AlertCard key={alert} message={alert} />
            ))}
          </div>
        </section>
        <section>
          <SectionHeader title="Recommended next steps" description="Plain-language actions for the owner or manager." />
          <Card className="p-5">
            <ol className="space-y-3">
              {recommendedActions.map((action, index) => (
                <li key={action} className="flex gap-3 text-sm text-slate-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                    {index + 1}
                  </span>
                  {action}
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </div>

      <section className="mt-8">
        <SectionHeader title="What got more expensive" description="The clearest line-item changes found from supplier invoices." />
        <DataTable columns={changeColumns} data={topPriceIncreases} getRowKey={(row) => row.id} />
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section>
          <SectionHeader title="Where spending went" description="Supplier concentration for the current reporting period." />
          <DataTable columns={supplierColumns} data={supplierSpendByDollars} getRowKey={(row) => row.supplierId} />
        </section>
        <section>
          <SectionHeader title="Spend by category" description="A quick way to see which cost buckets are driving the bill." />
          <DataTable columns={categoryColumns} data={categorySpend} getRowKey={(row) => row.category} />
        </section>
      </div>
    </PageLayout>
  );
}
