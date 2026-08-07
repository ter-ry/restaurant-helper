import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldAlert, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SupportAccessBanner } from "../components/SupportAccessBanner";
import { buildApiUrl } from "../lib/apiBase";
import { CustomerApiError, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";
import {
  beginSquareConnection,
  disconnectSquare,
  fetchSquareStatus,
  syncSquareCatalog,
  syncSquareLocations,
  syncSquareOrders,
  updateSquareCatalogMapping,
  updateSquareLocationMapping,
  type SquareConnectionSummary,
} from "../lib/squareIntegration";

type OrganizationBundle = {
  organization: { id: number; name: string; lifecycleStatus?: string; setupStatus?: string; subscriptionStatus?: string };
  restaurantLocations: Array<{ id: number; name: string; city?: string; region?: string }>;
  currentLocation: { id: number; name: string } | null;
  membershipRole?: string;
};

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), { credentials: "include", headers: { Accept: "application/json" } });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new CustomerApiError(payload?.error || `Request failed with status ${response.status}`, response.status);
  }
  return payload as T;
}

function readValue(id: string, fallback: string) {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? fallback;
}

function formatAmount(value: number | null | undefined) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value ?? 0));
}

function dateRangeDefaults() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  return {
    startAt: start.toISOString().slice(0, 19),
    endAt: end.toISOString().slice(0, 19),
  };
}

export function SquareIntegrationPage() {
  const [state, setState] = useState<"loading" | "signedOut" | "empty" | "ready" | "permissionDenied" | "error">("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [organizationBundle, setOrganizationBundle] = useState<OrganizationBundle | null>(null);
  const [connection, setConnection] = useState<SquareConnectionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [connectedNotice, setConnectedNotice] = useState(false);
  const [ordersStartAt, setOrdersStartAt] = useState(dateRangeDefaults().startAt);
  const [ordersEndAt, setOrdersEndAt] = useState(dateRangeDefaults().endAt);

  const restaurantLocations = organizationBundle?.restaurantLocations ?? [];
  const connectionLocations = connection?.locations ?? [];
  const catalogObjects = connection?.catalogObjects ?? [];
  const orders = connection?.orders ?? [];
  const dailySales = connection?.dailySales ?? [];
  const webhookEvents = connection?.webhookEvents ?? [];
  const syncJobs = connection?.syncJobs ?? [];

  const currentOrganizationId = organizationBundle?.organization.id ?? session?.currentOrganizationId ?? null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const currentSession = await fetchCustomerSession();
        if (cancelled) return;
        setSession(currentSession);
        const organization = await requestJson<OrganizationBundle>("/api/organizations/current");
        if (cancelled) return;
        setOrganizationBundle(organization);
        if (organization.organization.id) {
          const status = await fetchSquareStatus(organization.organization.id);
          if (cancelled) return;
          setConnection(status.connection);
        }
        setConnectedNotice(new URLSearchParams(window.location.search).get("connected") === "1");
        setState(organization.organization.id ? "ready" : "empty");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CustomerApiError && err.status === 401) {
          setState("signedOut");
          return;
        }
        if (err instanceof CustomerApiError && err.status === 404) {
          setState("empty");
          setOrganizationBundle(null);
          setConnection(null);
          return;
        }
        if (err instanceof CustomerApiError && err.status === 403) {
          setState("permissionDenied");
          setError(err.message);
          return;
        }
        setState("error");
        setError(err instanceof Error ? err.message : "Could not load Square integration.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadStatus() {
    if (!currentOrganizationId) return;
    const status = await fetchSquareStatus(currentOrganizationId);
    setConnection(status.connection);
  }

  async function runAction(label: string, action: () => Promise<{ connection: SquareConnectionSummary }>) {
    setSaving(label);
    setError(null);
    try {
      const result = await action();
      setConnection(result.connection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Square integration.");
    } finally {
      setSaving(null);
    }
  }

  async function saveLocationMapping(squareLocationId: number) {
    if (!currentOrganizationId) return;
    const restaurantLocationId = Number(readValue(`restaurant-location-${squareLocationId}`, ""));
    if (!Number.isFinite(restaurantLocationId) || restaurantLocationId <= 0) {
      setError("Choose a Flowtally location before saving the mapping.");
      return;
    }
    return runAction(`location-${squareLocationId}`, () =>
      updateSquareLocationMapping({
        organizationId: currentOrganizationId,
        squareLocationId,
        restaurantLocationId,
      }),
    );
  }

  async function saveCatalogMapping(catalogObjectId: number) {
    if (!currentOrganizationId) return;
    return runAction(`catalog-${catalogObjectId}`, () =>
      updateSquareCatalogMapping({
        organizationId: currentOrganizationId,
        squareCatalogObjectId: catalogObjectId,
        mappingType: readValue(`mapping-type-${catalogObjectId}`, "menu_item"),
        flowtallyEntityType: readValue(`entity-type-${catalogObjectId}`, ""),
        flowtallyEntityId: readValue(`entity-id-${catalogObjectId}`, ""),
        status: readValue(`mapping-status-${catalogObjectId}`, "mapped"),
      }),
    );
  }

  async function syncOrders() {
    if (!currentOrganizationId) return;
    return runAction("orders-sync", () =>
      syncSquareOrders({
        organizationId: currentOrganizationId,
        startAt: new Date(ordersStartAt).toISOString(),
        endAt: new Date(ordersEndAt).toISOString(),
      }),
    );
  }

  if (state === "loading") {
    return (
      <PageLayout title="Square Sandbox" eyebrow="Flowtally owner" description="Loading Square connection status.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading Square workspace…</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "signedOut") {
    return (
      <PageLayout title="Square Sandbox" eyebrow="Flowtally owner" description="Sign in to manage your Square connection.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-4 w-4 text-brand-700" />
            Sign in required
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Continue with Google</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Use your Flowtally account to connect Square Sandbox.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={startGoogleLogin}>
              Continue with Google
            </button>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
              Return home
            </Link>
          </div>
        </Card>
      </PageLayout>
    );
  }

  if (state === "empty") {
    return (
      <PageLayout title="Square Sandbox" eyebrow="Flowtally owner" description="Select or create an organization before connecting Square.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Workflow className="h-4 w-4 text-brand-700" />
            No organization selected
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Square connects to a specific organization</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Create or choose your Flowtally organization first, then return here to connect Square Sandbox.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" to="/auth/google/complete">
              Open onboarding
            </Link>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/platform/setup">
              Platform console
            </Link>
          </div>
        </Card>
      </PageLayout>
    );
  }

  if (state === "error") {
    return (
      <PageLayout title="Square Sandbox" eyebrow="Flowtally owner" description="Something went wrong while loading Square.">
        <Card className="border-rose-200 bg-rose-50 p-6 text-rose-950">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            Load error
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">We couldn’t load Square</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{error ?? "Try again in a moment."}</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "permissionDenied") {
    return (
      <PageLayout title="Square Sandbox" eyebrow="Flowtally owner" description="Square access is only available when the organization is active.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Permission denied
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Square is not available yet</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {error ?? "The organization must be active, setup-complete, and subscription-active before the owner can manage Square."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/platform/setup">
              Review setup
            </Link>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" to="/">
              Return home
            </Link>
          </div>
        </Card>
      </PageLayout>
    );
  }

  const connectionReady = Boolean(connection && connection.status === "connected");

  return (
    <PageLayout title="Square Sandbox" eyebrow={`Flowtally owner · ${organizationBundle?.organization.name ?? "organization"}`} description="Connect Square Sandbox, map locations and catalog objects, and sync orders for review.">
      {session?.supportAccessGrant ? <SupportAccessBanner grant={session.supportAccessGrant} /> : null}
      {connectedNotice ? (
        <Card className="mb-6 border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            Square connected successfully.
          </div>
        </Card>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Connection status</p>
              <h2 className="mt-2 text-3xl font-bold text-ink">Square Sandbox</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {connectionReady ? "Connected and ready to sync locations, catalog objects, and orders." : "Connect Square to begin sandbox synchronization."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void reloadStatus()} disabled={!currentOrganizationId}>
                <RefreshCw className="h-4 w-4" />
              </button>
              {connectionReady ? (
                <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-60" type="button" onClick={() => void runAction("disconnect", () => disconnectSquare(currentOrganizationId ?? 0))} disabled={saving === "disconnect" || !currentOrganizationId}>
                  {saving === "disconnect" ? "Disconnecting…" : "Disconnect"}
                </button>
              ) : (
                <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void beginSquareConnection(currentOrganizationId ?? 0)} disabled={!currentOrganizationId}>
                  Connect Square
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Merchant</p>
              <p className="mt-2 text-sm font-semibold text-ink">{connection?.squareMerchantId || "Not connected"}</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Sync status</p>
              <p className="mt-2 text-sm font-semibold text-ink">{connection?.syncStatus || "idle"}</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Catalog objects</p>
              <p className="mt-2 text-sm font-semibold text-ink">{connection?.catalogCount ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Orders</p>
              <p className="mt-2 text-sm font-semibold text-ink">{connection?.orderCount ?? 0}</p>
            </div>
          </div>
          {connection?.syncError ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{connection.syncError}</p> : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void runAction("locations-sync", () => syncSquareLocations(currentOrganizationId ?? 0))} disabled={!connectionReady || saving === "locations-sync"}>
              Sync locations
            </button>
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void runAction("catalog-sync", () => syncSquareCatalog(currentOrganizationId ?? 0))} disabled={!connectionReady || saving === "catalog-sync"}>
              Sync catalog
            </button>
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:opacity-60" type="button" onClick={() => void syncOrders()} disabled={!connectionReady || saving === "orders-sync"}>
              {saving === "orders-sync" ? "Syncing orders…" : "Sync orders"}
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-line bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ExternalLink className="h-4 w-4" />
              OAuth and webhook notes
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
              <li>Square uses the sandbox authorization domain when Flowtally runs in sandbox mode.</li>
              <li>Tokens stay encrypted on the server; the browser only sees connection status.</li>
              <li>Webhook processing is signature-verified before any order or catalog update is accepted.</li>
            </ul>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Orders sync</p>
              <h3 className="mt-2 text-xl font-bold text-ink">Review imported sales</h3>
            </div>
            <Workflow className="h-5 w-5 text-brand-700" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-ink">Start at</span>
              <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" type="datetime-local" value={ordersStartAt} onChange={(event) => setOrdersStartAt(event.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">End at</span>
              <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" type="datetime-local" value={ordersEndAt} onChange={(event) => setOrdersEndAt(event.target.value)} />
            </label>
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
            Orders are imported as Square sales data for review, not as finalized accounting records.
          </div>
          <div className="mt-5 space-y-3">
            {dailySales.length > 0 ? dailySales.slice(0, 6).map((entry) => (
              <div key={`${entry.saleDate}-${entry.squareLocationId}`} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{entry.saleDate}</p>
                    <p className="mt-1 text-xs text-muted">{entry.squareLocationId || "Unmapped location"} · {entry.orderCount} order(s)</p>
                  </div>
                  <p className="text-sm font-bold text-ink">{formatAmount(entry.netAmount)}</p>
                </div>
              </div>
            )) : <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No daily sales summaries yet.</p>}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-lg font-bold text-ink">Location mapping</h3>
          <p className="mt-2 text-sm leading-6 text-muted">Map Square locations to the restaurant locations Flowtally already knows about.</p>
          <div className="mt-4 space-y-3">
            {connectionLocations.length > 0 ? connectionLocations.map((location) => {
              const mapped = location.mappings.find((mapping) => mapping.restaurantLocationId) ?? null;
              return (
                <div key={location.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{location.name}</p>
                      <p className="mt-1 text-xs text-muted">{location.squareLocationId} · {location.status}</p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">{mapped ? "Mapped" : "Unmapped"}</span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <select id={`restaurant-location-${location.id}`} className="w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none" defaultValue={mapped?.restaurantLocationId ?? ""}>
                      <option value="">Choose a Flowtally location</option>
                      {restaurantLocations.map((restaurantLocation) => (
                        <option key={restaurantLocation.id} value={restaurantLocation.id}>
                          {restaurantLocation.name}
                        </option>
                      ))}
                    </select>
                    <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void saveLocationMapping(location.id)} disabled={saving === `location-${location.id}` || restaurantLocations.length === 0}>
                      {saving === `location-${location.id}` ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              );
            }) : <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Sync Square locations first to map them here.</p>}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold text-ink">Catalog mapping</h3>
          <p className="mt-2 text-sm leading-6 text-muted">Review Square items, variations, categories, modifiers, and taxes before mapping them to Flowtally concepts.</p>
          <div className="mt-4 space-y-3 max-h-[34rem] overflow-y-auto pr-1">
            {catalogObjects.length > 0 ? catalogObjects.slice(0, 16).map((catalogObject) => {
              const mapping = catalogObject.mappings[0] ?? null;
              return (
                <div key={catalogObject.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{catalogObject.objectType} · {catalogObject.squareObjectId}</p>
                      <p className="mt-1 text-xs text-muted">Version {catalogObject.version} · {catalogObject.isDeleted ? "Deleted" : "Active"}</p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">{mapping?.status ?? "unmapped"}</span>
                  </div>
                  <div className="mt-3 grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Mapping type</span>
                        <input id={`mapping-type-${catalogObject.id}`} className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none" defaultValue={mapping?.mappingType ?? "menu_item"} />
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Status</span>
                        <input id={`mapping-status-${catalogObject.id}`} className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none" defaultValue={mapping?.status ?? "mapped"} />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally entity type</span>
                        <input id={`entity-type-${catalogObject.id}`} className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none" defaultValue={mapping?.flowtallyEntityType ?? "menu_item"} />
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally entity id</span>
                        <input id={`entity-id-${catalogObject.id}`} className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none" defaultValue={mapping?.flowtallyEntityId ?? ""} />
                      </label>
                    </div>
                    <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void saveCatalogMapping(catalogObject.id)} disabled={saving === `catalog-${catalogObject.id}`}>
                      {saving === `catalog-${catalogObject.id}` ? "Saving…" : "Save mapping"}
                    </button>
                  </div>
                </div>
              );
            }) : <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Sync catalog data to start mapping items.</p>}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-lg font-bold text-ink">Recent orders</h3>
          <div className="mt-4 space-y-3">
            {orders.length > 0 ? orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{order.squareOrderId}</p>
                    <p className="mt-1 text-xs text-muted">{order.orderState} · {order.squareLocationId || "No location"}</p>
                  </div>
                  <p className="text-sm font-bold text-ink">{formatAmount(order.netAmount)}</p>
                </div>
                <p className="mt-2 text-xs text-muted">{order.lineCount} line(s) · {order.itemQuantity} item quantity</p>
              </div>
            )) : <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No orders imported yet.</p>}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold text-ink">Webhook health</h3>
          <p className="mt-2 text-sm leading-6 text-muted">Recent webhook events are stored server-side with their processing status.</p>
          <div className="mt-4 space-y-3">
            {webhookEvents.length > 0 ? webhookEvents.map((event) => (
              <div key={event.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{event.eventType}</p>
                    <p className="mt-1 text-xs text-muted">{event.eventId}</p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">{event.status}</span>
                </div>
                {event.errorMessage ? <p className="mt-2 text-sm text-rose-700">{event.errorMessage}</p> : null}
              </div>
            )) : <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No webhook events recorded yet.</p>}
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-white p-4 text-sm text-muted">
            Sync jobs recorded: {syncJobs.length} · Last sync:{connection?.lastSyncAt ?? "none"}
          </div>
        </Card>
      </div>
    </PageLayout>
  );
}
