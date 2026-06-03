import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { categories, trackedItems } from "../data/mockData";
import type { TrackedItem } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

export function ItemsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const filtered = useMemo(
    () =>
      trackedItems.filter((item) => {
        const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase()) || item.preferredSupplier.toLowerCase().includes(query.toLowerCase());
        const matchesCategory = category === "All" || item.category === category;
        return matchesQuery && matchesCategory;
      }),
    [category, query],
  );

  const columns: Column<TrackedItem>[] = [
    { header: "Normalized item name", accessor: "name" },
    { header: "Category", accessor: "category" },
    { header: "Preferred supplier", accessor: "preferredSupplier" },
    { header: "Last price", accessor: (row) => formatCurrency(row.lastPrice) },
    { header: "Previous price", accessor: (row) => formatCurrency(row.previousPrice) },
    {
      header: "Change %",
      accessor: (row) => <Badge tone={row.changePercent > 10 ? "danger" : row.changePercent >= 5 ? "warning" : row.changePercent < 0 ? "success" : "neutral"}>{formatPercent(row.changePercent)}</Badge>,
    },
    { header: "Last purchased date", accessor: (row) => formatDate(row.lastPurchasedDate) },
  ];

  return (
    <PageLayout title="Items / Categories" description="A clean item list that shows the current price, previous price, and supplier behind each cost change.">
      <SectionHeader title="Tracked Items" description="Search by item or supplier, then filter by category." />
      <Card className="mb-5 p-4">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search items or suppliers"
              className="w-full rounded-lg border border-line py-2 pl-9 pr-3 text-sm"
            />
          </label>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
            <option>All</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
      </Card>
      <DataTable columns={columns} data={filtered} getRowKey={(row) => row.id} />
    </PageLayout>
  );
}
