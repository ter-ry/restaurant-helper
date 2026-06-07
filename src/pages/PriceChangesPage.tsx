import { useMemo, useState } from "react";
import { Badge, type BadgeTone } from "../components/Badge";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { priceChanges } from "../data/mockData";
import type { PriceChange, Severity } from "../types";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

const tabs = ["Price increases", "Price decreases", "Unchanged items", "High-risk items"] as const;

export function PriceChangesPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Price increases");
  const filtered = useMemo(() => {
    const byLargestMove = (items: PriceChange[]) => [...items].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    if (tab === "Price decreases") return byLargestMove(priceChanges.filter((item) => item.changePercent < 0));
    if (tab === "High-risk items") return byLargestMove(priceChanges.filter((item) => item.severity === "High"));
    if (tab === "Unchanged items") return byLargestMove(priceChanges.filter((item) => Math.abs(item.changePercent) < 5));
    return byLargestMove(priceChanges.filter((item) => item.changePercent > 0));
  }, [tab]);

  const columns: Column<PriceChange>[] = [
    { header: "Item", accessor: "item" },
    { header: "Supplier", accessor: "supplier" },
    { header: "Previous price", accessor: (row) => formatCurrency(row.previousPrice) },
    { header: "Current price", accessor: (row) => formatCurrency(row.currentPrice) },
    { header: "Change %", accessor: (row) => <Badge tone={toneForSeverity(row.severity)}>{formatPercent(row.changePercent)}</Badge> },
    { header: "Date detected", accessor: (row) => formatDate(row.dateDetected) },
    { header: "Severity", accessor: (row) => <Badge tone={toneForSeverity(row.severity)}>{row.severity}</Badge> },
    { header: "Suggested action", accessor: "suggestedAction" },
  ];

  return (
    <PageLayout title="Price Changes" description="See exactly which invoice items moved, by how much, and what to do about it.">
      <SectionHeader title="Cost Movement History" description="Severity is based on the percent change from the previous purchase price." />
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === item ? "bg-ink text-white" : "bg-white text-slate-700 ring-1 ring-line"}`}
          >
            {item}
          </button>
        ))}
      </div>
      <DataTable columns={columns} data={filtered} getRowKey={(row) => row.id} />
    </PageLayout>
  );
}

function toneForSeverity(severity: Severity): BadgeTone {
  if (severity === "High") return "danger";
  if (severity === "Medium") return "warning";
  return "neutral";
}
