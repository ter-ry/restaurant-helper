import { Search, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, type BadgeTone } from "../components/Badge";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { PilotCtaPanel } from "../components/PilotCtaPanel";
import { SectionHeader } from "../components/SectionHeader";
import { categories, priceChanges, suppliers } from "../data/mockData";
import type { PriceChange, PriceStatus, Severity } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

function severityTone(severity: Severity): BadgeTone {
  if (severity === "High") return "danger";
  if (severity === "Medium") return "warning";
  return "neutral";
}

function statusTone(status: PriceStatus): BadgeTone {
  if (status === "Increased") return "danger";
  if (status === "Decreased") return "success";
  return "neutral";
}

export function PriceChangesPage() {
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("All");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");

  const filtered = useMemo(
    () =>
      priceChanges
        .filter((item) => {
          const matchesQuery =
            item.item.toLowerCase().includes(query.toLowerCase()) ||
            item.supplier.toLowerCase().includes(query.toLowerCase());
          const matchesSupplier = supplier === "All" || item.supplier === supplier;
          const matchesCategory = category === "All" || item.category === category;
          const matchesStatus = status === "All" || item.status === status;
          return matchesQuery && matchesSupplier && matchesCategory && matchesStatus;
        })
        .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)),
    [category, query, status, supplier],
  );

  const increasedItems = priceChanges.filter((item) => item.status === "Increased");
  const highRiskItems = priceChanges.filter((item) => item.severity === "High");

  const columns: Column<PriceChange>[] = [
    { header: "Item", accessor: "item" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Category", accessor: "category" },
    { header: "Previous price", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Current price", accessor: (row) => formatCurrency(row.currentPrice) },
    {
      header: "% change",
      accessor: (row) => <Badge tone={row.status === "Increased" ? "danger" : row.status === "Decreased" ? "success" : "neutral"}>{formatPercent(row.changePercent)}</Badge>,
    },
    { header: "Last updated", accessor: (row) => formatDate(row.dateDetected) },
    { header: "Status", accessor: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
    { header: "Risk", accessor: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge> },
  ];

  return (
    <PageLayout
      title="Price Tracker"
      eyebrow="Harbourfront Cafe / item-level tracking"
      description="Track supplier item prices from invoice to invoice and surface increases before they quietly squeeze margin."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Increased prices</p>
          <p className="mt-2 text-3xl font-bold text-ink">{increasedItems.length}</p>
          <p className="mt-1 text-sm text-muted">Items moved up this month</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">High-risk changes</p>
          <p className="mt-2 text-3xl font-bold text-ink">{highRiskItems.length}</p>
          <p className="mt-1 text-sm text-muted">10%+ movement needing owner review</p>
        </Card>
        <Card className="surface-panel p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-ink p-2 text-white">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Best demo angle</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Show that Flowtally finds the exact item, supplier, and price jump, not just total monthly spend.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <section className="mt-8">
        <SectionHeader title="Filter tracked items" description="Frontend-only filters for demo walkthroughs." />
        <Card className="mb-5 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_160px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search item or supplier"
                className="w-full rounded-lg border border-line py-2 pl-9 pr-3 text-sm"
              />
            </label>
            <select value={supplier} onChange={(event) => setSupplier(event.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
              <option>All</option>
              {suppliers.map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
              <option>All</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
              <option>All</option>
              <option>Increased</option>
              <option>Stable</option>
              <option>Decreased</option>
            </select>
          </div>
        </Card>
        <DataTable columns={columns} data={filtered} getRowKey={(row) => row.id} />
      </section>

      <section className="mt-8">
        <PilotCtaPanel />
      </section>
    </PageLayout>
  );
}
