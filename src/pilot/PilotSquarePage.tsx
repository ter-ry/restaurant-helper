import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { usePilotSession } from "./PilotSessionProvider";
import {
  beginPilotSquareConnection,
  disconnectPilotSquare,
  fetchPilotSquareStatus,
  fetchPilotSquareCatalogMappings,
  fetchPilotMenuCosting,
  syncPilotSquareCatalog,
  syncPilotSquareLocations,
  syncPilotSquareOrders,
  updatePilotSquareCatalogMapping,
  updatePilotSquareLocationMapping,
  type PilotMenuCostingResponse,
  type PilotSquareConnectionSummary,
} from "./pilotApi";
import { formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";

function readValue(id: string, fallback: string) {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? fallback;
}

function dateRangeDefaults() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  return {
    startAt: start.toISOString().slice(0, 16),
    endAt: end.toISOString().slice(0, 16),
  };
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}

function squareSectionLinkClasses(active: boolean) {
  return [
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition",
    active ? "border-ink bg-ink text-white shadow-soft" : "border-line bg-white text-ink hover:bg-slate-50",
  ].join(" ");
}

export function PilotSquarePage() {
  const { organization, locations, currentLocation } = usePilotSession();
  const [connection, setConnection] = useState<PilotSquareConnectionSummary | null>(null);
  const [catalogMappings, setCatalogMappings] = useState<Awaited<ReturnType<typeof fetchPilotSquareCatalogMappings>>["mappings"]>([]);
  const [mappingCoverage, setMappingCoverage] = useState<Awaited<ReturnType<typeof fetchPilotSquareCatalogMappings>>["mappingCoverage"]>({ mappedVariationCount: 0, totalVariationCount: 0, mappedPercent: 0 });
  const [menuCosting, setMenuCosting] = useState<PilotMenuCostingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeStartAt, setRangeStartAt] = useState(dateRangeDefaults().startAt);
  const [rangeEndAt, setRangeEndAt] = useState(dateRangeDefaults().endAt);
  const [message, setMessage] = useState<string | null>(null);

  const currentOrganizationId = organization?.id ?? null;

  const load = async () => {
    if (!currentOrganizationId) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [status, costing, mappingResponse] = await Promise.all([
        fetchPilotSquareStatus(currentOrganizationId),
        fetchPilotMenuCosting(),
        fetchPilotSquareCatalogMappings(currentOrganizationId),
      ]);
      setConnection(status.connection);
      setMenuCosting(costing);
      setCatalogMappings(mappingResponse.mappings.length ? mappingResponse.mappings : mappingResponse.unmappedVariations);
      setMappingCoverage(mappingResponse.mappingCoverage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Square.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId]);

  const squareLocations = connection?.locations ?? [];
  const dailySales = connection?.dailySales ?? [];
  const syncJobs = connection?.syncJobs ?? [];
  const menuItems = menuCosting?.menuItems ?? [];
  const mappedLocations = squareLocations.filter((location) => location.mappings.some((mapping) => mapping.restaurantLocationId)).length;
  const mappedMenus = mappingCoverage.mappedVariationCount;
  const latestDailySale = dailySales[0] ?? null;
  const connectionReady = connection?.status === "connected";

  const runAction = async (label: string, action: () => Promise<{ connection: PilotSquareConnectionSummary }>) => {
    if (!currentOrganizationId) {
      return;
    }

    setSaving(label);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      setConnection(result.connection);
      setMessage(`${label} completed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Square.");
    } finally {
      setSaving(null);
    }
  };

  const saveLocationMapping = async (squareLocationId: number) => {
    if (!currentOrganizationId) {
      return;
    }

    const restaurantLocationId = Number(readValue(`pilot-square-location-${squareLocationId}`, ""));
    if (!Number.isFinite(restaurantLocationId) || restaurantLocationId <= 0) {
      setError("Choose a Flowtally location before saving the mapping.");
      return;
    }

    return runAction(`location-${squareLocationId}`, () =>
      updatePilotSquareLocationMapping({
        organizationId: currentOrganizationId,
        squareLocationId,
        restaurantLocationId,
      }),
    );
  };

  const saveCatalogMapping = async (catalogObjectId: number) => {
    if (!currentOrganizationId) {
      return;
    }

    const menuItemId = readValue(`pilot-square-menu-item-${catalogObjectId}`, "");
    await runAction(`catalog-${catalogObjectId}`, () =>
      updatePilotSquareCatalogMapping({
        organizationId: currentOrganizationId,
        squareCatalogObjectId: catalogObjectId,
        mappingType: "menu_item",
        flowtallyEntityType: "menu_item",
        flowtallyEntityId: menuItemId,
        status: menuItemId ? "mapped" : "unmapped",
      }),
    );
    await load();
  };

  const syncOrders = async () => {
    if (!currentOrganizationId) {
      return;
    }

    return runAction("orders-sync", () =>
      syncPilotSquareOrders({
        organizationId: currentOrganizationId,
        startAt: new Date(rangeStartAt).toISOString(),
        endAt: new Date(rangeEndAt).toISOString(),
      }),
    );
  };

  const squareStatusTone = connectionReady ? "success" : "warning";
  const totalMappedLocations = squareLocations.length > 0 ? `${mappedLocations}/${squareLocations.length}` : "0";
  const totalMappedMenus = mappingCoverage.totalVariationCount > 0 ? `${mappedMenus}/${mappingCoverage.totalVariationCount}` : "0";

  const syncNow = async () => {
    if (!currentOrganizationId || !connectionReady || saving !== null) {
      return;
    }

    setSaving("sync-now");
    setError(null);
    setMessage(null);
    try {
      await syncPilotSquareLocations(currentOrganizationId);
      await syncPilotSquareCatalog(currentOrganizationId);
      await syncPilotSquareOrders({
        organizationId: currentOrganizationId,
        startAt: new Date(rangeStartAt).toISOString(),
        endAt: new Date(rangeEndAt).toISOString(),
      });
      await load();
      setMessage("Sync now completed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync Square.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="surface-panel p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Square</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Private workspace for Square connection, sync, and mapping</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
              Keep the integration practical: connect, sync, map locations, link menu items, and review the usage snapshot without leaving the pilot shell.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="h-4 w-4" />} type="button" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            {connectionReady ? (
              <Button
                icon={<Send className="h-4 w-4" />}
                type="button"
                onClick={() => {
                  if (!currentOrganizationId) {
                    return;
                  }
                  void beginPilotSquareConnection(currentOrganizationId);
                }}
              >
                Connect again
              </Button>
            ) : (
              <Button
                icon={<ExternalLink className="h-4 w-4" />}
                type="button"
                onClick={() => {
                  if (!currentOrganizationId) {
                    return;
                  }
                  void beginPilotSquareConnection(currentOrganizationId);
                }}
              >
                Connect Square
              </Button>
            )}
          </div>
        </div>

        {message ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              {message}
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Problem
            </div>
            <p className="mt-1">{error}</p>
          </div>
        ) : null}
        {loading ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted">
            Loading Square workspace...
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link aria-current="page" className={squareSectionLinkClasses(true)} to="/app/square">
          Setup & Sync
        </Link>
        <Link className={squareSectionLinkClasses(false)} to="/app/square-usage">
          Usage & Variance
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="Connection and sync" description="Connection state, sync controls, and the latest imported sales summary." />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Connection" value={connection?.status ?? "disconnected"} detail={connectionReady ? "Square is connected to this organization." : "Connect Square before syncing data."} tone={squareStatusTone} />
              <MetricCard label="Sync" value={connection?.syncStatus ?? "idle"} detail={connection?.syncError ? connection.syncError : "Manual syncs are available when connected."} tone={connection?.syncStatus === "error" ? "danger" : "neutral"} />
              <MetricCard label="Merchant" value={connection?.squareMerchantId || "none"} detail="The current Square merchant ID linked to the workspace." tone="neutral" />
              <MetricCard label="Last sync" value={connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "never"} detail="The newest location, catalog, or order sync time." tone="neutral" />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!connectionReady || saving !== null}
                onClick={() => void syncNow()}
              >
                {saving === "sync-now" ? "Syncing..." : "Sync now"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!connectionReady || saving !== null}
                onClick={() => {
                  if (!currentOrganizationId) {
                    return;
                  }
                  void runAction("locations-sync", () => syncPilotSquareLocations(currentOrganizationId));
                }}
              >
                {saving === "locations-sync" ? "Syncing locations..." : "Sync locations"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!connectionReady || saving !== null}
                onClick={() => {
                  if (!currentOrganizationId) {
                    return;
                  }
                  void runAction("catalog-sync", () => syncPilotSquareCatalog(currentOrganizationId));
                }}
              >
                {saving === "catalog-sync" ? "Syncing catalog..." : "Sync catalog"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!connectionReady || saving !== null}
                onClick={() => void syncOrders()}
              >
                {saving === "orders-sync" ? "Syncing orders..." : "Sync orders"}
              </Button>
              {connectionReady ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving !== null}
                  onClick={() => {
                    if (!currentOrganizationId) {
                      return;
                    }
                    void runAction("disconnect", () => disconnectPilotSquare(currentOrganizationId));
                  }}
                >
                  {saving === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </Button>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Recent sales</p>
                {latestDailySale ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <SummaryRow label="Sale date" value={latestDailySale.saleDate} />
                    <SummaryRow label="Net amount" value={formatMoney(latestDailySale.netAmount)} />
                    <SummaryRow label="Orders" value={formatNumber(latestDailySale.orderCount)} />
                    <SummaryRow label="Cancelled" value={formatNumber(latestDailySale.cancelledOrderCount)} />
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">No daily sales summaries yet.</p>
                )}
              </div>
              <div className="rounded-2xl border border-line bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Usage / variance</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <SummaryRow label="Mapped locations" value={totalMappedLocations} />
                  <SummaryRow label="Mapped menu items" value={totalMappedMenus} />
                  <SummaryRow label="Locations in workspace" value={formatNumber(locations.length)} />
                  <SummaryRow label="Current location" value={currentLocation?.name ?? "Not set"} />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Location mapping" description="Map Square locations to the active pilot workspace locations." />
            <div className="mt-4 space-y-3">
              {squareLocations.length ? squareLocations.map((location) => {
                const mapped = location.mappings.find((mapping) => mapping.restaurantLocationId) ?? null;
                return (
                  <div key={location.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{location.name}</p>
                        <p className="mt-1 text-xs text-muted">{location.squareLocationId} · {location.status}</p>
                      </div>
                      <Badge tone={mapped ? "success" : "warning"}>{mapped ? "Mapped" : "Unmapped"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                      <select id={`pilot-square-location-${location.id}`} className="input" defaultValue={mapped?.restaurantLocationId ?? ""} disabled={!connectionReady}>
                        <option value="">Choose a Flowtally location</option>
                        {locations.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        disabled={!connectionReady || saving !== null || !locations.length}
                        onClick={() => void saveLocationMapping(location.id)}
                      >
                        {saving === `location-${location.id}` ? "Saving..." : "Save mapping"}
                      </Button>
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-2xl border border-dashed border-line bg-slate-50 px-4 py-8 text-sm text-muted">Sync Square locations first to map them here.</p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Menu mapping" description="Link Square catalog items to Flowtally menu items so the close and usage view stay aligned." />
            <div className="mt-4 space-y-3 max-h-[34rem] overflow-y-auto pr-1">
              {catalogMappings.length ? catalogMappings.slice(0, 16).map((catalogObject) => {
                const mapping = catalogObject.mapping;
                return (
                  <div key={catalogObject.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{catalogObject.squareObjectName || catalogObject.squareObjectId}</p>
                        <p className="mt-1 text-xs text-muted">ITEM_VARIATION · {catalogObject.squareObjectId}</p>
                      </div>
                      <Badge tone={mapping?.flowtallyEntityId ? "success" : "warning"}>{mapping?.flowtallyEntityId ? "Mapped" : "Needs mapping"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                      <select id={`pilot-square-menu-item-${catalogObject.id}`} className="input" defaultValue={mapping?.flowtallyEntityId ?? ""} disabled={!connectionReady}>
                        <option value="">Choose a menu item</option>
                        {menuItems.map((menuItem) => (
                          <option key={menuItem.id} value={menuItem.id}>
                            {menuItem.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        disabled={!connectionReady || saving !== null || !menuItems.length}
                        onClick={() => void saveCatalogMapping(catalogObject.id)}
                      >
                        {saving === `catalog-${catalogObject.id}` ? "Saving..." : "Save mapping"}
                      </Button>
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-2xl border border-dashed border-line bg-slate-50 px-4 py-8 text-sm text-muted">Sync catalog data to start mapping menu items.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="Sync range" description="Orders sync uses a simple manual date range in the pilot workspace." />
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="text-sm font-semibold text-ink">Start at</span>
                <input className="input mt-1" type="datetime-local" value={rangeStartAt} onChange={(event) => setRangeStartAt(event.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink">End at</span>
                <input className="input mt-1" type="datetime-local" value={rangeEndAt} onChange={(event) => setRangeEndAt(event.target.value)} />
              </label>
              <p className="text-sm leading-6 text-muted">
                Orders sync is for review only. The workspace shows imported sales summaries and mapping coverage before any close is finalized.
              </p>
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Coverage snapshot" description="What is ready, what is mapped, and what still needs work." />
            <div className="mt-4 grid gap-3">
              <MetricCard label="Locations mapped" value={totalMappedLocations} detail="Square locations matched to Flowtally locations." tone={mappedLocations === squareLocations.length && squareLocations.length > 0 ? "success" : "warning"} />
              <MetricCard label="Menu items mapped" value={totalMappedMenus} detail="Sellable Square item variations linked to menu items." tone={mappedMenus === mappingCoverage.totalVariationCount && mappingCoverage.totalVariationCount > 0 ? "success" : "warning"} />
              <MetricCard label="Daily sales summaries" value={formatNumber(dailySales.length)} detail="Recent Square sales summaries imported for the close." />
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Usage variance" description="A fast look at sales import health and any strange sync states." />
            <div className="mt-4 space-y-3">
              {syncJobs.length ? syncJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{job.jobType}</p>
                      <p className="mt-1 text-xs text-muted">{job.requestedAt ? formatDateTime(job.requestedAt) : "No timestamp"}</p>
                    </div>
                    <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                  </div>
                  {job.errorMessage ? <p className="mt-2 text-sm text-rose-700">{job.errorMessage}</p> : null}
                </div>
              )) : (
                <p className="rounded-2xl border border-dashed border-line bg-slate-50 px-4 py-8 text-sm text-muted">Sync jobs will appear here after a Square sync runs.</p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Sales summary" description="Recent imported sales by location." />
            <div className="mt-4 space-y-3">
              {dailySales.length ? dailySales.slice(0, 6).map((entry) => (
                <div key={`${entry.saleDate}-${entry.squareLocationId}`} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{entry.saleDate}</p>
                      <p className="mt-1 text-xs text-muted">{entry.squareLocationId || "Unmapped location"} · {formatNumber(entry.orderCount)} orders</p>
                    </div>
                    <p className="text-sm font-bold text-ink">{formatMoney(entry.netAmount)}</p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm text-muted">
                    <SummaryRow label="Refunds" value={formatMoney(entry.refundAmount)} />
                    <SummaryRow label="Tips" value={formatMoney(entry.tipAmount)} />
                    <SummaryRow label="Cancelled" value={formatNumber(entry.cancelledOrderCount)} />
                  </div>
                </div>
              )) : (
                <p className="rounded-2xl border border-dashed border-line bg-slate-50 px-4 py-8 text-sm text-muted">No sales summaries imported yet.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-6">
        <SectionHeader title="Menu and usage notes" description="A small, practical reminder for the pilot workspace." />
        <p className="mt-2 text-sm leading-7 text-muted">
          Keep the Square side simple: connect the account, sync the day, map the items that matter, and then open the daily close to reconcile the totals.
        </p>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "orange";
}) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{detail}</p>
    </div>
  );
}
