import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import {
  deletePilotCloverLocationMapping,
  deletePilotCloverMenuMapping,
  fetchPilotCloverMappings,
  fetchPilotMenuCosting,
  savePilotCloverLocationMapping,
  savePilotCloverMenuMapping,
  type PilotCloverCatalogPreview,
  type PilotCloverMenuMapping,
} from "./pilotApi";
import { usePilotSession } from "./PilotSessionProvider";

export function PilotCloverMappingPanel({ organizationId, catalog }: { organizationId: number; catalog: PilotCloverCatalogPreview }) {
  const { locations, currentLocation } = usePilotSession();
  const [locationId, setLocationId] = useState(currentLocation?.id ?? locations[0]?.id ?? 0);
  const [locationMapping, setLocationMapping] = useState<{ id: number; restaurantLocationId: number; cloverLocationId: string | null } | null>(null);
  const [mappings, setMappings] = useState<PilotCloverMenuMapping[]>([]);
  const [menuItems, setMenuItems] = useState<Array<{ id: number; name: string; recipe: unknown }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const basicItems = useMemo(
    () => catalog.items.filter((item) => !item.deleted && !item.itemGroupId && item.optionIds.length === 0 && item.modifierGroups.length === 0),
    [catalog.items],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchPilotCloverMappings(organizationId, locationId), fetchPilotMenuCosting()])
      .then(([mappingResult, costing]) => {
        if (!active) return;
        setLocationMapping(mappingResult.locationMapping);
        setMappings(mappingResult.menuMappings);
        setMenuItems(costing.menuItems.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, recipe: item.recipe })));
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load Clover mappings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, locationId]);

  async function confirmLocation() {
    setBusy(true); setError(null);
    try {
      const result = await savePilotCloverLocationMapping(organizationId, locationId, catalog.location?.id ?? null);
      setLocationMapping(result.locationMapping);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the Clover location association."); }
    finally { setBusy(false); }
  }

  async function saveItem(itemId: string, menuItemId: number, existing?: PilotCloverMenuMapping) {
    setBusy(true); setError(null);
    try {
      const result = await savePilotCloverMenuMapping({ organizationId, locationId, cloverItemId: itemId, flowtallyMenuItemId: menuItemId, ...(existing ? { mappingId: existing.id } : {}) });
      setMappings((current) => [...current.filter((value) => value.id !== result.mapping.id), result.mapping]);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the Clover menu mapping."); }
    finally { setBusy(false); }
  }

  async function removeMapping(mapping: PilotCloverMenuMapping) {
    setBusy(true); setError(null);
    try {
      await deletePilotCloverMenuMapping(organizationId, mapping.id);
      setMappings((current) => current.filter((value) => value.id !== mapping.id));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove the Clover mapping."); }
    finally { setBusy(false); }
  }

  if (!locationId) return null;
  return (
    <div className="mt-5 rounded-xl border border-line bg-white p-4" aria-label="Clover menu mapping">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm font-bold text-ink">Explicit Clover mapping</p><p className="mt-1 text-xs text-muted">Choose the Flowtally location and menu item deliberately. Nothing here imports sales or changes inventory.</p></div>
        <label className="text-xs font-semibold text-muted">Flowtally location<select className="mt-1 block rounded-lg border border-line bg-white px-2 py-1 text-sm text-ink" value={locationId} onChange={(event) => setLocationId(Number(event.target.value))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      </div>
      {error ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm text-muted">Loading mapping state…</p> : <>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-ink">Merchant:</span><span className="text-muted">{catalog.merchantName}</span><span className="text-muted">·</span><span className="font-semibold text-ink">Location:</span><span className="text-muted">{catalog.location?.name ?? "Merchant-level (Clover supplied no location ID)"}</span>{locationMapping ? <span className="text-emerald-700">Confirmed</span> : <Button type="button" disabled={busy} onClick={() => void confirmLocation()}>Confirm location</Button>}{locationMapping ? <Button type="button" variant="ghost" disabled={busy} onClick={async () => { await deletePilotCloverLocationMapping(organizationId, locationId); setLocationMapping(null); }}>Remove</Button> : null}</div>
        <div className="mt-4 space-y-2">{basicItems.map((item) => { const existing = mappings.find((mapping) => mapping.cloverItemId === item.id); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"><div><span className="font-semibold text-ink">{item.name}</span><span className="ml-2 text-xs text-muted">{item.id} · {item.priceCents == null ? "Price unavailable" : ${(item.priceCents / 100).toFixed(2)} CAD}</span>{existing ? <span className="ml-2 text-xs text-emerald-700">Mapped to {existing.flowtallyMenuItemName}{existing.hasRecipe ? " · recipe ready" : " · recipe missing"}</span> : <span className="ml-2 text-xs text-muted">Unmapped</span>}</div><div className="flex items-center gap-2"><select aria-label={`Map ${item.name}`} className="rounded-lg border border-line bg-white px-2 py-1 text-sm text-ink" defaultValue={existing?.flowtallyMenuItemId ?? ""} onChange={(event) => { const value = Number(event.target.value); if (value) void saveItem(item.id, value, existing); }} disabled={busy || !locationMapping}><option value="">Choose menu item</option>{menuItems.map((menuItem) => <option key={menuItem.id} value={menuItem.id}>{menuItem.name}{menuItem.recipe ? " · recipe" : " · no recipe"}</option>)}</select>{existing ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void removeMapping(existing)}>Remove</Button> : null}</div></div>; })}</div>
        {catalog.items.length !== basicItems.length ? <p className="mt-3 text-xs text-muted">Variant and modifier items remain visible in the read-only preview but are deferred from mapping until their recipe semantics are defined.</p> : null}
      </>}
    </div>
  );
}
