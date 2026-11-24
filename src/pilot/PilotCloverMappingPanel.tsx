import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type MenuChoice = { id: number; name: string; recipe: unknown };

export function PilotCloverMappingPanel({ organizationId, catalog }: { organizationId: number; catalog: PilotCloverCatalogPreview }) {
  const { locations, currentLocation } = usePilotSession();
  const [locationId, setLocationId] = useState(currentLocation?.id ?? locations[0]?.id ?? 0);
  const [locationMapping, setLocationMapping] = useState<{ id: number; restaurantLocationId: number; cloverLocationId: string | null } | null>(null);
  const [mappings, setMappings] = useState<PilotCloverMenuMapping[]>([]);
  const [menuItems, setMenuItems] = useState<MenuChoice[]>([]);
  const [pendingSelections, setPendingSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const basicItems = useMemo(
    () => catalog.items.filter((item) => !item.deleted && !item.itemGroupId && item.optionIds.length === 0 && item.modifierGroups.length === 0),
    [catalog.items],
  );

  // Bumped on every location change so a slow response for a previously selected location is never applied.
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; }, [organizationId, locationId]);

  const loadMappings = useCallback(async () => {
    const requestGeneration = generation.current;
    const [mappingResult, costing] = await Promise.all([fetchPilotCloverMappings(organizationId, locationId), fetchPilotMenuCosting(locationId)]);
    if (generation.current !== requestGeneration) return false;
    setLocationMapping(mappingResult.locationMapping);
    setMappings(mappingResult.menuMappings);
    setMenuItems(costing.menuItems.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, recipe: item.recipe })));
    return true;
  }, [organizationId, locationId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setRefreshFailed(false);
    setLoadFailed(false);
    setPendingSelections({});
    loadMappings()
      .catch((err) => { if (active) { setLoadFailed(true); setError(err instanceof Error ? err.message : "Could not load Clover mappings."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadMappings]);

  // Runs one mutation: blocks duplicates, shows progress, applies the server's answer, then reconciles with a re-fetch.
  // If the re-fetch fails, the successful write stays visible and an in-panel Refresh retry is offered.
  async function mutate(label: string, successMessage: string, failureMessage: string, action: () => Promise<() => void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const startedGeneration = generation.current;
    setBusy(label);
    setError(null);
    setNotice(null);
    setRefreshFailed(false);
    try {
      const applyLocally = await action();
      if (generation.current === startedGeneration) applyLocally();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
      busyRef.current = false;
      setBusy(null);
      return;
    }
    try {
      await loadMappings();
      setNotice(successMessage);
    } catch {
      setNotice(successMessage);
      setRefreshFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function refresh() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("Refreshing…");
    setError(null);
    try {
      await loadMappings();
      setRefreshFailed(false);
      setLoadFailed(false);
      setError(null);
      setNotice("Mapping state refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh Clover mappings.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const confirmLocation = () => mutate("Confirming location…", "Clover location confirmed.", "Could not save the Clover location association.", async () => {
    const result = await savePilotCloverLocationMapping(organizationId, locationId, catalog.location?.id ?? null);
    return () => { setLocationMapping(result.locationMapping); setPendingSelections({}); };
  });

  const removeLocation = () => mutate("Removing location…", "Clover location association removed.", "Could not remove the Clover location association.", async () => {
    await deletePilotCloverLocationMapping(organizationId, locationId);
    return () => { setLocationMapping(null); setMappings([]); setPendingSelections({}); };
  });

  function saveItem(itemId: string, existing?: PilotCloverMenuMapping) {
    const menuItemId = Number(pendingSelections[itemId]);
    if (!Number.isInteger(menuItemId) || menuItemId <= 0) return;
    const itemName = catalog.items.find((item) => item.id === itemId)?.name ?? "item";
    return mutate("Saving mapping…", `Saved mapping for ${itemName}.`, "Could not save the Clover menu mapping.", async () => {
      const result = await savePilotCloverMenuMapping({ organizationId, locationId, cloverItemId: itemId, flowtallyMenuItemId: menuItemId, ...(existing ? { mappingId: existing.id } : {}) });
      return () => { setMappings((current) => [...current.filter((value) => value.id !== result.mapping.id), result.mapping]); cancelItem(itemId); };
    });
  }

  function cancelItem(itemId: string) {
    setPendingSelections((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  const removeMapping = (mapping: PilotCloverMenuMapping) => mutate("Removing mapping…", `Removed mapping for ${mapping.flowtallyMenuItemName}.`, "Could not remove the Clover mapping.", async () => {
    await deletePilotCloverMenuMapping(organizationId, mapping.id);
    return () => { setMappings((current) => current.filter((value) => value.id !== mapping.id)); cancelItem(mapping.cloverItemId); };
  });

  if (!locationId) return null;
  return (
    <div className="mt-5 rounded-xl border border-line bg-white p-4" aria-label="Clover menu mapping">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm font-bold text-ink">Explicit Clover mapping</p><p className="mt-1 text-xs text-muted">Choose the Flowtally location and menu item deliberately. Nothing here imports sales or changes inventory.</p></div>
        <label className="text-xs font-semibold text-muted">Flowtally location<select className="mt-1 block rounded-lg border border-line bg-white px-2 py-1 text-sm text-ink" value={locationId} disabled={Boolean(busy)} onChange={(event) => setLocationId(Number(event.target.value))}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
      {busy ? <p role="status" className="mt-3 text-sm text-muted">{busy}</p> : null}
      {notice && !busy ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {refreshFailed && !busy ? <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-900"><span>Saved, but the latest state could not be reloaded.</span><Button type="button" variant="secondary" onClick={() => void refresh()}>Refresh</Button></div> : null}
      {loadFailed && !loading && !busy ? <div className="mt-3"><Button type="button" variant="secondary" onClick={() => void refresh()}>Retry</Button></div> : null}
      {loading ? <p className="mt-3 text-sm text-muted">Loading mapping state…</p> : loadFailed ? null : <>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-ink">Merchant:</span><span className="text-muted">{catalog.merchantName}</span><span className="text-muted">·</span><span className="font-semibold text-ink">Location:</span><span className="text-muted">{catalog.location?.name ?? "Merchant-level (Clover supplied no location ID)"}</span>{locationMapping ? <span className="text-emerald-700">Confirmed</span> : <Button type="button" disabled={Boolean(busy)} onClick={() => void confirmLocation()}>Confirm location</Button>}{locationMapping ? <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void removeLocation()}>Remove</Button> : null}</div>
        <div className="mt-4 space-y-2">{basicItems.map((item) => {
          const existing = mappings.find((mapping) => mapping.cloverItemId === item.id);
          const selectedValue = pendingSelections[item.id] ?? (existing ? String(existing.flowtallyMenuItemId) : "");
          const dirty = pendingSelections[item.id] !== undefined && pendingSelections[item.id] !== String(existing?.flowtallyMenuItemId ?? "");
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
            <div><span className="font-semibold text-ink">{item.name}</span><span className="ml-2 text-xs text-muted">{item.id} · {item.priceCents == null ? "Price unavailable" : "$" + (item.priceCents / 100).toFixed(2) + " CAD"}</span>{existing ? <span className="ml-2 text-xs text-emerald-700">Mapped to {existing.flowtallyMenuItemName}{existing.hasRecipe ? " · recipe ready" : " · recipe missing"}</span> : <span className="ml-2 text-xs text-muted">Unmapped</span>}</div>
            <div className="flex items-center gap-2">
              <select aria-label={`Map ${item.name}`} className="rounded-lg border border-line bg-white px-2 py-1 text-sm text-ink" value={selectedValue} onChange={(event) => setPendingSelections((current) => ({ ...current, [item.id]: event.target.value }))} disabled={Boolean(busy) || !locationMapping}>
                <option value="">Choose menu item</option>{menuItems.map((menuItem) => <option key={menuItem.id} value={menuItem.id}>{menuItem.name}{menuItem.recipe ? " · recipe" : " · no recipe"}</option>)}
              </select>
              {dirty ? <><Button type="button" disabled={Boolean(busy)} onClick={() => void saveItem(item.id, existing)}>Save mapping</Button><Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => cancelItem(item.id)}>Cancel</Button></> : null}
              {existing ? <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void removeMapping(existing)}>Remove</Button> : null}
            </div>
          </div>;
        })}</div>
        {catalog.items.length !== basicItems.length ? <p className="mt-3 text-xs text-muted">Variant and modifier items remain visible in the read-only preview but are deferred from mapping until their recipe semantics are defined.</p> : null}
      </>}
    </div>
  );
}
