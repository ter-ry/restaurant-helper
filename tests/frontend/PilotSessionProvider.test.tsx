import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  class MockPilotApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "PilotApiError";
      this.status = status;
    }
  }

  return {
    fetchCurrentOrganization: vi.fn(),
    fetchPilotOrganizations: vi.fn(),
    fetchPilotSession: vi.fn(),
    getPilotCsrfToken: vi.fn(),
    loginToDemo: vi.fn(),
    loginToPilot: vi.fn(),
    logoutOfPilot: vi.fn(),
    PilotApiError: MockPilotApiError,
    selectPilotOrganization: vi.fn(),
    switchPilotLocation: vi.fn(),
  };
});

vi.mock("../../src/pilot/pilotApi", () => api);
vi.mock("../../src/pilot/pilotConfig", () => ({ pilotAppEnabled: true }));
vi.mock("../../src/pilot/pilotDataCache", () => ({
  clearPilotDataCache: vi.fn(),
  setPilotCacheScope: vi.fn(),
}));

import { PilotSessionProvider, usePilotSession } from "../../src/pilot/PilotSessionProvider";

const organization = {
  id: 1,
  name: "Harbour Kitchen",
  lifecycleStatus: "ACTIVE",
  setupStatus: "COMPLETE",
  subscriptionStatus: "ACTIVE",
  createdAt: null,
  updatedAt: null,
};

const location = {
  id: 1,
  organizationId: 1,
  name: "Queen West",
  addressLine1: "1 King Street",
  addressLine2: "",
  city: "Toronto",
  region: "ON",
  postalCode: "M5V 1A1",
  country: "Canada",
  timezone: "America/Toronto",
  createdAt: null,
  updatedAt: null,
};

const session = {
  user: { id: 7, email: "owner@example.test", isActive: true, createdAt: null, updatedAt: null },
  membershipRole: "owner",
  currentOrganizationId: 1,
  currentLocationId: 1,
  enabledModuleKeys: ["INVENTORY"],
  organizations: [],
  csrfToken: "csrf-token",
};

function Probe() {
  const current = usePilotSession();
  return (
    <div>
      <output data-testid="status">{current.status}</output>
      <output data-testid="user">{current.user?.email ?? "none"}</output>
      <output data-testid="error">{current.error ?? ""}</output>
      <button type="button" onClick={() => void current.refreshSession()}>Refresh</button>
    </div>
  );
}

function renderProvider() {
  api.fetchPilotOrganizations.mockResolvedValue({ organizations: [] });
  api.fetchCurrentOrganization.mockResolvedValue({
    organization,
    restaurantLocations: [location],
    currentLocation: location,
    enabledModuleKeys: ["INVENTORY"],
    membershipRole: "owner",
  });
  return render(<PilotSessionProvider><Probe /></PilotSessionProvider>);
}

describe("PilotSessionProvider session refresh failures", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps the authenticated workspace during a transient network failure", async () => {
    api.fetchPilotSession.mockResolvedValue(session);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    api.fetchPilotSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTestId("error").textContent).toContain("Could not refresh the session"));
    expect(screen.getByTestId("status").textContent).toBe("signedIn");
    expect(screen.getByTestId("user").textContent).toBe("owner@example.test");
  });

  it("keeps the authenticated workspace during a temporary server error", async () => {
    api.fetchPilotSession.mockResolvedValue(session);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    api.fetchPilotSession.mockRejectedValueOnce(new api.PilotApiError("Service unavailable", 503));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTestId("error").textContent).toContain("Could not refresh the session"));
    expect(screen.getByTestId("status").textContent).toBe("signedIn");
    expect(screen.getByTestId("user").textContent).toBe("owner@example.test");
  });

  it("clears the session only for a genuine unauthorized response", async () => {
    api.fetchPilotSession.mockResolvedValue(session);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"));
    api.fetchPilotSession.mockRejectedValueOnce(new api.PilotApiError("Authentication required", 401));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedOut"));
    expect(screen.getByTestId("user").textContent).toBe("none");
  });
});
