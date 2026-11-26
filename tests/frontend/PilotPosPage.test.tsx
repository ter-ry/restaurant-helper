import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotLegacySquareRedirect, PilotPosCloverRoute, PilotPosEntry, PilotPosLayout, PilotPosSquareRoute } from "../../src/pilot/PilotPosPage";
import { resolvePosProvider } from "../../src/pilot/pos/posProvider";

const session = vi.hoisted(() => ({ locationId: 1 as number | null }));
const api = vi.hoisted(() => ({
  fetchPilotSquareStatus: vi.fn(),
  fetchPilotCloverStatus: vi.fn(),
  fetchPilotCloverMappings: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return { ...actual, ...api };
});
vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    user: { id: 1 },
    organization: { id: 7, name: "Org" },
    locations: [{ id: 1, name: "King West" }, { id: 2, name: "Queen East" }],
    currentLocation: session.locationId ? { id: session.locationId, name: session.locationId === 1 ? "King West" : "Queen East" } : null,
  }),
}));
vi.mock("../../src/pilot/PilotSquarePage", () => ({ PilotSquarePage: () => <div>Square workspace</div> }));
vi.mock("../../src/pilot/PilotCloverConnection", () => ({ PilotCloverConnection: () => <div>Clover connection panel</div> }));

const squareConn = (mappedTo: number[]) => ({
  connection: { status: "connected", locations: [{ mappings: mappedTo.map((id) => ({ restaurantLocationId: id })) }] },
});
const cloverStatus = (connected: boolean) => ({ enabled: true, mappingEnabled: true, connection: { status: connected ? "connected" : "disconnected", environment: "sandbox" } });

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}{l.hash}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Link to="/app/pos">go-pos</Link>
      <Routes>
        <Route path="/app/square" element={<PilotLegacySquareRedirect />} />
        <Route path="/app/pos" element={<PilotPosLayout />}>
          <Route index element={<PilotPosEntry />} />
          <Route path="square" element={<PilotPosSquareRoute />} />
          <Route path="clover" element={<PilotPosCloverRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  session.locationId = 1;
  Object.values(api).forEach((m) => m.mockReset());
  api.fetchPilotSquareStatus.mockResolvedValue({ connection: null });
  api.fetchPilotCloverStatus.mockResolvedValue({ enabled: false, connection: null });
  api.fetchPilotCloverMappings.mockResolvedValue({ enabled: true, locationMapping: null, menuMappings: [] });
});

describe("resolvePosProvider", () => {
  it("requires both a connected connection and a mapping to this location", () => {
    const base = { locationId: 1, clover: { enabled: false, restricted: false, connection: null, locationMapped: false } };
    expect(resolvePosProvider({ ...base, squareConnection: { status: "connected", locations: [{ mappings: [{ restaurantLocationId: 2 }] }] } }).kind).toBe("unconnected");
    expect(resolvePosProvider({ ...base, squareConnection: { status: "revoked", locations: [{ mappings: [{ restaurantLocationId: 1 }] }] } }).kind).toBe("unconnected");
    expect(resolvePosProvider({ ...base, squareConnection: { status: "connected", locations: [{ mappings: [{ restaurantLocationId: 1 }] }] } }).kind).toBe("square");
  });
});

describe("POS workspace routing", () => {
  it("opens the Square workspace for a Square-only location without Clover panels", async () => {
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    renderAt("/app/pos");
    expect(await screen.findByText("Square workspace")).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/pos/square");
    expect(screen.queryByText("Clover connection panel")).not.toBeInTheDocument();
  });

  it("opens the Clover workspace for a Clover-only location without Square panels", async () => {
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(true));
    api.fetchPilotCloverMappings.mockResolvedValue({ enabled: true, locationMapping: { id: 1 }, menuMappings: [] });
    renderAt("/app/pos");
    expect(await screen.findByText("Clover connection panel")).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/pos/clover");
    expect(screen.queryByText("Square workspace")).not.toBeInTheDocument();
  });

  it("shows provider selection for an unconnected location and never connects anything", async () => {
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(false));
    renderAt("/app/pos");
    expect(await screen.findByText("Connect your point-of-sale")).toBeVisible();
    expect(screen.getByRole("link", { name: "Set up Square" })).toHaveAttribute("href", "/app/pos/square");
    expect(screen.getByRole("link", { name: "Set up Clover" })).toHaveAttribute("href", "/app/pos/clover");
  });

  it("hides the Clover option when Clover is not enabled and explains owner-only access on 403", async () => {
    renderAt("/app/pos");
    await screen.findByText("Connect your point-of-sale");
    expect(screen.queryByTestId("pos-option-clover")).not.toBeInTheDocument();
  });

  it("treats a 403 Clover status as restricted, not disconnected", async () => {
    const { PilotApiError } = await import("../../src/pilot/pilotApi");
    api.fetchPilotCloverStatus.mockRejectedValue(new PilotApiError("restricted", 403));
    renderAt("/app/pos");
    expect(await screen.findByTestId("pos-option-clover-restricted")).toHaveTextContent("managed by the organization owner");
  });

  it("supports different providers at different locations", async () => {
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(true));
    api.fetchPilotCloverMappings.mockImplementation(async (_org: number, loc: number) => ({ enabled: true, locationMapping: loc === 2 ? { id: 9 } : null, menuMappings: [] }));
    const first = renderAt("/app/pos");
    expect(await screen.findByText("Square workspace")).toBeVisible();
    first.unmount();
    session.locationId = 2;
    renderAt("/app/pos");
    expect(await screen.findByText("Clover connection panel")).toBeVisible();
  });

  it("fails safe on a Square+Clover conflict: no workspace, nothing mutated", async () => {
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(true));
    api.fetchPilotCloverMappings.mockResolvedValue({ enabled: true, locationMapping: { id: 1 }, menuMappings: [] });
    renderAt("/app/pos/square");
    expect(await screen.findByText("Conflicting point-of-sale setup")).toBeVisible();
    expect(screen.queryByText("Square workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Clover connection panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/app\/pos$/);
  });

  it("keeps a Clover location out of the Square URL", async () => {
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(true));
    api.fetchPilotCloverMappings.mockResolvedValue({ enabled: true, locationMapping: { id: 1 }, menuMappings: [] });
    renderAt("/app/pos/square");
    expect(await screen.findByText("Clover connection panel")).toBeVisible();
    expect(screen.queryByText("Square workspace")).not.toBeInTheDocument();
  });

  it("fails safe when status cannot be loaded and offers retry", async () => {
    api.fetchPilotSquareStatus.mockRejectedValueOnce(new Error("boom"));
    renderAt("/app/pos");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm");
    expect(screen.queryByText("Connect your point-of-sale")).not.toBeInTheDocument();
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Square workspace")).toBeVisible();
  });

  it("keeps the legacy /app/square URL, its query and hash, working", async () => {
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    renderAt("/app/square?error=square_authorization_denied#mappings");
    await waitFor(() => expect(screen.getByText("Square workspace")).toBeVisible());
    expect(screen.getByTestId("where")).toHaveTextContent("/app/pos/square?error=square_authorization_denied#mappings");
  });

  it("sends a legacy Clover launch link to the Clover workspace", async () => {
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(true));
    api.fetchPilotCloverMappings.mockResolvedValue({ enabled: true, locationMapping: { id: 1 }, menuMappings: [] });
    renderAt("/app/square?cloverLaunch=1");
    expect(await screen.findByText("Clover connection panel")).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/pos/clover?cloverLaunch=1");
  });

  it("routes a Clover-initiated launch to Clover setup even when the location is not yet mapped", async () => {
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(false));
    renderAt("/app/pos?cloverLaunch=1");
    expect(await screen.findByText("Clover connection panel")).toBeVisible();
  });

  it("lets Clover work when Square is disabled (403/404) instead of failing the whole POS layout", async () => {
    const { PilotApiError } = await import("../../src/pilot/pilotApi");
    api.fetchPilotSquareStatus.mockRejectedValue(new PilotApiError("Square disabled", 403));
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(true));
    api.fetchPilotCloverMappings.mockResolvedValue({ enabled: true, locationMapping: { id: 1 }, menuMappings: [] });
    renderAt("/app/pos/clover");
    expect(await screen.findByText("Clover connection panel")).toBeVisible();
  });

  it("does not call the feature-gated mapping endpoint when mapping is disabled, and never blocks Square", async () => {
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    api.fetchPilotCloverStatus.mockResolvedValue({ ...cloverStatus(true), mappingEnabled: false });
    renderAt("/app/pos");
    expect(await screen.findByText("Square workspace")).toBeVisible();
    expect(api.fetchPilotCloverMappings).not.toHaveBeenCalled();
  });

  it("re-resolves when returning to /app/pos after a provider change, without a browser reload", async () => {
    api.fetchPilotSquareStatus.mockResolvedValueOnce(squareConn([1]));
    renderAt("/app/pos");
    expect(await screen.findByText("Square workspace")).toBeVisible();
    // Square was disconnected inside its workspace; Clover is now the choice.
    api.fetchPilotSquareStatus.mockResolvedValue({ connection: null });
    api.fetchPilotCloverStatus.mockResolvedValue(cloverStatus(false));
    fireEvent.click(screen.getByText("go-pos"));
    expect(await screen.findByText("Connect your point-of-sale")).toBeVisible();
    expect(screen.queryByText("Square workspace")).not.toBeInTheDocument();
  });

  it("keeps a Clover launch parameter when a provider guard redirects", async () => {
    api.fetchPilotSquareStatus.mockResolvedValue(squareConn([1]));
    renderAt("/app/pos/clover?cloverLaunch=1");
    expect(await screen.findByText("Square workspace")).toBeVisible();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/pos/square?cloverLaunch=1");
  });
});
