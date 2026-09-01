import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
const mockDashboard = vi.hoisted(() => ({ fetchPilotDashboard: vi.fn() }));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => mockSession,
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/pilot/pilotApi")>()),
  fetchPilotDashboard: mockDashboard.fetchPilotDashboard,
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/app/dashboard"]}>
      <Routes>
        <Route path="/app" element={<PilotWorkspaceLayout />}>
          <Route path="dashboard" element={<div>Dashboard outlet</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("PilotWorkspaceLayout", () => {
  beforeEach(() => {
    mockDashboard.fetchPilotDashboard.mockResolvedValue({ summary: { inventoryItemsToReorderCount: 1 }, operationalAttention: { reorder: { count: 1, severity: "urgent" } } });
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
    const firstRender = renderLayout();

    expect(await screen.findByLabelText("1 needs attention")).toBeVisible();

    mockDashboard.fetchPilotDashboard.mockResolvedValueOnce({ summary: { inventoryItemsToReorderCount: 0 }, operationalAttention: { reorder: { count: 0, severity: "none" } } });
    firstRender.unmount();
    renderLayout();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByLabelText("1 needs attention")).not.toBeInTheDocument();
  });
});
