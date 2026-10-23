import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { usePilotSession } from "./PilotSessionProvider";
import { beginPilotCloverConnection, disconnectPilotClover, fetchPilotCloverCatalog, fetchPilotCloverStatus, resumePilotCloverLaunch, type PilotCloverCatalogPreview, type PilotCloverConnectionSummary } from "./pilotApi";
import { demoReadOnly } from "./pilotConfig";

export function PilotCloverConnection() {
  const { organization, user } = usePilotSession();
  const location = useLocation();
  const [connection, setConnection] = useState<PilotCloverConnectionSummary | null>(null);
  const [connectionOrganizationId, setConnectionOrganizationId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [statusOrganizationId, setStatusOrganizationId] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<{ organizationId: number; data: PilotCloverCatalogPreview } | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusRequestId = useRef(0);
  const catalogRequestId = useRef(0);
  const activeOrganizationId = useRef<number | null>(null);
  const organizationId = organization?.id ?? null;
  const userId = user?.id ?? null;
  const launchedFromClover = new URLSearchParams(location.search).get("cloverLaunch") === "1";

  const clearCatalog = useCallback(() => {
    catalogRequestId.current += 1;
    setCatalog(null);
    setCatalogLoading(false);
  }, []);

  const load = useCallback(async () => {
    const requestedOrganizationId = organizationId;
    const requestId = ++statusRequestId.current;
    activeOrganizationId.current = requestedOrganizationId;
    setStatusOrganizationId(null);
    setConnectionOrganizationId(null);
    setConnection(null);
    setEnabled(false);
    setCatalogEnabled(false);
    clearCatalog();
    setError(null);

    if (!requestedOrganizationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchPilotCloverStatus(requestedOrganizationId);
      if (statusRequestId.current !== requestId || activeOrganizationId.current !== requestedOrganizationId) return;
      setStatusOrganizationId(requestedOrganizationId);
      setEnabled(result.enabled);
      setCatalogEnabled(Boolean(result.catalogEnabled));
      setConnectionOrganizationId(requestedOrganizationId);
      setConnection(result.connection);
      if (!result.enabled || !result.catalogEnabled || !result.connection || result.connection.status !== "connected") {
        clearCatalog();
      }
    } catch (err) {
      if (statusRequestId.current !== requestId || activeOrganizationId.current !== requestedOrganizationId) return;
      setStatusOrganizationId(requestedOrganizationId);
      setConnectionOrganizationId(requestedOrganizationId);
      setEnabled(false);
      setCatalogEnabled(false);
      setConnection(null);
      clearCatalog();
      setError(err instanceof Error ? err.message : "Could not load Clover status.");
    } finally {
      if (statusRequestId.current === requestId && activeOrganizationId.current === requestedOrganizationId) {
        setLoading(false);
      }
    }
  }, [clearCatalog, organizationId]);

  useEffect(() => {
    void load();
    return () => {
      statusRequestId.current += 1;
      catalogRequestId.current += 1;
      activeOrganizationId.current = null;
    };
  }, [load, userId]);

  const loadCatalog = async () => {
    const currentConnection = connectionOrganizationId === organizationId ? connection : null;
    if (!organizationId || statusOrganizationId !== organizationId || !catalogEnabled || currentConnection?.status !== "connected") return;
    const requestedOrganizationId = organizationId;
    const requestId = ++catalogRequestId.current;
    setCatalogLoading(true);
    setError(null);
    try {
      const result = await fetchPilotCloverCatalog(requestedOrganizationId);
      if (catalogRequestId.current !== requestId || activeOrganizationId.current !== requestedOrganizationId || connectionOrganizationId !== requestedOrganizationId) return;
      setCatalog({ organizationId: requestedOrganizationId, data: result });
    } catch (err) {
      if (catalogRequestId.current !== requestId || activeOrganizationId.current !== requestedOrganizationId) return;
      setError(err instanceof Error ? err.message : "Could not load the Clover catalog preview.");
    } finally {
      if (catalogRequestId.current === requestId) setCatalogLoading(false);
    }
  };

  if (!organizationId || (statusOrganizationId === organizationId && !enabled)) return null;
  const currentConnection = connectionOrganizationId === organizationId ? connection : null;
  const currentCatalog = catalog?.organizationId === organizationId ? catalog.data : null;
  const connected = currentConnection?.status === "connected";
  const expired = currentConnection?.status === "reauthorization_required";
  const statusReady = statusOrganizationId === organizationId;

  return (
    <Card className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Clover sandbox</p>
          <h2 className="mt-1 text-lg font-bold text-ink">Connection</h2>
          <p className="mt-1 text-sm text-muted">Connection only. Clover catalog and sales sync are not enabled.</p>
        </div>
        <Badge tone={!statusReady || loading ? "neutral" : connected ? "success" : expired ? "warning" : "neutral"}>
          {!statusReady || loading ? "Checking" : connected ? "Connected" : expired ? "Reauthorization required" : "Disconnected"}
        </Badge>
      </div>
      {error ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
      {launchedFromClover ? (
        <div className="mt-4 rounded-xl border border-line bg-slate-50 p-3 text-sm text-muted">
          <p className="font-semibold text-ink">Clover launched Flowtally</p>
          <p className="mt-1">Confirm this selected organization before continuing to Clover authorization.</p>
          <Button className="mt-3" type="button" disabled={demoReadOnly || busy} onClick={() => void resumePilotCloverLaunch(organizationId)}>
            <ExternalLink className="mr-2 h-4 w-4" />Continue Clover setup
          </Button>
        </div>
      ) : null}
      {connected ? (
        <div className="mt-4 space-y-2 text-sm text-muted">
          <p><span className="font-semibold text-ink">Merchant:</span> {currentConnection?.merchantName || currentConnection?.merchantId}</p>
          <p><span className="font-semibold text-ink">Environment:</span> {currentConnection?.environment}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={demoReadOnly || busy} onClick={() => void beginPilotCloverConnection(organizationId)}><ExternalLink className="mr-2 h-4 w-4" />Reconnect</Button>
            <Button type="button" variant="ghost" disabled={demoReadOnly || busy} onClick={async () => {
              const requestedOrganizationId = organizationId;
              catalogRequestId.current += 1;
              setCatalog(null);
              setCatalogLoading(false);
              setBusy(true);
              try {
                const result = await disconnectPilotClover(requestedOrganizationId);
                if (activeOrganizationId.current === requestedOrganizationId && organizationId === requestedOrganizationId) {
                  setConnectionOrganizationId(requestedOrganizationId);
                  setConnection(result.connection);
                  clearCatalog();
                }
              } catch (err) {
                if (activeOrganizationId.current === requestedOrganizationId) setError(err instanceof Error ? err.message : "Could not disconnect Clover.");
              } finally {
                setBusy(false);
              }
            }}><Unplug className="mr-2 h-4 w-4" />Disconnect</Button>
            {catalogEnabled ? <Button type="button" variant="secondary" disabled={catalogLoading || busy} onClick={() => void loadCatalog()}><RefreshCw className="mr-2 h-4 w-4" />{catalogLoading ? "Loading catalog…" : "Preview catalog"}</Button> : null}
          </div>
          {currentCatalog ? (
            <div className="mt-4 rounded-xl border border-line bg-slate-50 p-3" role="region" aria-label="Clover catalog preview">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold text-ink">Read-only catalog preview</p><p className="text-xs text-muted">{currentCatalog.itemCount} items{currentCatalog.location ? " · " + currentCatalog.location.name : ""}</p></div>
                <Badge tone="neutral">No changes</Badge>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {currentCatalog.items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink">{item.name}</span><span className="text-muted">{item.priceCents == null ? "Price unavailable" : "$" + (item.priceCents / 100).toFixed(2)}</span></div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">{item.itemGroupId ? <span>Item group: {item.itemGroupId}</span> : null}{item.optionIds.length ? <span>Options: {item.optionIds.join(", ")}</span> : null}{item.categories.length ? <span>{item.categories.map((category) => category.name).join(", ")}</span> : null}{item.modifierGroups.length ? <span>Modifiers: {item.modifierGroups.flatMap((group) => group.modifiers.map((modifier) => modifier.name)).join(", ") || `${item.modifierGroups.length} modifier group${item.modifierGroups.length === 1 ? "" : "s"}`}</span> : null}{item.deleted ? <Badge tone="danger">Deleted</Badge> : item.hidden ? <Badge tone="warning">Hidden</Badge> : item.available === false ? <Badge tone="warning">Unavailable</Badge> : null}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={demoReadOnly || busy} onClick={() => void beginPilotCloverConnection(organizationId)}><ExternalLink className="mr-2 h-4 w-4" />Connect Clover sandbox</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      )}
    </Card>
  );
}
