import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { usePilotSession } from "./PilotSessionProvider";
import { beginPilotCloverConnection, disconnectPilotClover, fetchPilotCloverStatus, type PilotCloverConnectionSummary } from "./pilotApi";
import { demoReadOnly } from "./pilotConfig";

export function PilotCloverConnection() {
  const { organization } = usePilotSession();
  const [connection, setConnection] = useState<PilotCloverConnectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = organization?.id ?? null;

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const result = await fetchPilotCloverStatus(organizationId);
      setConnection(result.connection);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Clover status.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  if (!organizationId) return null;
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
      {connected ? (
        <div className="mt-4 space-y-2 text-sm text-muted">
          <p><span className="font-semibold text-ink">Merchant:</span> {connection?.merchantName || connection?.merchantId}</p>
          <p><span className="font-semibold text-ink">Environment:</span> {connection?.environment}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={demoReadOnly || busy} onClick={() => void beginPilotCloverConnection(organizationId)}><ExternalLink className="mr-2 h-4 w-4" />Reconnect</Button>
            <Button type="button" variant="ghost" disabled={demoReadOnly || busy} onClick={async () => { setBusy(true); try { const result = await disconnectPilotClover(organizationId); setConnection(result.connection); } catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect Clover."); } finally { setBusy(false); } }}><Unplug className="mr-2 h-4 w-4" />Disconnect</Button>
          </div>
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
