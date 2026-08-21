import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Loader2, RefreshCw, Save, Search, Trash2, Workflow } from "lucide-react";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { usePilotSession } from "./PilotSessionProvider";
import {
  deleteSquareCatalogMapping,
  fetchSquareCatalogMappings,
  fetchSquareUsage,
  updateSquareCatalogMapping,
  type SquareCatalogMappingSummary,
  type SquareUsageIngredientRow,
  type SquareUsageMenuItemSummary,
  type SquareUsageReport,
} from "../lib/squareIntegration";

type MappingDraft = Record<number, number | "">;

function formatQuantity(value: number | null | undefined) {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 4 }).format(Number(value ?? 0));
}

function toLocalDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  return {
    startAt: toLocalDateTime(start),
    endAt: toLocalDateTime(end),
  };
}

function MappingCard({
  title,
  subtitle,
  mapping,
  menuItems,
  draftValue,
  onDraftChange,
  onSave,
  onRemove,
  suggestion,
}: {
  title: string;
  subtitle: string;
  mapping: SquareCatalogMappingSummary | null;
  menuItems: SquareUsageMenuItemSummary[];
  draftValue: number | "";
  onDraftChange: (value: number | "") => void;
  onSave: () => void;
  onRemove: () => void;
  suggestion: number | null;
}) {
  const mappedLabel = mapping?.flowtallyEntityId
    ? menuItems.find((item) => item.id === Number(mapping.flowtallyEntityId))?.name ?? mapping.flowtallyEntityId
    : "Not mapped";
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-xs text-muted">{subtitle}</p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{mapping?.status ?? "unmapped"}</span>
      </div>
      <p className="mt-3 text-xs text-muted">Current mapping: {mappedLabel}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally menu item</span>
          <select
            className="input mt-1"
            value={draftValue}
            onChange={(event) => onDraftChange(event.target.value ? Number(event.target.value) : "")}
          >
            <option value="">Choose a menu item</option>
            {menuItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.category}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-2 sm:justify-end">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            type="button"
            onClick={onSave}
            disabled={!draftValue}
          >
            <Save className="h-4 w-4" />
            {mapping ? "Update" : "Map"}
          </button>
          {mapping ? (
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 transition hover:bg-rose-100"
              type="button"
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {suggestion ? <p className="mt-3 text-xs text-brand-700">Suggested match: {menuItems.find((item) => item.id === suggestion)?.name ?? "menu item"}</p> : null}
    </div>
  );
}

function UsageRow({ row }: { row: SquareUsageIngredientRow }) {
  const discrepancyTone = row.discrepancy == null ? "text-muted" : row.discrepancy > 0 ? "text-amber-700" : "text-emerald-700";
  return (
    <tr className="border-t border-line">
      <td className="px-3 py-3 align-top">
        <div className="font-semibold text-ink">{row.inventoryItemName}</div>
        <div className="text-xs text-muted">{row.unit}</div>
        {row.warnings.length ? <div className="mt-2 text-xs text-amber-700">{row.warnings.join(" · ")}</div> : null}
      </td>
      <td className="px-3 py-3 align-top text-right font-semibold text-ink">{formatQuantity(row.soldMenuUnits)}</td>
      <td className="px-3 py-3 align-top text-right font-semibold text-ink">{formatQuantity(row.theoreticalUsage)}</td>
      <td className="px-3 py-3 align-top text-right font-semibold text-ink">{row.actualUsage == null ? "—" : formatQuantity(row.actualUsage)}</td>
      <td className={`px-3 py-3 align-top text-right font-semibold ${discrepancyTone}`}>{row.discrepancy == null ? "—" : formatQuantity(row.discrepancy)}</td>
      <td className="px-3 py-3 align-top text-right font-semibold text-ink">{row.discrepancyPercent == null ? "—" : `${formatQuantity(row.discrepancyPercent)}%`}</td>
    </tr>
  );
}

export function PilotSquareUsagePage() {
  const { organization, currentLocation, locations } = usePilotSession();
  const initialRange = useMemo(() => defaultRange(), []);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(currentLocation?.id ?? null);
  const [startAt, setStartAt] = useState(initialRange.startAt);
  const [endAt, setEndAt] = useState(initialRange.endAt);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<SquareUsageMenuItemSummary[]>([]);
  const [mappings, setMappings] = useState<SquareCatalogMappingSummary[]>([]);
  const [unmappedVariations, setUnmappedVariations] = useState<Array<{
    id: number;
    squareCatalogObjectId: number;
    squareObjectId: string;
    squareObjectType: string;
    squareObjectName: string;
    squareItemName: string;
    isDeleted: boolean;
    soldUnits: number;
    suggestedMenuItemId: number | null;
    suggestedMenuItemName: string;
    mapping: SquareCatalogMappingSummary | null;
  }>>([]);
  const [mappingCoverage, setMappingCoverage] = useState<{ mappedVariationCount: number; totalVariationCount: number; mappedPercent: number }>({
    mappedVariationCount: 0,
    totalVariationCount: 0,
    mappedPercent: 0,
  });
  const [usage, setUsage] = useState<SquareUsageReport | null>(null);
  const [drafts, setDrafts] = useState<MappingDraft>({});

  useEffect(() => {
    if (selectedLocationId == null && currentLocation?.id != null) {
      setSelectedLocationId(currentLocation.id);
    }
  }, [currentLocation?.id, selectedLocationId]);

  const locationOptions = useMemo(
    () => (locations.length > 0 ? locations : currentLocation ? [currentLocation] : []),
    [currentLocation, locations],
  );

  const loadData = useCallback(async () => {
    if (!organization) return;
    setRefreshing(true);
    setMappingError(null);
    setUsageError(null);
    try {
      const mappingResponse = await fetchSquareCatalogMappings({ organizationId: organization.id, locationId: selectedLocationId ?? undefined });
      setMenuItems(mappingResponse.menuItems);
      setMappings(mappingResponse.mappings);
      setUnmappedVariations(mappingResponse.unmappedVariations);
      setMappingCoverage(mappingResponse.mappingCoverage);
      setDrafts(
        Object.fromEntries(
          mappingResponse.mappings.map((mapping) => [
            mapping.squareCatalogObjectId,
            mapping.flowtallyEntityId ? Number(mapping.flowtallyEntityId) : "",
          ]),
        ),
      );
      try {
        const usageResponse = await fetchSquareUsage({
          organizationId: organization.id,
          locationId: selectedLocationId ?? undefined,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
        });
        setUsage(usageResponse.usage);
      } catch (error) {
        setUsage(null);
        setUsageError(error instanceof Error ? error.message : "Could not load usage variance.");
      }
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "Could not load Square mappings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [endAt, organization, selectedLocationId, startAt]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const topUsageRows = useMemo(() => (usage?.ingredientUsage ?? []).slice(0, 20), [usage?.ingredientUsage]);
  const activeMappings = useMemo(() => mappings.filter((mapping) => mapping.status !== "unmapped"), [mappings]);

  async function saveMapping(squareCatalogObjectId: number) {
    if (!organization) return;
    const suggestedMenuItemId = unmappedVariations.find((variation) => variation.squareCatalogObjectId === squareCatalogObjectId)?.suggestedMenuItemId ?? null;
    const menuItemId = drafts[squareCatalogObjectId] ?? suggestedMenuItemId;
    if (!menuItemId) return;
    await updateSquareCatalogMapping({
      organizationId: organization.id,
      squareCatalogObjectId,
      mappingType: "menu_item",
      flowtallyEntityType: "menu_item",
      flowtallyEntityId: String(menuItemId),
      status: "mapped",
    });
    await loadData();
  }

  async function removeMapping(mappingId: number) {
    if (!organization) return;
    await deleteSquareCatalogMapping({ organizationId: organization.id, mappingId });
    await loadData();
  }

  if (loading) {
    return (
      <PageLayout title="Square usage" eyebrow="Pilot workspace" description="Loading Square sales coverage and variance report.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading usage variance…</p>
        </Card>
      </PageLayout>
    );
  }

  if (!organization) {
    return (
      <PageLayout title="Square usage" eyebrow="Pilot workspace" description="Choose an organization to see Square usage.">
        <Card className="p-6">
          <h1 className="text-2xl font-bold text-ink">Choose an organization first</h1>
          <p className="mt-3 text-sm leading-6 text-muted">The usage workspace needs an active organization and location.</p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Square usage" eyebrow="Pilot workspace" description="Map Square variations to menu items and review theoretical versus actual inventory usage.">
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Usage window</p>
              <h1 className="mt-2 text-3xl font-bold text-ink">Inventory usage and variance</h1>
              <p className="mt-2 text-sm leading-6 text-muted">Square sales feed the theoretical ingredient usage. Completed stock counts provide the actual stock basis when available.</p>
            </div>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void loadData()} disabled={refreshing}>
              <RefreshCw className="h-4 w-4" />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Location</span>
              <select className="input mt-1" value={selectedLocationId ?? ""} onChange={(event) => setSelectedLocationId(event.target.value ? Number(event.target.value) : null)}>
                <option value="">All locations</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Start at</span>
              <input className="input mt-1" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">End at</span>
              <input className="input mt-1" type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
            </label>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Sales coverage</p>
              <p className="mt-2 text-2xl font-bold text-ink">{usage ? `${usage.coverage.mappedSalesCoveragePercent}%` : `${mappingCoverage.mappedPercent}%`}</p>
              <p className="mt-1 text-xs text-muted">Mapped variation coverage</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Theoretical usage</p>
              <p className="mt-2 text-2xl font-bold text-ink">{formatQuantity(usage?.totals.theoreticalUsage ?? 0)}</p>
              <p className="mt-1 text-xs text-muted">Across ingredient rows</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Actual usage</p>
              <p className="mt-2 text-2xl font-bold text-ink">{usage?.totals.actualUsage == null ? "—" : formatQuantity(usage.totals.actualUsage)}</p>
              <p className="mt-1 text-xs text-muted">Based on stock-count snapshots</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Variance</p>
              <p className="mt-2 text-2xl font-bold text-ink">{usage?.totals.discrepancy == null ? "—" : formatQuantity(usage.totals.discrepancy)}</p>
              <p className="mt-1 text-xs text-muted">{usage?.totals.discrepancyPercent == null ? "Awaiting counts" : `${formatQuantity(usage.totals.discrepancyPercent)}%`}</p>
            </div>
          </div>

          {mappingError ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Mapping data unavailable
              </div>
              <p className="mt-2">{mappingError}</p>
            </div>
          ) : null}
          {usageError ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Variance report unavailable
              </div>
              <p className="mt-2">{usageError}</p>
            </div>
          ) : null}

          <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-ink">
            <BarChart3 className="h-4 w-4 text-brand-700" />
            Theoretical usage by inventory item
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">Inventory item</th>
                  <th className="px-3 py-3 text-right">Sold menu units</th>
                  <th className="px-3 py-3 text-right">Theoretical usage</th>
                  <th className="px-3 py-3 text-right">Actual usage</th>
                  <th className="px-3 py-3 text-right">Variance</th>
                  <th className="px-3 py-3 text-right">Variance %</th>
                </tr>
              </thead>
              <tbody>
                {topUsageRows.length > 0 ? (
                  topUsageRows.map((row) => <UsageRow key={row.inventoryItemId} row={row} />)
                ) : (
                  <tr>
                    <td className="px-3 py-8 text-center text-sm text-muted" colSpan={6}>
                      No usage rows are available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Search className="h-4 w-4 text-brand-700" />
              Unmapped Square variations
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">Map the exact Square variation to the Flowtally menu item it actually sells.</p>
            <div className="mt-4 space-y-3 max-h-[34rem] overflow-y-auto pr-1">
              {unmappedVariations.length > 0 ? (
                unmappedVariations.map((variation) => (
                  <MappingCard
                    key={variation.squareCatalogObjectId}
                    title={variation.squareObjectName}
                    subtitle={`${variation.squareObjectId} · ${formatQuantity(variation.soldUnits)} sold`}
                    mapping={variation.mapping}
                    menuItems={menuItems}
                    draftValue={drafts[variation.squareCatalogObjectId] ?? variation.suggestedMenuItemId ?? ""}
                    onDraftChange={(value) => setDrafts((current) => ({ ...current, [variation.squareCatalogObjectId]: value }))}
                    onSave={() => void saveMapping(variation.squareCatalogObjectId)}
                    onRemove={() => (variation.mapping ? void removeMapping(variation.mapping.id) : undefined)}
                    suggestion={variation.suggestedMenuItemId}
                  />
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No unmapped Square variations found for the selected scope.</p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Workflow className="h-4 w-4 text-brand-700" />
              Existing mappings
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">Review or remove the current Square variation to menu item links.</p>
            <div className="mt-4 space-y-3 max-h-[34rem] overflow-y-auto pr-1">
              {activeMappings.length > 0 ? (
                activeMappings.map((mapping) => (
                  <MappingCard
                    key={mapping.id}
                    title={mapping.squareObjectName}
                    subtitle={`${mapping.squareObjectId} · ${mapping.mappingType}`}
                    mapping={mapping}
                    menuItems={menuItems}
                    draftValue={drafts[mapping.squareCatalogObjectId] ?? (mapping.flowtallyEntityId ? Number(mapping.flowtallyEntityId) : "")}
                    onDraftChange={(value) => setDrafts((current) => ({ ...current, [mapping.squareCatalogObjectId]: value }))}
                    onSave={() => void saveMapping(mapping.squareCatalogObjectId)}
                    onRemove={() => void removeMapping(mapping.id)}
                    suggestion={null}
                  />
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No active mappings yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-bold text-ink">Coverage and traceability</h2>
          <div className="mt-4 space-y-3">
            {(usage?.contributingMenuItems ?? []).length > 0 ? (
              usage?.contributingMenuItems.map((item) => (
                <div key={item.menuItemId} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{item.menuItemName}</p>
                      <p className="mt-1 text-xs text-muted">
                        {formatQuantity(item.soldUnits)} sold · yield {formatQuantity(item.recipeYield)} {item.recipeYieldUnit}
                      </p>
                    </div>
                    {item.warnings.length > 0 ? (
                      <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Needs review</span>
                    ) : (
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ready</span>
                    )}
                  </div>
                  {item.warnings.length > 0 ? <p className="mt-2 text-sm text-amber-800">{item.warnings.join(" · ")}</p> : null}
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No contributing menu items yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-bold text-ink">Incomplete data and exclusions</h2>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold text-ink">Unmapped variations</p>
              <p className="mt-1 text-sm text-muted">{usage?.coverage.unmappedVariationCount ?? unmappedVariations.length} variation(s) were excluded until they are mapped to a menu item.</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold text-ink">Recipe and unit warnings</p>
              <p className="mt-1 text-sm text-muted">{usage?.coverage.excludedIncompleteUnits ?? 0} sold unit(s) were excluded because a recipe, ingredient, or unit could not be safely calculated.</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold text-ink">Cancelled or voided sales</p>
              <p className="mt-1 text-sm text-muted">{usage?.coverage.excludedCancelledUnits ?? 0} sold unit(s) were excluded because the persisted Square order state was cancelled or voided.</p>
            </div>
          </div>
        </Card>
      </div>
    </PageLayout>
  );
}
