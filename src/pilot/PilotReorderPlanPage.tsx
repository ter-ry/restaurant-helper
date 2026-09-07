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
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";
import { formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

type LineDraft = PilotReorderPlanLine;

export function PilotReorderPlanPage() {
  const location = useLocation();
  const [currentSuggestions, setCurrentSuggestions] = useState<PilotReorderSuggestion[]>([]);
  const [currentGroups, setCurrentGroups] = useState<PilotInventoryResponse["reorderPlan"]["groupedBySupplier"]>([]);
  const [inventoryItems, setInventoryItems] = useState<NonNullable<Awaited<ReturnType<typeof fetchPilotReorderPlan>>["inventoryItems"]>>([]);
  const [activeInventoryItemCount, setActiveInventoryItemCount] = useState(0);
  const [recommendationsRefreshedAt, setRecommendationsRefreshedAt] = useState<string | null>(null);
  const [plans, setPlans] = useState<PilotReorderPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PilotReorderPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingAction, setPendingAction] = useState<"save" | "prepare" | "complete" | null>(null);
  const [workflowTab, setWorkflowTab] = useState<"live" | "history">("live");
  const [search, setSearch] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedPlanId = useMemo(() => {
    const value = new URLSearchParams(location.search).get("planId");
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [location.search]);

  const load = async (preferredPlanId: number | null = requestedPlanId, options?: { preserveMessage?: boolean; preserveSelection?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!options?.preserveMessage) {
      setMessage(null);
    }
    setPlans([]);
    setCurrentSuggestions([]);
    setCurrentGroups([]);
    setInventoryItems([]);
    if (!options?.preserveSelection) {
      setSelectedPlanId(null);
      setDraft(null);
    }

    try {
      const [suggestionsResponse, plansResponse] = await Promise.all([fetchPilotReorderPlan(), fetchPilotReorderPlans()]);
      setCurrentSuggestions(suggestionsResponse.suggestions);
      setCurrentGroups(suggestionsResponse.groupedBySupplier);
      setInventoryItems(suggestionsResponse.inventoryItems ?? []);
      setActiveInventoryItemCount(suggestionsResponse.activeInventoryItemCount ?? 0);
      setRecommendationsRefreshedAt(suggestionsResponse.refreshedAt ?? null);
      setPlans(plansResponse.plans);
      const selected = preferredPlanId
        ? plansResponse.plans.find((plan) => plan.id === preferredPlanId) ?? null
        : selectedPlanId !== null
          ? plansResponse.plans.find((plan) => plan.id === selectedPlanId && plan.status !== "Completed") ?? null
          : null;
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
  const livePlans = useMemo(() => plans.filter((plan) => plan.status !== "Completed"), [plans]);
  const historyPlans = useMemo(() => plans.filter((plan) => plan.status === "Completed"), [plans]);
  const visiblePlans = workflowTab === "history" ? historyPlans : livePlans;
  const showCompactEmptyState = workflowTab === "live" && currentSuggestions.length === 0 && draftPlanCount === 0;

  const openPlan = async (planId: number) => {
    if (saving || creating || loading) {
      return;
    }
    setSaving(true);
    setPendingAction(null);
    setMessage(null);
    setError(null);
    try {
      const plan = await fetchPilotReorderPlanDetail(planId);
      setSelectedPlanId(plan.id);
      setDraft(plan);
      setMessage(plan.status === "Draft" ? "Draft reorder plan opened." : "Read-only reorder snapshot opened.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the reorder plan.");
    } finally {
      setSaving(false);
    }
  };

  const createDraft = async () => {
    if (creating || saving || loading) {
      return;
    }
    setCreating(true);
    setPendingAction(null);
    setMessage(null);
    setError(null);
    try {
      const plan = await createPilotReorderPlan();
      await load(plan.id, { preserveMessage: true });
      setSelectedPlanId(plan.id);
      setDraft(plan);
      setMessage(plan.lineCount ? "Draft reorder plan opened." : "Draft reorder plan created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a reorder plan.");
    } finally {
      setCreating(false);
    }
  };

  const addItemsToDraft = async (items: Array<{ id: number; suggestedQuantity?: number }>) => {
    if ((creating || saving || loading) || !items.length) return;
    setCreating(!draft || draft.status !== "Draft");
    setPendingAction(null);
    setMessage(null);
    setError(null);
    try {
      const workingDraft = draft && draft.status === "Draft" ? draft : await createPilotReorderPlan();
      setSelectedPlanId(workingDraft.id);
      setDraft(workingDraft);
      setPlans((current) => current.some((plan) => plan.id === workingDraft.id) ? current.map((plan) => plan.id === workingDraft.id ? workingDraft : plan) : [workingDraft, ...current]);
      const additions = items.filter((item) => !workingDraft.lines.some((line) => line.inventoryItemId === item.id));
      if (!additions.length) {
        setMessage("Those items are already in the working order plan.");
        return;
      }
      setCreating(false);
      setSaving(true);
      const saved = await updatePilotReorderPlan(workingDraft.id, {
        lines: [
          ...workingDraft.lines.map((line) => ({ id: line.id, orderQuantity: line.orderQuantity, excluded: line.excluded, notes: line.notes })),
          ...additions.map((item) => ({ inventoryItemId: item.id, orderQuantity: item.suggestedQuantity ?? 0 })),
        ],
      });
      setDraft(saved);
      setPlans((current) => current.map((plan) => plan.id === saved.id ? saved : plan));
      setMessage(`${items.length === 1 ? "Item" : "Items"} added to the working order plan.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add items to the reorder plan.");
    } finally {
      setCreating(false);
      setSaving(false);
    }
  };

  const addRecommendations = () => void addItemsToDraft(currentSuggestions.map((suggestion) => ({ id: suggestion.inventoryItemId, suggestedQuantity: suggestion.suggestedQuantity })));

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
    setPendingAction("save");
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
      await load(saved.id, { preserveMessage: true, preserveSelection: true });
      setSelectedPlanId(saved.id);
      setDraft(saved);
      setMessage(`Saved draft ${saved.name}. It remains editable until you prepare it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the reorder plan.");
    } finally {
      setSaving(false);
      setPendingAction(null);
    }
  };

  const prepareDraft = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setPendingAction("prepare");
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
      await load(prepared.id, { preserveMessage: true });
      setSelectedPlanId(prepared.id);
      setDraft(prepared);
      setMessage(`Prepared reorder plan ${prepared.name}. It is now review-only until completed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the reorder plan.");
    } finally {
      setSaving(false);
      setPendingAction(null);
    }
  };

  const completeDraft = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setPendingAction("complete");
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
      await load(null, { preserveMessage: true });
      setSelectedPlanId(null);
      setDraft(null);
      setMessage(`Completed reorder plan ${completed.name}. It is now locked in history.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the reorder plan.");
    } finally {
      setSaving(false);
      setPendingAction(null);
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
  const availableItems = inventoryItems.filter((item) => !draft?.lines.some((line) => line.inventoryItemId === item.id) && `${item.name} ${item.category} ${item.preferredSupplierName} ${item.stockUnit}`.toLowerCase().includes(inventorySearch.toLowerCase()));

  return (
    <div className="workspace-page">
      <Card className="surface-panel workspace-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Reorder Plan</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Plan what needs ordering and preserve the snapshot</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Keep live pressure beside the working draft. Completed plans remain locked history.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} type="button" onClick={() => void createDraft()} disabled={creating || saving || loading}>
              {creating ? "Starting..." : "Start / reopen draft"}
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCcw className="h-4 w-4" />}
              type="button"
              onClick={() => void load(draft?.status === "Draft" ? selectedPlanId : null)}
              disabled={loading || saving || creating}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div> : null}
        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div> : null}
        {loading ? <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-muted">Loading reorder plans...</div> : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {[
            { label: "Current suggestions", value: formatNumber(currentSuggestions.length), helper: `${formatNumber(currentUrgentCount)} urgent` },
            { label: "Unknown prices", value: formatNumber(currentUnknownPriceCount), helper: "estimate only" },
            { label: "Draft plans", value: formatNumber(draftPlanCount), helper: `${formatNumber(preparedPlanCount)} prepared` },
            { label: "Completed plans", value: formatNumber(completedPlanCount), helper: "history preserved" },
          ].map((metric) => (
            <div key={metric.label} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${metric.label === "Current suggestions" || metric.label === "Draft plans" ? "border-brand-200 bg-brand-50/50" : "border-line bg-white"}`}>
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{metric.label}</span>
              <span className="text-sm font-bold text-ink">{metric.value}</span>
              <span className="text-xs text-muted">{metric.helper}</span>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <WorkspaceTabs
            tabs={[
              { id: "live", label: "Live planning", badge: livePlans.length },
              { id: "history", label: "History", badge: historyPlans.length },
            ]}
            value={workflowTab}
            onChange={(value) => setWorkflowTab(value as "live" | "history")}
          />
          <p className="mt-3 text-sm text-muted">{workflowTab === "history" ? "Completed plans are locked history snapshots." : "Live pressure stays separate from completed history so the working draft remains obvious."}</p>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
      {workflowTab === "history" ? (
        <div className="grid gap-4">
          <Card className="workspace-card">
            <SectionHeader title="Completed plan history" description="Live reorder pressure stays hidden here so this view reads as history only." />
            <div className="space-y-3">
              {historyPlans.slice(0, 5).map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-line bg-slate-50 p-4">
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
                </div>
              ))}
              {!historyPlans.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No completed plans yet.</p> : null}
            </div>
          </Card>

          <Card className="workspace-card">
            <SectionHeader title="Saved plans" description="Drafts stay editable. Completed plans preserve their snapshots." />
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {visiblePlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  disabled={creating || saving || loading}
                  onClick={() => void openPlan(plan.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-70 ${
                    selectedPlanId === plan.id
                      ? "border-brand-200 bg-brand-50"
                      : plan.status === "Draft"
                        ? "border-brand-100 bg-brand-50/50"
                        : plan.status === "Prepared"
                          ? "border-amber-200 bg-amber-50/70"
                          : "border-line bg-slate-50"
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
                  <p className="mt-2 text-xs text-muted">
                    {plan.status === "Draft"
                      ? "Editable draft"
                      : plan.status === "Prepared"
                        ? "Prepared snapshot"
                        : "Completed history"}
                  </p>
                </button>
              ))}
              {!visiblePlans.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No draft plans yet. Start a draft when you are ready.</p> : null}
            </div>
          </Card>
        </div>
      ) : showCompactEmptyState ? (
        <div className="space-y-4">
          <Card className="workspace-card border-brand-200 bg-brand-50/30">
            <SectionHeader title="Nothing needs reordering right now." description="All active inventory items are currently above their reorder thresholds." />
            <div className="mt-4 rounded-2xl border border-brand-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
              Checked <span className="font-bold text-ink">{formatNumber(activeInventoryItemCount)} active inventory item{activeInventoryItemCount === 1 ? "" : "s"}</span>. No current reorder pressure was found.
              {recommendationsRefreshedAt ? <span className="block text-xs text-muted">Recommendations refreshed {new Date(recommendationsRefreshedAt).toLocaleString()}</span> : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {completedPlanCount > 0 ? <Badge tone="neutral">{completedPlanCount} completed plan{completedPlanCount === 1 ? "" : "s"} available in History</Badge> : null}
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} type="button" onClick={() => void createDraft()} disabled={creating || saving || loading}>
                Start manual draft
              </Button>
              <Button variant="secondary" type="button" onClick={() => setWorkflowTab("history")}>
                View history
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted">Completed plans stay preserved as history snapshots.</p>
          </Card>

          <Card className="workspace-card">
            <SectionHeader title="Completed plan history" description="History stays separate from live reorder pressure." />
            <div className="space-y-3">
              {historyPlans.slice(0, 3).map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-line bg-slate-50 p-4">
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
                </div>
              ))}
              {!historyPlans.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No completed plans yet.</p> : null}
            </div>
          </Card>
        </div>
      ) : (
        <div className={`${draft ? "order-2" : "order-1"} grid gap-6 xl:grid-cols-[1.18fr_0.82fr]`}>
          <Card className="p-6">
            <SectionHeader title="Current reorder pressure" description="Live suggestions from the current stock picture." />
            <div className="workspace-table-wrap max-h-[26rem] overflow-y-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
                  <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">On hand / PAR</th><th className="px-3 py-2">Suggested</th><th className="px-3 py-2">Estimate</th><th className="px-3 py-2">Action</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(currentSuggestions ?? []).slice(0, 5).map((suggestion) => {
                    const isInDraft = draft?.status === "Draft" && draft.lines.some((line) => line.inventoryItemId === suggestion.inventoryItemId);
                    return (
                      <tr key={suggestion.id} className="bg-white">
                        <td className="px-3 py-3"><p className="font-semibold text-ink">{suggestion.inventoryItemName}</p><Badge tone={statusTone(suggestion.stockStatus)}>{suggestion.stockStatus}</Badge></td>
                        <td className="px-3 py-3 text-muted">{suggestion.supplier || "Unassigned supplier"}</td>
                        <td className="px-3 py-3 text-ink">{formatNumber(suggestion.currentQuantity)} / {formatNumber(suggestion.parLevel)} {suggestion.unit}</td>
                        <td className="px-3 py-3 font-semibold text-ink">{formatNumber(suggestion.suggestedQuantity)} {suggestion.unit}</td>
                        <td className="px-3 py-3 text-ink">{suggestion.estimatedCost === null ? "Unknown" : formatMoney(suggestion.estimatedCost)}</td>
                        <td className="px-3 py-3"><Button variant="secondary" type="button" disabled={creating || saving || loading} onClick={() => isInDraft ? setMessage(`${suggestion.inventoryItemName} is already in the working order plan.`) : void addItemsToDraft([{ id: suggestion.inventoryItemId, suggestedQuantity: suggestion.suggestedQuantity }])}>{isInDraft ? "In draft" : "Add to draft"}</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

          <Card className="workspace-card">
            <SectionHeader title="Saved plans" description="Drafts stay editable. Completed plans preserve their snapshots." />
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {visiblePlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  disabled={creating || saving || loading}
                  onClick={() => void openPlan(plan.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-70 ${
                    selectedPlanId === plan.id
                      ? "border-brand-200 bg-brand-50"
                      : plan.status === "Draft"
                        ? "border-brand-100 bg-brand-50/50"
                        : plan.status === "Prepared"
                          ? "border-amber-200 bg-amber-50/70"
                          : "border-line bg-slate-50"
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
                  <p className="mt-2 text-xs text-muted">
                    {plan.status === "Draft"
                      ? "Editable draft"
                      : plan.status === "Prepared"
                        ? "Prepared snapshot"
                        : "Completed history"}
                  </p>
                </button>
              ))}
              {!visiblePlans.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No draft plans yet. Start a draft when you are ready.</p> : null}
            </div>
          </Card>
        </div>
      )}

      <Card className={`p-5 ${draft && workflowTab === "live" ? "order-1" : "order-2"}`}>
        <SectionHeader
          title={selectedPlan ? `${selectedPlan.name}` : "Open a reorder plan"}
          description={selectedPlan ? "Drafts stay editable. Prepared and completed plans open as read-only snapshots." : "Start or reopen a draft to begin planning."}
        />

        {draft ? (
          <>
            <div className={`mb-5 rounded-xl border px-3 py-2 ${draft.status === "Draft" ? "border-brand-100 bg-brand-50" : draft.status === "Prepared" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(draft.status)}>{draft.status}</Badge>
                <Badge tone="neutral">{draft.status === "Draft" ? "Editable draft" : draft.status === "Prepared" ? "Review-only snapshot" : "Locked history"}</Badge>
              </div>
              <div className="mt-2 flex w-fit flex-wrap gap-1">
                {[
                  { label: "Draft", active: draft.status === "Draft" },
                  { label: "Prepared", active: draft.status === "Prepared" },
                  { label: "Completed", active: draft.status === "Completed" },
                ].map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      step.active ? "border-ink bg-ink text-white" : "border-line bg-white text-muted"
                    }`}
                  >
                    {step.label}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted">
                {draft.status === "Draft"
                  ? "Keep shaping quantities, then mark it prepared when you are ready."
                  : draft.status === "Prepared"
                    ? "Prepared plans are frozen for review. Complete them from this snapshot when the order is final."
                    : "This completed plan is locked for history and cannot be edited."}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="text-sm font-semibold text-ink">Plan name</span>
                <input className={`input mt-1 ${draft.status !== "Draft" ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : ""}`} value={draft.name} onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))} disabled={draft.status !== "Draft"} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">Status</span>
                <input className="input mt-1 cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" value={draft.status} readOnly />
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-semibold text-ink">Plan notes</span>
                <textarea className={`input mt-1 min-h-10 ${draft.status !== "Draft" ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : ""}`} rows={1} placeholder="Optional plan note" value={draft.notes} onChange={(event) => setDraft((current) => (current ? { ...current, notes: event.target.value } : current))} disabled={draft.status !== "Draft"} />
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
              {draft.status === "Draft" && currentSuggestions.some((suggestion) => !draft.lines.some((line) => line.inventoryItemId === suggestion.inventoryItemId)) ? (
                <Button variant="secondary" type="button" onClick={addRecommendations} disabled={saving || loading}>
                  Add current recommendations
                </Button>
              ) : null}
              <Button disabled={creating || saving || loading || draft.status !== "Draft"} variant="secondary" icon={<Save className="h-4 w-4" />} type="button" onClick={() => void saveDraft()}>
                {saving && pendingAction === "save" ? "Saving draft..." : "Save draft"}
              </Button>
              <Button disabled={creating || saving || loading || draft.status !== "Draft"} variant="ghost" icon={<Truck className="h-4 w-4" />} type="button" onClick={() => void prepareDraft()}>
                {saving && pendingAction === "prepare" ? "Preparing..." : "Mark prepared"}
              </Button>
              <Button disabled={creating || saving || loading || draft.status === "Completed"} icon={<CheckCircle2 className="h-4 w-4" />} variant="primary" type="button" onClick={() => void completeDraft()}>
                {saving && pendingAction === "complete" ? "Completing..." : "Complete plan"}
              </Button>
            </div>

            {draft.status === "Draft" ? (
              <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">Add inventory item</p>
                    <p className="mt-1 text-sm text-muted">Choose any active item, even when Flowtally has no current recommendation.</p>
                  </div>
                  <Badge tone="neutral">{availableItems.length} available</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3">
                  <Search className="h-4 w-4 text-muted" />
                  <input aria-label="Search inventory to add" className="w-full bg-transparent text-sm outline-none" placeholder="Search inventory to add" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} />
                </div>
                <div className="mt-3 space-y-2">
                  {availableItems.slice(0, 8).map((item) => {
                    const suggestion = currentSuggestions.find((candidate) => candidate.inventoryItemId === item.id);
                    return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-3 py-3">
                      <div><p className="font-semibold text-ink">{item.name}</p><p className="text-xs text-muted">{formatNumber(item.currentOnHand)} {item.stockUnit} on hand · PAR {formatNumber(item.parLevel)} · {item.preferredSupplierName || "No supplier"}</p></div>
                      <Button variant="secondary" type="button" onClick={() => void addItemsToDraft([{ id: item.id, suggestedQuantity: suggestion?.suggestedQuantity }])} disabled={saving}>Add</Button>
                    </div>;
                  })}
                  {!availableItems.length ? (
                    inventorySearch.trim()
                      ? <p className="text-sm text-muted">No inventory items match your search.</p>
                      : inventoryItems.length > 0 && draft.lines.length >= inventoryItems.length
                        ? <p className="text-sm text-muted">All active inventory items are already in this draft.</p>
                        : <p className="text-sm text-muted">No active inventory items match this search.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-5">
              <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted" />
                  <input aria-label="Search items in this plan" className="w-full bg-transparent text-sm outline-none" placeholder="Search items in this plan" value={search} onChange={(event) => setSearch(event.target.value)} />
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
                            <input className={`input mt-1 w-24 ${draft.status !== "Draft" ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : ""}`} min="0" step="1" type="number" value={line.orderQuantity} onChange={(event) => updateLine(line.id, (current) => ({ ...current, orderQuantity: Number(event.target.value) }))} disabled={draft.status !== "Draft"} />
                          </label>
                          <label className="block">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Exclude</span>
                            <div className={`mt-1 flex h-10 items-center rounded-xl border px-3 ${draft.status !== "Draft" ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : "border-line bg-slate-50"}`}>
                              <input checked={line.excluded} disabled={draft.status !== "Draft"} type="checkbox" onChange={(event) => updateLine(line.id, (current) => ({ ...current, excluded: event.target.checked }))} />
                              <span className="ml-2 text-sm text-muted">Do not include in this order</span>
                            </div>
                          </label>
                          <label className="block md:col-span-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">Line notes</span>
                            <input className={`input mt-1 ${draft.status !== "Draft" ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500" : ""}`} value={line.notes} onChange={(event) => updateLine(line.id, (current) => ({ ...current, notes: event.target.value }))} disabled={draft.status !== "Draft"} />
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
              {!Object.keys(draftLinesBySupplier).length ? <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">{draft.lines.length ? "No lines match this search. Clear the plan search to show the full draft." : "This draft has no items yet. Use Add inventory item or Add current recommendations above."}</p> : null}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">Start a draft to build a reorder plan from the current stock picture.</div>
        )}
      </Card>
      </div>
    </div>
  );
}
