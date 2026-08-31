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

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => mockSession,
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
});
