import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Truck } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { fetchPilotReorderPlan, markPilotReorderOrdered, type PilotInventoryResponse, type PilotReorderSuggestion } from "./pilotApi";
import { formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

export function PilotReorderPlanPage() {
  const [suggestions, setSuggestions] = useState<PilotReorderSuggestion[]>([]);
  const [groups, setGroups] = useState<PilotInventoryResponse["reorderPlan"]["groupedBySupplier"]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchPilotReorderPlan();
      setSuggestions(response.suggestions);
      setGroups(response.groupedBySupplier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the reorder plan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const urgentCount = useMemo(
    () => suggestions.filter((item) => item.stockStatus === "Out of stock" || item.stockStatus === "Reorder now").length,
    [suggestions],
  );

  const markOrdered = async (itemId: number) => {
    setSavingId(itemId);
    setMessage(null);
    setError(null);

    try {
      await markPilotReorderOrdered(itemId);
      setMessage("Marked as ordered.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark the item ordered.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Reorder Plan</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">The items that need ordering now</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">A simple supplier-grouped plan for the items that have fallen below PAR, minimum, or their days-remaining threshold.</p>
          </div>
          <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Suggestions", value: formatNumber(suggestions.length) },
            { label: "Urgent items", value: formatNumber(urgentCount) },
            { label: "Supplier groups", value: formatNumber(groups.length) },
            { label: "Estimated order total", value: formatMoney(groups.reduce((sum, group) => sum + group.estimatedOrderTotal, 0)) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-6">
          <SectionHeader title="Urgent items" description="Reorder now and out-of-stock items are shown first." />
          <div className="space-y-3">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{suggestion.inventoryItemName}</p>
                    <p className="text-sm text-muted">{suggestion.supplier} • {suggestion.category}</p>
                  </div>
                  <Badge tone={statusTone(suggestion.stockStatus)}>{suggestion.stockStatus}</Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Current</p>
                    <p className="mt-1 text-ink">{formatNumber(suggestion.currentQuantity)} {suggestion.unit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Minimum / PAR</p>
                    <p className="mt-1 text-ink">{formatNumber(suggestion.minimumQuantity)} / {formatNumber(suggestion.parLevel)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Suggest</p>
                    <p className="mt-1 text-ink">{formatNumber(suggestion.suggestedQuantity)} {suggestion.unit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Cost</p>
                    <p className="mt-1 text-ink">{formatMoney(suggestion.estimatedCost ?? 0)}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={savingId === suggestion.id} icon={<Truck className="h-4 w-4" />} type="button" onClick={() => void markOrdered(suggestion.id)}>
                    {savingId === suggestion.id ? "Saving..." : "Mark ordered"}
                  </Button>
                  <Badge tone="neutral">{suggestion.daysRemaining !== null ? `${suggestion.daysRemaining} days remaining` : "No usage data"}</Badge>
                </div>
              </div>
            ))}
            {!loading && !suggestions.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Nothing needs ordering right now.</p> : null}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Supplier groups" description="A compact view of what each supplier needs." />
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.supplier} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{group.supplier}</p>
                    <p className="text-sm text-muted">{group.itemCount} items</p>
                  </div>
                  <Badge tone="orange">{formatMoney(group.estimatedOrderTotal)}</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {group.lines.slice(0, 4).map((line) => (
                    <div key={line.id} className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-sm">
                      <span className="truncate text-ink">{line.inventoryItemName}</span>
                      <span className="text-muted">{formatNumber(line.adjustedQuantity)} {line.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Supplier groups appear once items need ordering.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
