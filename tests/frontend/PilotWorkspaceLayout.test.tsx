import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotWorkspaceLayout } from "../../src/pilot/PilotWorkspaceLayout";

const mockSession = vi.hoisted(() => ({
  organization: { id: 42, name: "Pilot Cafe" },
  organizations: [{ organization: { id: 42, name: "Pilot Cafe" }, membershipRole: "owner" }],
  currentLocation: { id: 7, name: "Line Kitchen" },
  locations: [{ id: 7, name: "Line Kitchen" }],
  enabledModuleKeys: ["SQUARE_INTEGRATION", "DAILY_CLOSE"],
  user: { email: "pilot@example.com" },
  error: null,
  signOut: vi.fn(),
  switchLocation: vi.fn(),
  switchOrganization: vi.fn(),
  refreshSession: vi.fn(),
}));
const mockAttention = vi.hoisted(() => ({ fetchPilotAttention: vi.fn() }));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => mockSession,
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/pilot/pilotApi")>()),
  fetchPilotAttention: mockAttention.fetchPilotAttention,
}));

function RouteChanger() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/app/inventory")}>Go inventory</button>;
}

function renderLayout(initialPath = "/app/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/app" element={<PilotWorkspaceLayout />}>
          <Route path="dashboard" element={<><div>Dashboard outlet</div><RouteChanger /></>} />
          <Route path="*" element={<div>Workspace outlet</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("PilotWorkspaceLayout", () => {
  beforeEach(() => {
    mockAttention.fetchPilotAttention.mockReset();
    mockAttention.fetchPilotAttention.mockResolvedValue({ reorder: { count: 1 } });
    mockSession.signOut.mockReset();
    mockSession.switchLocation.mockReset();
    mockSession.switchOrganization.mockReset();
    mockSession.refreshSession.mockReset();
  });

  it("shows the new Square and Daily Close routes in the pilot shell navigation", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Square" })).toHaveAttribute("href", "/app/square");
    expect(screen.getByRole("link", { name: "Daily Close" })).toHaveAttribute("href", "/app/daily-close");
    expect(screen.getByText("Dashboard outlet")).toBeVisible();
  });

  it("shows an actionable reorder badge and omits it when pressure is clear", async () => {
    const firstRender = renderLayout("/app/inventory");

    expect(await screen.findByLabelText("1 needs attention")).toBeVisible();

    mockAttention.fetchPilotAttention.mockResolvedValueOnce({ reorder: { count: 0 } });
    firstRender.unmount();
    renderLayout("/app/inventory");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByLabelText("1 needs attention")).not.toBeInTheDocument();
  });

  it("does not duplicate the dashboard snapshot request", async () => {
    renderLayout();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockAttention.fetchPilotAttention).toHaveBeenCalledTimes(1);
  });

  it("does not refetch attention when navigating between workspace routes", async () => {
    renderLayout();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "Go inventory" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockAttention.fetchPilotAttention).toHaveBeenCalledTimes(1);
  });
});
