import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { usePilotSession } from "./PilotSessionProvider";
import { beginPilotCloverConnection, disconnectPilotClover, fetchPilotCloverCatalog, fetchPilotCloverStatus, resumePilotCloverLaunch, type PilotCloverCatalogPreview, type PilotCloverConnectionSummary } from "./pilotApi";
import { demoReadOnly } from "./pilotConfig";

export function PilotCloverConnection() {
  const { organization } = usePilotSession();
  const location = useLocation();
  const [connection, setConnection] = useState<PilotCloverConnectionSummary | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [catalog, setCatalog] = useState<PilotCloverCatalogPreview | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = organization?.id ?? null;
  const launchedFromClover = new URLSearchParams(location.search).get("cloverLaunch") === "1";

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const result = await fetchPilotCloverStatus(organizationId);
      setEnabled(result.enabled);
      setCatalogEnabled(Boolean(result.catalogEnabled));
      setConnection(result.connection);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Clover status.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const loadCatalog = async () => {
    if (!organizationId || !catalogEnabled || connection?.status !== "connected") return;
    setCatalogLoading(true);
    setError(null);
    try {
      setCatalog(await fetchPilotCloverCatalog(organizationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the Clover catalog preview.");
    } finally {
      setCatalogLoading(false);
    }
  };

  if (!organizationId || !enabled) return null;
  const connected = connection?.status === "connected";
  const expired = connection?.status === "reauthorization_required";
  return (
    <Card className="workspace-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Clover sandbox</p>
          <h2 className="mt-1 text-lg font-bold text-ink">Connection</h2>
          <p className="mt-1 text-sm text-muted">Connection only. Clover catalog and sales sync are not enabled.</p>
        </div>
        <Badge tone={loading ? "neutral" : connected ? "success" : expired ? "warning" : "neutral"}>
          {loading ? "Checking" : connected ? "Connected" : expired ? "Reauthorization required" : "Disconnected"}
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
          <p><span className="font-semibold text-ink">Merchant:</span> {connection?.merchantName || connection?.merchantId}</p>
          <p><span className="font-semibold text-ink">Environment:</span> {connection?.environment}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={demoReadOnly || busy} onClick={() => void beginPilotCloverConnection(organizationId)}><ExternalLink className="mr-2 h-4 w-4" />Reconnect</Button>
            <Button type="button" variant="ghost" disabled={demoReadOnly || busy} onClick={async () => { setBusy(true); try { const result = await disconnectPilotClover(organizationId); setConnection(result.connection); setCatalog(null); } catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect Clover."); } finally { setBusy(false); } }}><Unplug className="mr-2 h-4 w-4" />Disconnect</Button>
            {catalogEnabled ? <Button type="button" variant="secondary" disabled={catalogLoading || busy} onClick={() => void loadCatalog()}><RefreshCw className="mr-2 h-4 w-4" />{catalogLoading ? "Loading catalog…" : "Preview catalog"}</Button> : null}
          </div>
          {catalog ? (
            <div className="mt-4 rounded-xl border border-line bg-slate-50 p-3" role="region" aria-label="Clover catalog preview">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold text-ink">Read-only catalog preview</p><p className="text-xs text-muted">{catalog.itemCount} items{catalog.location ? " · " + catalog.location.name : ""}</p></div>
                <Badge tone="neutral">No changes</Badge>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {catalog.items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink">{item.name}</span><span className="text-muted">{item.priceCents == null ? "Price unavailable" : "$" + (item.priceCents / 100).toFixed(2)}</span></div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">{item.itemGroupId ? <span>Item group: {item.itemGroupId}</span> : null}{item.categories.length ? <span>{item.categories.map((category) => category.name).join(", ")}</span> : null}{item.modifierGroups.length ? <span>{item.modifierGroups.length} modifier group{item.modifierGroups.length === 1 ? "" : "s"}</span> : null}{item.deleted ? <Badge tone="danger">Deleted</Badge> : item.hidden ? <Badge tone="warning">Hidden</Badge> : item.available === false ? <Badge tone="warning">Unavailable</Badge> : null}</div>
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
