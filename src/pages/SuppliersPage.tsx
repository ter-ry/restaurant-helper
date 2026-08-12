import { useEffect, useState } from "react";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { useDemoProfile } from "../lib/demoProfile";
import type { Supplier, TrackedItem } from "../types";
import { formatCurrency, formatPercent } from "../utils/format";

export function SuppliersPage() {
  const demo = useDemoProfile();
  const [selected, setSelected] = useState<Supplier>(demo.suppliers[0]);

  useEffect(() => {
    setSelected(demo.suppliers[0]);
  }, [demo.slug, demo.suppliers]);

  const items = demo.trackedItems.filter((item) => item.preferredSupplier === selected.name);
  const columns: Column<Supplier>[] = [
    { header: "Supplier name", accessor: "name" },
    { header: "Category focus", accessor: "categoryFocus" },
    { header: "Spend this period", accessor: (row) => formatCurrency(row.totalSpendMonth) },
    { header: "Invoices", accessor: "invoicesMonth" },
    { header: "Items tracked", accessor: "itemsTracked" },
    { header: "Avg price move", accessor: (row) => <Badge tone={row.averagePriceChange > 7 ? "danger" : "warning"}>{formatPercent(row.averagePriceChange)}</Badge> },
    { header: "Owner note", accessor: "notes" },
  ];
  const itemColumns: Column<TrackedItem>[] = [
    { header: "Item", accessor: "name" },
    { header: "Last Price", accessor: (row) => formatCurrency(row.lastPrice) },
    { header: "Change", accessor: (row) => formatPercent(row.changePercent) },
  ];

  return (
    <PageLayout title="Suppliers" description="See which vendors received the most spend and which ones need a pricing conversation.">
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <section>
          <SectionHeader title="Supplier Spend and Pricing" description="Select a supplier to view tracked items." />
          <DataTable columns={columns} data={demo.suppliers} getRowKey={(row) => row.id} onRowClick={setSelected} />
        </section>
        <section>
          <SectionHeader title="Supplier Detail" />
          <Card className="p-5">
            <h2 className="text-xl font-bold text-ink">{selected.name}</h2>
            <p className="mt-1 text-sm text-muted">{selected.notes}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="Spend This Period" value={formatCurrency(selected.totalSpendMonth)} />
              <Metric label="Invoices This Period" value={String(selected.invoicesMonth)} />
              <Metric label="Items Purchased" value={String(selected.itemsTracked)} />
              <Metric label="Average Price Change" value={formatPercent(selected.averagePriceChange)} />
            </div>
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold text-ink">Tracked items</h3>
              <DataTable columns={itemColumns} data={items} getRowKey={(row) => row.id} />
            </div>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-base font-bold text-ink">{value}</p>
    </div>
  );
}
