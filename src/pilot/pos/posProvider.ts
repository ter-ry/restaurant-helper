import { useCallback, useEffect, useRef, useState } from "react";
import { PilotApiError, fetchPilotCloverMappings, fetchPilotCloverStatus, fetchPilotSquareStatus } from "../pilotApi";
import { usePilotSession } from "../PilotSessionProvider";

/**
 * Per-location POS provider resolution for the provider-neutral /app/pos entry.
 *
 * Mirrors the backend rule in backend/pos_provider.py (PR #215): a provider is "active" for a
 * restaurant location only when its organization connection is `connected` AND the provider has a
 * location mapping to that restaurant location. This module only reads existing status/mapping
 * endpoints; it never connects, disconnects or switches a provider.
 */
export type PosProviderKind = "square" | "clover" | "unconnected" | "conflict";

export interface PosProviderResolution {
  kind: PosProviderKind;
  locationId: number;
  /** Square is connected for the organization (it may not be mapped to this location). */
  squareOrgConnected: boolean;
  /** Clover is enabled for this organization (allowlisted and configured). */
  cloverAvailable: boolean;
  /** Clover status is owner-only; true when the signed-in user cannot read it. */
  cloverRestricted: boolean;
  cloverOrgConnected: boolean;
}

export interface PosProviderInputs {
  locationId: number;
  squareConnection: { status: string; locations?: Array<{ mappings: Array<{ restaurantLocationId: number }> }> } | null;
  clover: { enabled: boolean; restricted: boolean; connection: { status: string } | null; locationMapped: boolean };
}

export function resolvePosProvider(input: PosProviderInputs): PosProviderResolution {
  const squareConnected = input.squareConnection?.status === "connected";
  const squareActive =
    squareConnected &&
    (input.squareConnection?.locations ?? []).some((loc) => loc.mappings.some((m) => m.restaurantLocationId === input.locationId));
  const cloverConnected = Boolean(input.clover.enabled && input.clover.connection?.status === "connected");
  const cloverActive = cloverConnected && input.clover.locationMapped;
  const kind: PosProviderKind = squareActive && cloverActive ? "conflict" : squareActive ? "square" : cloverActive ? "clover" : "unconnected";
  return {
    kind,
    locationId: input.locationId,
    squareOrgConnected: squareConnected,
    cloverAvailable: input.clover.enabled,
    cloverRestricted: input.clover.restricted,
    cloverOrgConnected: cloverConnected,
  };
}

export type PosProviderState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "no-location" }
  | { status: "ready"; resolution: PosProviderResolution };

export function usePosProvider(): PosProviderState & { reload: () => void } {
  const { organization, currentLocation, user } = usePilotSession();
  const [state, setState] = useState<PosProviderState>({ status: "loading" });
  const requestId = useRef(0);
  const organizationId = organization?.id ?? null;
  const locationId = currentLocation?.id ?? null;
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!organizationId) return;
    if (!locationId) {
      setState({ status: "no-location" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [square, cloverStatus] = await Promise.all([
        fetchPilotSquareStatus(organizationId),
        fetchPilotCloverStatus(organizationId).then(
          (status) => ({ status, restricted: false }),
          (err: unknown) => {
            // Clover status is owner-only; a 403 means "cannot see", not "not connected".
            if (err instanceof PilotApiError && err.status === 403) return { status: null, restricted: true };
            throw err;
          },
        ),
      ]);
      let locationMapped = false;
      const cloverConnected = cloverStatus.status?.enabled && cloverStatus.status.connection?.status === "connected";
      if (cloverConnected) {
        const mappings = await fetchPilotCloverMappings(organizationId, locationId);
        locationMapped = Boolean(mappings.locationMapping);
      }
      if (requestId.current !== id) return;
      setState({
        status: "ready",
        resolution: resolvePosProvider({
          locationId,
          squareConnection: square.connection,
          clover: {
            enabled: Boolean(cloverStatus.status?.enabled),
            restricted: cloverStatus.restricted,
            connection: cloverStatus.status?.connection ?? null,
            locationMapped,
          },
        }),
      });
    } catch (err) {
      if (requestId.current !== id) return;
      setState({ status: "error", message: err instanceof Error ? err.message : "Could not determine the point-of-sale provider." });
    }
  }, [organizationId, locationId]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load, userId]);

  return { ...state, reload: () => void load() };
}
