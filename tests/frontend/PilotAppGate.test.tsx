import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PilotAppGate } from "../../src/pilot/PilotAppGate";

const sessionMock = vi.hoisted(() => ({ usePilotSession: vi.fn() }));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: sessionMock.usePilotSession,
}));

function renderGate() {
  return render(
    <MemoryRouter initialEntries={["/app/dashboard"]}>
      <Routes>
        <Route path="/app/dashboard" element={<PilotAppGate />}>
          <Route index element={<h1>Operational workspace</h1>} />
        </Route>
        <Route path="/auth/google/complete" element={<h1>Customer setup status</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PilotAppGate", () => {
  afterEach(() => vi.clearAllMocks());

  it("redirects a signed-in but non-operational organization to setup status", () => {
    sessionMock.usePilotSession.mockReturnValue({ status: "needsActivation" });
    renderGate();
    expect(screen.getByRole("heading", { name: "Customer setup status" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Operational workspace" })).not.toBeInTheDocument();
  });

  it("does not expose the workspace when no organization is selected", () => {
    sessionMock.usePilotSession.mockReturnValue({ status: "needsSelection" });
    renderGate();
    expect(screen.getByRole("heading", { name: "Customer setup status" })).toBeVisible();
  });

  it("allows an operational session through", () => {
    sessionMock.usePilotSession.mockReturnValue({ status: "signedIn" });
    renderGate();
    expect(screen.getByRole("heading", { name: "Operational workspace" })).toBeVisible();
  });
});
