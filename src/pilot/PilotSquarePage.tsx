import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Send } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { usePilotSession } from "./PilotSessionProvider";
import { demoReadOnly } from "./pilotConfig";
import {
  beginPilotSquareConnection,
  disconnectPilotSquare,
  fetchPilotSquareStatus,
  fetchPilotSquareCatalogMappings,
  previewPilotSquareMenuImport,
  importPilotSquareMenu,
  fetchPilotMenuCosting,
  syncPilotSquareCatalog,
  syncPilotSquareLocations,
  syncPilotSquareOrders,
  updatePilotSquareCatalogMapping,
  updatePilotSquareLocationMapping,
  type PilotMenuCostingResponse,
  type PilotSquareConnectionSummary,
} from "./pilotApi";
import { formatDate, formatDateTime, formatMoney, formatNumber, statusTone } from "./workspace/pilotWorkspaceUtils";
import { locationDateKey } from "./workspace/timezone";

function resolvedCatalogMapping(candidate: { mapping?: { flowtallyEntityId?: string | null } | null; flowtallyEntityId?: string | null }) {
  return candidate.mapping ?? (candidate.flowtallyEntityId !== undefined ? candidate : null);
}

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

export function squareConnectionDetail(connectionReady: boolean, isDemo: boolean) {
  if (isDemo) {
    return connectionReady
      ? "Simulated Square connection for this public demo; no merchant account is connected."
      : "The demo connection is unavailable. Real merchant connections are not used here.";
  }
  return connectionReady ? "Connected Square merchant; imported sales are available." : "No Square merchant is connected.";
}

export function PilotSquarePage() {
  const location = useLocation();
  const { organization, locations, currentLocation } = usePilotSession();
  const [connection, setConnection] = useState<PilotSquareConnectionSummary | null>(null);
  const [catalogMappings, setCatalogMappings] = useState<Awaited<ReturnType<typeof fetchPilotSquareCatalogMappings>>["mappings"]>([]);
  const [catalogSelections, setCatalogSelections] = useState<Record<number, string>>({});
  const [mappingCoverage, setMappingCoverage] = useState<Awaited<ReturnType<typeof fetchPilotSquareCatalogMappings>>["mappingCoverage"]>({ mappedVariationCount: 0, totalVariationCount: 0, mappedPercent: 0 });
  const [menuCosting, setMenuCosting] = useState<PilotMenuCostingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeStartAt, setRangeStartAt] = useState(dateRangeDefaults().startAt);
  const [rangeEndAt, setRangeEndAt] = useState(dateRangeDefaults().endAt);
  const [message, setMessage] = useState<string | null>(null);
  const [menuImport, setMenuImport] = useState<Awaited<ReturnType<typeof previewPilotSquareMenuImport>> | null>(null);
  const [menuImportLoading, setMenuImportLoading] = useState(false);
  const loadGeneration = useRef(0);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("error");
    const messages: Record<string, string> = {
      square_service_not_authorized: "Square rejected the application credentials. Check the Production application configuration and try again.",
      square_unauthorized: "Square could not authorize this connection. Check the Production application configuration and try again.",
      square_token_exchange_failed: "Square authorization could not be completed. Try again or contact support.",
      square_sync_failed: "Square authorized the connection, but the initial import could not be completed. Try again.",
      square_authorization_denied: "Square authorization was cancelled.",
    };
    if (code && messages[code]) {
      setError(messages[code]);
    }
  }, [location.search]);

  const currentOrganizationId = organization?.id ?? null;

  const load = async () => {
    if (!currentOrganizationId) {
      return;
    }

    setLoading(true);
    setError(null);
    const generation = ++loadGeneration.current;
    const isCurrent = () => generation === loadGeneration.current;
    const failures: string[] = [];
    const loadSection = async <T,>(request: Promise<T>, onSuccess: (value: T) => void) => {
      try {
        const value = await request;
        if (isCurrent()) onSuccess(value);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : "Could not load Square.");
      }
    };
    await Promise.all([
      loadSection(fetchPilotSquareStatus(currentOrganizationId), (status) => setConnection(status.connection)),
      loadSection(fetchPilotMenuCosting(), setMenuCosting),
      loadSection(fetchPilotSquareCatalogMappings(currentOrganizationId), (mappingResponse) => {
        const rows = mappingResponse.mappings.length ? mappingResponse.mappings : mappingResponse.unmappedVariations;
        setCatalogMappings(rows);
        setCatalogSelections(Object.fromEntries(rows.map((row) => [row.id, resolvedCatalogMapping(row)?.flowtallyEntityId ?? ""])));
        setMappingCoverage(mappingResponse.mappingCoverage);
      }),
    ]);
    if (isCurrent() && failures.length) setError(failures.join(" "));
    if (isCurrent()) setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId]);

  const squareLocations = connection?.locations ?? [];
  const dailySales = connection?.dailySales ?? [];
  const syncJobs = connection?.syncJobs ?? [];
  const recentOrders = [...(connection?.orders ?? [])]
    .filter((order) => !order.isDeleted && ["COMPLETED", "CANCELED", "CANCELLED", "REFUNDED"].includes(String(order.orderState || "").toUpperCase()))
    .sort((left, right) => new Date(right.orderedAt || right.closedAt || 0).getTime() - new Date(left.orderedAt || left.closedAt || 0).getTime());
  const businessTimezone = currentLocation?.timezone || "UTC";
  const recentSales = (() => {
    const summaries = new Map(dailySales.map((entry) => [entry.saleDate, entry]));
    const dates = new Set([
      ...dailySales.map((entry) => entry.saleDate),
      ...recentOrders.map((order) => locationDateKey(order.orderedAt || order.closedAt, businessTimezone)).filter(Boolean),
    ]);
    return [...dates].sort((left, right) => right.localeCompare(left)).map((date) => ({
      date,
      summary: summaries.get(date) ?? null,
      orders: recentOrders.filter((order) => locationDateKey(order.orderedAt || order.closedAt, businessTimezone) === date),
    }));
  })();
  const menuItems = menuCosting?.menuItems ?? [];
  const mappedLocations = squareLocations.filter((location) => location.mappings.some((mapping) => mapping.restaurantLocationId)).length;
  const mappedMenus = mappingCoverage.mappedVariationCount;
  const connectionReady = connection?.status === "connected";
  const initialLoading = loading && !connection && !menuCosting;

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

  const reviewMenuImport = async () => {
    if (!currentOrganizationId || !currentLocation?.id || !connectionReady) return;
    setMenuImportLoading(true);
    setError(null);
    try {
      setMenuImport(await previewPilotSquareMenuImport(currentOrganizationId, currentLocation.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review the Square menu import.");
    } finally {
      setMenuImportLoading(false);
    }
  };

  const runMenuImport = async () => {
    if (!currentOrganizationId || !currentLocation?.id || !connectionReady) return;
    setMenuImportLoading(true);
    setError(null);
    try {
      setMenuImport(await importPilotSquareMenu(currentOrganizationId, currentLocation.id));
      await load();
      setMessage("Square menu import completed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import the Square menu.");
    } finally {
      setMenuImportLoading(false);
    }
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
  const totalMappedLocations = initialLoading ? "—" : squareLocations.length > 0 ? `${mappedLocations}/${squareLocations.length}` : "0";
  const totalMappedMenus = initialLoading ? "—" : mappingCoverage.totalVariationCount > 0 ? `${mappedMenus}/${mappingCoverage.totalVariationCount}` : "0";

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
    <div className="workspace-page">
      <Card className="surface-panel workspace-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Square</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Square</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="h-4 w-4" />} type="button" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            {connectionReady ? (
              <Button
                icon={<Send className="h-4 w-4" />}
                type="button"
                disabled={demoReadOnly}
                title={demoReadOnly ? "Read-only demo" : undefined}
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
                disabled={demoReadOnly}
                title={demoReadOnly ? "Read-only demo" : undefined}
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
        {initialLoading ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-muted">
            Loading Square…
          </div>
        ) : loading ? (
          <p className="mt-3 text-xs font-medium text-muted" aria-live="polite">
            Refreshing Square data…
          </p>
        ) : null}
      </Card>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Connection", initialLoading ? "—" : connectionReady ? "Ready" : "Connect Square", connectionReady ? "success" : "warning"],
          ["Locations", initialLoading ? "—" : squareLocations.length ? `${mappedLocations}/${squareLocations.length} mapped` : "Sync locations", mappedLocations === squareLocations.length && squareLocations.length > 0 ? "success" : "warning"],
          ["Menu import", initialLoading ? "—" : menuImport ? `${menuImport.summary.recipe_needed ?? 0} recipes needed` : "Review import", menuImport && (menuImport.summary.recipe_needed ?? 0) === 0 ? "success" : "warning"],
          ["Mapping health", initialLoading ? "—" : `${mappedMenus}/${mappingCoverage.totalVariationCount || 0} mapped`, mappedMenus === mappingCoverage.totalVariationCount && mappingCoverage.totalVariationCount > 0 ? "success" : "warning"],
          ["Sales sync", initialLoading ? "—" : connection?.syncStatus === "error" ? "Needs attention" : dailySales.length ? "Up to date" : "Sync sales", connection?.syncStatus === "error" ? "danger" : "success"],
        ].map(([label, value, tone]) => (
          <div key={label} className="square-status-card flex min-w-0 flex-col items-start gap-2 rounded-2xl border border-line bg-white p-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
            <Badge tone={tone as "success" | "warning" | "danger"}>{value}</Badge>
          </div>
        ))}
      </div>
<div className="flex flex-wrap gap-2">
        <Link aria-current="page" className={squareSectionLinkClasses(true)} to="/app/square">
          Setup & Sync
        </Link>
        <Link className={squareSectionLinkClasses(false)} to="/app/square-usage">
          Usage & Variance
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-4">
          <Card className="workspace-card">
            <SectionHeader title="Connection and sync" description="Connection state, sync controls, and the latest imported sales summary." />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Connection" value={connection?.status ?? "disconnected"} detail={squareConnectionDetail(connectionReady, demoReadOnly)} tone={squareStatusTone} />
              <MetricCard label="Sync" value={connection?.syncStatus ?? "idle"} detail={connection?.syncError ? connection.syncError : "Manual syncs are available when connected."} tone={connection?.syncStatus === "error" ? "danger" : "neutral"} />
              <MetricCard label="Last sync" value={connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "never"} detail="The newest location, catalog, or order sync time." tone="neutral" />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={demoReadOnly || !connectionReady || saving !== null}
                title={demoReadOnly ? "Read-only demo" : undefined}
                onClick={() => void syncNow()}
              >
                {saving === "sync-now" ? "Syncing..." : "Sync now"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={demoReadOnly || !connectionReady || saving !== null}
                title={demoReadOnly ? "Read-only demo" : undefined}
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
                disabled={demoReadOnly || !connectionReady || saving !== null}
                title={demoReadOnly ? "Read-only demo" : undefined}
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
                disabled={demoReadOnly || !connectionReady || saving !== null}
                title={demoReadOnly ? "Read-only demo" : undefined}
                onClick={() => void syncOrders()}
              >
                {saving === "orders-sync" ? "Syncing orders..." : "Sync orders"}
              </Button>
              {connectionReady ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={demoReadOnly || saving !== null}
                  title={demoReadOnly ? "Read-only demo" : undefined}
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

          </Card>

          <Card className="workspace-card">
            <SectionHeader title="Location mapping" description="Map Square locations to the active restaurant locations." />
            <div className="mt-4 space-y-3">
              {squareLocations.length ? squareLocations.map((location) => {
                const mapped = location.mappings.find((mapping) => mapping.restaurantLocationId) ?? null;
                return (
                  <div key={location.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{location.name}</p>
                        <p className="mt-1 text-xs text-muted">{location.status}</p>
                      </div>
                      <Badge tone={mapped ? "success" : "warning"}>{mapped ? "Mapped" : "Unmapped"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                      <select id={`pilot-square-location-${location.id}`} className="input" defaultValue={mapped?.restaurantLocationId ?? ""} disabled={demoReadOnly || !connectionReady}>
                        <option value="">Choose a Flowtally location</option>
                        {locations.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        disabled={demoReadOnly || !connectionReady || saving !== null || !locations.length}
                        title={demoReadOnly ? "Read-only demo" : undefined}
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

          <Card className="workspace-card">
            <SectionHeader title="Menu mapping" description="Map each Square variation to a Flowtally menu item. Recipes are assigned later in Menu Costing." />
            <div className="mt-4 space-y-3 max-h-[34rem] overflow-y-auto pr-1">
              {catalogMappings.length ? catalogMappings.slice(0, 16).map((catalogObject) => {
                const mapping = resolvedCatalogMapping(catalogObject);
                return (
                  <div key={catalogObject.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{catalogObject.squareObjectName || catalogObject.squareObjectId}</p>
                      </div>
                      <Badge tone={mapping?.flowtallyEntityId ? "success" : "warning"}>{mapping?.flowtallyEntityId ? "Mapped" : "Needs mapping"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                      <select id={`pilot-square-menu-item-${catalogObject.id}`} className="input" value={catalogSelections[catalogObject.id] ?? mapping?.flowtallyEntityId ?? ""} disabled={demoReadOnly || !connectionReady} onChange={(event) => setCatalogSelections((current) => ({ ...current, [catalogObject.id]: event.target.value }))}>
                        <option value="">Choose a Flowtally menu item</option>
                        {menuItems.map((menuItem) => (
                          <option key={menuItem.id} value={menuItem.id}>
                            {menuItem.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        disabled={demoReadOnly || !connectionReady || saving !== null || !menuItems.length}
                        title={demoReadOnly ? "Read-only demo" : undefined}
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

          <Card className="workspace-card">
            <SectionHeader title="Import Square menu" description="Review sellable Square items, then import them into Flowtally before assigning recipes in Menu Costing." />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={!connectionReady || !currentLocation || menuImportLoading} onClick={() => void reviewMenuImport()}>
                {menuImportLoading ? "Reviewing..." : "Review import"}
              </Button>
              <Button type="button" disabled={demoReadOnly || !connectionReady || !currentLocation || menuImportLoading || !menuImport} title={demoReadOnly ? "Read-only demo" : undefined} onClick={() => void runMenuImport()}>
                {menuImportLoading ? "Importing..." : "Import menu"}
              </Button>
              <Link className="inline-flex min-h-11 items-center rounded-2xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50" to="/app/menu-costing">Assign recipes in Menu Costing</Link>
            </div>
            {menuImport ? (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[["New", "new"], ["Already imported / existing", "mapped"], ["Recipe needed", "recipe_needed"], ["Inactive", "inactive"], ["Conflict", "conflict"]].map(([label, key]) => <div key={key} className="rounded-xl border border-line bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-lg font-bold text-ink">{menuImport.summary[key] ?? 0}</p></div>)}
                </div>
                <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {menuImport.entries.map((entry) => <div key={entry.squareCatalogObjectId} className="rounded-xl border border-line bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-ink">{entry.parentName ? `${entry.parentName} · ` : ""}{entry.name}</p><p className="mt-1 text-xs text-muted">{entry.sellingPrice ? formatMoney(entry.sellingPrice) : "Price not set"}{entry.menuItemId ? " · Already in Flowtally" : ""}</p></div><Badge tone={entry.state === "mapped" ? "success" : entry.state === "conflict" ? "danger" : "warning"}>{entry.state === "recipe_needed" ? "Recipe needed" : entry.state}</Badge></div></div>)}
                  {!menuImport.entries.length ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">No sellable Square variations found for this location.</p> : null}
                </div>
              </div>
            ) : <p className="mt-4 text-sm text-muted">Review the import to see what will be created or reused.</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="workspace-card">
            <SectionHeader title="Recent sales" description="Daily imported sales with the finalized transactions that make up each day." />
            <div className="mt-4 max-h-[42rem] space-y-5 overflow-y-auto pr-1">
              {recentSales.length ? recentSales.slice(0, 8).map(({ date, summary, orders }) => (
                <div key={date} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{formatDate(date)}</p>
                      <p className="mt-1 text-xs text-muted">{summary?.orderCount ?? orders.length} orders · {summary?.squareLocationId || "Imported Square sales"}</p>
                    </div>
                    <p className="text-sm font-bold text-ink">Net sales {formatMoney(summary?.netAmount ?? orders.reduce((total, order) => total + order.netAmount, 0))}</p>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-4">
                    <SummaryRow label="Refunds" value={formatMoney(summary?.refundAmount ?? orders.reduce((total, order) => total + order.refundAmount, 0))} />
                    <SummaryRow label="Tips" value={formatMoney(summary?.tipAmount ?? orders.reduce((total, order) => total + order.tipAmount, 0))} />
                    <SummaryRow label="Cancelled" value={formatNumber(summary?.cancelledOrderCount ?? orders.filter((order) => ["CANCELED", "CANCELLED"].includes(order.orderState.toUpperCase())).length)} />
                    <SummaryRow label="Gross" value={formatMoney(summary?.grossAmount ?? orders.reduce((total, order) => total + order.grossAmount, 0))} />
                  </div>
                  {orders.length ? (
                    <div className="mt-4 space-y-2 border-t border-line pt-3">
                      {orders.slice(0, 8).map((order) => {
                        const normalizedState = String(order.orderState || "").toUpperCase();
                        const label = normalizedState === "REFUNDED" || (normalizedState === "COMPLETED" && order.refundedAt) ? "Refunded" : ["CANCELED", "CANCELLED"].includes(normalizedState) ? "Cancelled" : "Completed";
                        return (
                          <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div className="min-w-0"><p className="font-semibold text-ink">{formatDateTime(order.orderedAt || order.closedAt)} · {order.lines.map((line) => `${line.name} ×${formatNumber(line.quantity)}`).join(" · ") || "No line items"}</p><p className="mt-1 text-xs text-muted">Square order {order.squareOrderId}</p></div>
                            <div className="flex items-center gap-2"><span className="font-semibold text-ink">{formatMoney(order.netAmount)} {order.currency}</span><Badge tone={label === "Cancelled" ? "danger" : label === "Refunded" ? "warning" : "success"}>{label}</Badge></div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )) : <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-muted">No imported Square sales yet.</p>}
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Sync range" description="Orders sync uses a simple manual date range for this restaurant." />
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

          <Card className="p-4">
            <SectionHeader title="Recent sync activity" description="Diagnostic sync history and failures." />
            <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
              {syncJobs.length ? syncJobs.slice(0, 3).map((job) => (
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-ink">{job.jobType}</span><Badge tone={statusTone(job.status)}>{job.status}</Badge><span className="text-xs text-muted">{job.requestedAt ? formatDateTime(job.requestedAt) : "No timestamp"}</span>
                  {job.errorMessage ? <span className="basis-full text-xs text-rose-700">{job.errorMessage}</span> : null}
                </div>
              )) : <p className="rounded-xl border border-dashed border-line bg-slate-50 px-3 py-4 text-sm text-muted">Sync jobs will appear here after a Square sync runs.</p>}
            </div>
          </Card>

        </div>
      </div>
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
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
        <span className="max-w-full break-words text-right"><Badge tone={tone}>{value}</Badge></span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{detail}</p>
    </div>
  );
}

