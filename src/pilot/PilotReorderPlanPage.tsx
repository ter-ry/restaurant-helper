import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCcw, Save, Search, Truck } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import {
  completePilotReorderPlan,
  createPilotReorderPlan,
  fetchPilotReorderPlan,
  fetchPilotReorderPlanDetail,
  fetchPilotReorderPlans,
  preparePilotReorderPlan,
  updatePilotReorderPlan,
  type PilotInventoryResponse,
  type PilotReorderPlan,
  type PilotReorderPlanLine,
  type PilotReorderSuggestion,
} from "./pilotApi";
import { formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

type LineDraft = PilotReorderPlanLine;

export function PilotReorderPlanPage() {
  const location = useLocation();
  const [currentSuggestions, setCurrentSuggestions] = useState<PilotReorderSuggestion[]>([]);
  const [currentGroups, setCurrentGroups] = useState<PilotInventoryResponse["reorderPlan"]["groupedBySupplier"]>([]);
  const [plans, setPlans] = useState<PilotReorderPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PilotReorderPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedPlanId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("planId");
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [location.search]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [suggestionsResponse, plansResponse] = await Promise.all([fetchPilotReorderPlan(), fetchPilotReorderPlans()]);
      setCurrentSuggestions(suggestionsResponse.suggestions);
      setCurrentGroups(suggestionsResponse.groupedBySupplier);
      setPlans(plansResponse.plans);
      const selected = requestedPlanId
        ? plansResponse.plans.find((plan) => plan.id === requestedPlanId) ?? null
        : plansResponse.plans.find((plan) => plan.id === selectedPlanId) ?? plansResponse.plans.find((plan) => plan.id === plansResponse.activeDraftPlanId) ?? plansResponse.plans[0] ?? null;
      if (selected) {
        setSelectedPlanId(selected.id);
        setDraft(selected);
      } else {
        setSelectedPlanId(null);
        setDraft(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the reorder plan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPlanId]);

  const currentUrgentCount = useMemo(() => currentSuggestions.filter((item) => item.stockStatus === "Out of stock" || item.stockStatus === "Reorder now").length, [currentSuggestions]);
  const currentUnknownPriceCount = useMemo(() => currentSuggestions.filter((item) => item.latestPurchasePrice === 0 || item.estimatedCost === null).length, [currentSuggestions]);

  const draftLinesBySupplier = useMemo(() => {
    const lines = draft?.lines ?? [];
    return lines
      .filter((line) => line.inventoryItemName.toLowerCase().includes(search.toLowerCase()) || line.supplierName.toLowerCase().includes(search.toLowerCase()) || line.category.toLowerCase().includes(search.toLowerCase()))
      .reduce<Record<string, LineDraft[]>>((groups, line) => {
        const supplier = line.supplierName || "Unassigned supplier";
        groups[supplier] = groups[supplier] ? [...groups[supplier], line] : [line];
        return groups;
      }, {});
  }, [draft?.lines, search]);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selectedPlanId) ?? draft, [draft, plans, selectedPlanId]);
  const draftPlanCount = plans.filter((plan) => plan.status === "Draft").length;
  const preparedPlanCount = plans.filter((plan) => plan.status === "Prepared").length;
  const completedPlanCount = plans.filter((plan) => plan.status === "Completed").length;

  const openPlan = async (planId: number) => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const plan = await fetchPilotReorderPlanDetail(planId);
      setSelectedPlanId(plan.id);
      setDraft(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the reorder plan.");
    } finally {
      setSaving(false);
    }
  };

  const createDraft = async () => {
    setCreating(true);
    setMessage(null);
    setError(null);
    try {
      const plan = await createPilotReorderPlan();
      setSelectedPlanId(plan.id);
      setDraft(plan);
      setMessage(plan.lineCount ? "Draft reorder plan opened." : "Draft reorder plan created.");
      await load();
      setSelectedPlanId(plan.id);
      setDraft(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a reorder plan.");
    } finally {
      setCreating(false);
    }
  };

  const updateLine = (lineId: number, updater: (line: LineDraft) => LineDraft) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) => (line.id === lineId ? updater(line) : line)),
          }
        : current,
    );
  };

  const saveDraft = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await updatePilotReorderPlan(draft.id, {
        name: draft.name,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          id: line.id,
          orderQuantity: line.orderQuantity,
          excluded: line.excluded,
          notes: line.notes,
          supplierNameSnapshot: line.supplierName,
        })),
      });
      setDraft(saved);
      setSelectedPlanId(saved.id);
      setMessage(`Saved reorder plan ${saved.name}.`);
      await load();
      setSelectedPlanId(saved.id);
      setDraft(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the reorder plan.");
    } finally {
      setSaving(false);
    }
  };

  const prepareDraft = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await updatePilotReorderPlan(draft.id, {
        name: draft.name,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          id: line.id,
          orderQuantity: line.orderQuantity,
          excluded: line.excluded,
          notes: line.notes,
        })),
      });
      const prepared = await preparePilotReorderPlan(saved.id);
      setDraft(prepared);
      setSelectedPlanId(prepared.id);
      setMessage(`Prepared reorder plan ${prepared.name}.`);
      await load();
      setSelectedPlanId(prepared.id);
      setDraft(prepared);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the reorder plan.");
    } finally {
      setSaving(false);
    }
  };

  const completeDraft = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const saved = await updatePilotReorderPlan(draft.id, {
        name: draft.name,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          id: line.id,
          orderQuantity: line.orderQuantity,
          excluded: line.excluded,
          notes: line.notes,
        })),
      });
      const completed = await completePilotReorderPlan(saved.id);
      setDraft(completed);
      setSelectedPlanId(completed.id);
      setMessage(`Completed reorder plan ${completed.name}.`);
      await load();
      setSelectedPlanId(completed.id);
      setDraft(completed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the reorder plan.");
    } finally {
      setSaving(false);
    }
  };

  const draftIncludedCost = draft?.lines.reduce((sum, line) => {
    if (line.excluded) {
      return sum;
    }
    return sum + Number(line.estimatedLineCost || 0);
  }, 0) ?? 0;
  const draftExcludedCount = draft?.lines.filter((line) => line.excluded).length ?? 0;
  const unknownPriceCount = draft?.lines.filter((line) => line.estimatedUnitCost === null).length ?? 0;

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Reorder Plan</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Plan what needs ordering and preserve the snapshot</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Build a draft order from current inventory pressure, adjust quantities, exclude items, and complete the plan when it is ready.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} type="button" onClick={() => void createDraft()} disabled={creating}>
              {creating ? "Starting..." : "Start / reopen draft"}
            </Button>
            <Button variant="secondary" icon={<RefreshCcw className="h-4 w-4" />} type="button" onClick={() => void load()} disabled={loading || saving || creating}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Current suggestions", value: formatNumber(currentSuggestions.length), helper: `${formatNumber(currentUrgentCount)} urgent` },
            { label: "Unknown prices", value: formatNumber(currentUnknownPriceCount), helper: "estimate only" },
            { label: "Draft plans", value: formatNumber(draftPlanCount), helper: `${formatNumber(preparedPlanCount)} prepared` },
            { label: "Completed plans", value: formatNumber(completedPlanCount), helper: "history preserved" },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>
              <p className="mt-1 text-sm text-muted">{metric.helper}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
        <Card className="p-6">
          <SectionHeader title="Current reorder pressure" description="Live suggestions from the current stock picture." />
          <div className="space-y-3">
            {(currentSuggestions ?? []).slice(0, 5).map((suggestion) => (
              <div key={suggestion.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{suggestion.inventoryItemName}</p>
                    <p className="text-sm text-muted">{suggestion.supplier || "Unassigned supplier"} • {suggestion.category}</p>
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
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Suggested</p>
                    <p className="mt-1 text-ink">{formatNumber(suggestion.suggestedQuantity)} {suggestion.unit}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Estimate</p>
                    <p className="mt-1 text-ink">{suggestion.estimatedCost === null ? "Unknown" : formatMoney(suggestion.estimatedCost)}</p>
                  </div>
                </div>
              </div>
            ))}
            {!currentSuggestions.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Reorder suggestions appear once items drop below PAR or minimum.</p> : null}
          </div>

          <div className="mt-6">
            <SectionHeader title="Supplier groups" description="What each supplier needs in the current snapshot." />
            <div className="space-y-3">
              {currentGroups.map((group) => (
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
              {!currentGroups.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Supplier groups appear once items need ordering.</p> : null}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="Saved plans" description="Drafts stay editable. Completed plans preserve their snapshots." />
          <div className="space-y-2">
            {plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => void openPlan(plan.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${
                  selectedPlanId === plan.id ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{plan.name}</p>
                    <p className="text-sm text-muted">{plan.lineCount} lines • {plan.supplierCount} suppliers</p>
                  </div>
                  <Badge tone={statusTone(plan.status)}>{plan.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge tone="neutral">{formatMoney(plan.includedCost)} est. included</Badge>
                  <Badge tone={plan.excludedCount > 0 ? "warning" : "neutral"}>{plan.excludedCount} excluded</Badge>
                </div>
              </button>
            ))}
            {!plans.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No reorder plans yet. Start a draft when you are ready.</p> : null}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader
          title={selectedPlan ? `${selectedPlan.name}` : "Open a reorder plan"}
          description={selectedPlan ? "Adjust quantities, exclude items, add notes, then prepare or complete the plan." : "Start or reopen a draft to begin planning."}
        />

        {draft ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="text-sm font-semibold text-ink">Plan name</span>
                <input className="input mt-1" value={draft.name} onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))} disabled={draft.status === "Completed"} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Status</span>
                <input className="input mt-1" value={draft.status} readOnly />
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-semibold text-ink">Plan notes</span>
                <textarea className="input mt-1" value={draft.notes} onChange={(event) => setDraft((current) => (current ? { ...current, notes: event.target.value } : current))} disabled={draft.status === "Completed"} />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Badge tone="neutral">{draft.lineCount} lines</Badge>
              <Badge tone="neutral">{draft.supplierCount} suppliers</Badge>
              <Badge tone={draftExcludedCount > 0 ? "warning" : "neutral"}>{draftExcludedCount} excluded</Badge>
              <Badge tone={unknownPriceCount > 0 ? "warning" : "success"}>{unknownPriceCount} unknown prices</Badge>
              <Badge tone="orange">{formatMoney(draftIncludedCost)} estimated cost</Badge>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={saving || draft.status === "Completed"} icon={<Save className="h-4 w-4" />} type="button" onClick={() => void saveDraft()}>
                {saving ? "Saving..." : "Save draft"}
              </Button>
              <Button disabled={saving || draft.status === "Completed"} variant="secondary" icon={<Truck className="h-4 w-4" />} type="button" onClick={() => void prepareDraft()}>
                Mark prepared
              </Button>
              <Button disabled={saving || draft.status === "Completed"} variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} type="button" onClick={() => void completeDraft()}>
                Complete plan
              </Button>
            </div>

            <div className="mt-5">
              <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted" />
                  <input className="w-full bg-transparent text-sm outline-none" placeholder="Search plan items" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {Object.entries(draftLinesBySupplier).map(([supplierName, lines]) => (
                <div key={supplierName} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{supplierName}</p>
                      <p className="text-sm text-muted">{lines.length} items</p>
                    </div>
                    <Badge tone="neutral">{lines.some((line) => line.estimatedUnitCost === null) ? "Some prices unknown" : "Prices estimated"}</Badge>
                  </div>

                  <div className="mt-3 space-y-3">
                    {lines.map((line) => (
                      <div key={line.id} className={`rounded-2xl border p-4 ${line.excluded ? "border-dashed border-line bg-white" : "border-line bg-white"}`}>
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-semibold text-ink">{line.inventoryItemName}</p>
                            <p className="text-sm text-muted">{line.category} • {line.currentOnHand} {line.inventoryUnit} on hand • minimum {line.minimumQuantity} / PAR {line.parLevel}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={line.excluded ? "neutral" : "success"}>{line.excluded ? "Excluded" : "Included"}</Badge>
                            <Badge tone={line.estimatedUnitCost === null ? "warning" : "neutral"}>
                              {line.estimatedUnitCost === null ? "Unknown price" : `${formatMoney(line.estimatedUnitCost)} per ${line.purchaseUnit}`}
                            </Badge>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-4">
                          <label className="block">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Order qty</span>
                            <input className="input mt-1" min="0" step="0.0001" type="number" value={line.orderQuantity} onChange={(event) => updateLine(line.id, (current) => ({ ...current, orderQuantity: Number(event.target.value) }))} disabled={draft.status === "Completed"} />
                          </label>
                          <label className="block">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Exclude</span>
                            <div className="mt-1 flex h-10 items-center rounded-2xl border border-line bg-slate-50 px-4">
                              <input checked={line.excluded} disabled={draft.status === "Completed"} type="checkbox" onChange={(event) => updateLine(line.id, (current) => ({ ...current, excluded: event.target.checked }))} />
                              <span className="ml-2 text-sm text-muted">Do not include in this order</span>
                            </div>
                          </label>
                          <label className="block md:col-span-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Line notes</span>
                            <input className="input mt-1" value={line.notes} onChange={(event) => updateLine(line.id, (current) => ({ ...current, notes: event.target.value }))} disabled={draft.status === "Completed"} />
                          </label>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <Badge tone="neutral">Suggested {formatNumber(line.suggestedQuantity)} {line.inventoryUnit}</Badge>
                          <Badge tone="neutral">{formatNumber(line.conversionFactor)} {line.purchaseUnit} per {line.inventoryUnit}</Badge>
                          <Badge tone={line.estimatedLineCost === null ? "warning" : "success"}>
                            {line.estimatedLineCost === null ? "Estimate unavailable" : `${formatMoney(line.estimatedLineCost)} estimated`}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!Object.keys(draftLinesBySupplier).length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No lines match this search. Clear the search to show the full plan.</p> : null}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Start a draft to build a reorder plan from the current stock picture.</div>
        )}
      </Card>
    </div>
  );
}
