import { AlertTriangle, Plug, RefreshCw } from "lucide-react";
import { Link, Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { PilotCloverConnection } from "./PilotCloverConnection";
import { PilotSquarePage } from "./PilotSquarePage";
import { usePilotSession } from "./PilotSessionProvider";
import { usePosProvider, type PosProviderResolution } from "./pos/posProvider";

type PosContext = { resolution: PosProviderResolution };

function usePosResolution() {
  return useOutletContext<PosContext>().resolution;
}

/** Resolves the active POS provider once for the selected location, then renders the matching child route. */
export function PilotPosLayout() {
  const { currentLocation } = usePilotSession();
  const state = usePosProvider();

  if (state.status === "loading") {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Card className="workspace-card"><p className="text-sm text-muted">Checking this location&apos;s point-of-sale connection…</p></Card>
      </div>
    );
  }
  if (state.status === "no-location") {
    return (
      <Card className="workspace-card">
        <h1 className="text-xl font-bold text-ink">POS</h1>
        <p className="mt-2 text-sm text-muted">Select a restaurant location to see its point-of-sale connection.</p>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card className="workspace-card">
        <h1 className="text-xl font-bold text-ink">POS</h1>
        <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Flowtally could not confirm which point-of-sale system {currentLocation?.name ?? "this location"} uses, so no provider is shown. Nothing was changed. {state.message}
        </p>
        <Button className="mt-3" variant="secondary" type="button" onClick={state.reload}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
      </Card>
    );
  }
  return <Outlet context={{ resolution: state.resolution } satisfies PosContext} />;
}

const cardLink = "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white shadow-soft transition";

/** /app/pos: forwards to the provider workspace, or shows onboarding / conflict. */
export function PilotPosEntry() {
  const resolution = usePosResolution();
  const { currentLocation } = usePilotSession();
  const routerLocation = useLocation();
  const carry = `${routerLocation.search}${routerLocation.hash}`;

  if (resolution.kind === "square") return <Navigate to={`/app/pos/square${carry}`} replace />;
  if (resolution.kind === "clover") return <Navigate to={`/app/pos/clover${carry}`} replace />;
  // A Clover-initiated launch must reach Clover setup even before this location is mapped.
  if (resolution.kind === "unconnected" && resolution.cloverAvailable && new URLSearchParams(routerLocation.search).get("cloverLaunch") === "1") {
    return <Navigate to={`/app/pos/clover${carry}`} replace />;
  }
  const name = currentLocation?.name ?? "this location";

  if (resolution.kind === "conflict") {
    return (
      <Card className="workspace-card">
        <h1 className="text-xl font-bold text-ink">POS</h1>
        <div role="alert" className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Conflicting point-of-sale setup</p>
          <p className="mt-1">Both Square and Clover are connected and mapped to {name}. A location can use only one point-of-sale provider, so Flowtally is not showing either workspace. Nothing was disconnected or changed.</p>
          <p className="mt-2">Ask the account owner to disconnect the provider this location no longer uses, then reload this page.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title="Connect your point-of-sale" description={`${name} is not connected to a point-of-sale yet. Choose the system this location uses.`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="workspace-card" data-testid="pos-option-square">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Square</h2>
            {resolution.squareOrgConnected ? <Badge tone="success">Connected to your organization</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-muted">Import sales, map menu items to recipes and keep usage and Daily Close current.</p>
          <div className="mt-4"><Link className={cardLink} to="/app/pos/square"><Plug className="h-4 w-4" />{resolution.squareOrgConnected ? `Set up Square for ${name}` : "Set up Square"}</Link></div>
        </Card>
        {resolution.cloverAvailable ? (
          <Card className="workspace-card" data-testid="pos-option-clover">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold text-ink">Clover</h2>
              {resolution.cloverOrgConnected ? <Badge tone="success">Connected to your organization</Badge> : <Badge tone="neutral">Sandbox</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted">Sandbox preview with explicit menu mapping. Sales synchronization is not available yet.</p>
            <div className="mt-4"><Link className={cardLink} to="/app/pos/clover"><Plug className="h-4 w-4" />{resolution.cloverOrgConnected ? `Set up Clover for ${name}` : "Set up Clover"}</Link></div>
          </Card>
        ) : resolution.cloverRestricted ? (
          <Card className="workspace-card" data-testid="pos-option-clover-restricted">
            <h2 className="text-lg font-bold text-ink">Clover</h2>
            <p className="mt-2 text-sm text-muted">Clover setup is managed by the organization owner. Ask them if this location uses Clover.</p>
          </Card>
        ) : null}
      </div>
      <p className="text-xs text-muted">Flowtally never switches or disconnects a point-of-sale automatically. Each location uses one provider.</p>
    </div>
  );
}

/** /app/pos/square: Square workspace; never shown for a location that uses Clover or is in conflict. */
export function PilotPosSquareRoute() {
  const resolution = usePosResolution();
  if (resolution.kind === "clover" || resolution.kind === "conflict") return <Navigate to="/app/pos" replace />;
  return <PilotSquarePage />;
}

/** /app/pos/clover: Clover workspace; never shown for a Square or conflicting location. */
export function PilotPosCloverRoute() {
  const resolution = usePosResolution();
  const { currentLocation } = usePilotSession();
  if (resolution.kind === "square" || resolution.kind === "conflict" || !resolution.cloverAvailable) return <Navigate to="/app/pos" replace />;
  return (
    <div className="space-y-4">
      <SectionHeader title="Clover" description={`Point-of-sale workspace for ${currentLocation?.name ?? "this location"}.`} />
      <PilotCloverConnection />
    </div>
  );
}

/** Backward-compatible /app/square: keeps query and hash (OAuth callback params) and lets the resolver choose. */
export function PilotLegacySquareRedirect() {
  const routerLocation = useLocation();
  return <Navigate to={`/app/pos${routerLocation.search}${routerLocation.hash}`} replace />;
}
