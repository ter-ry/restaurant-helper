import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({ usePilotSession: vi.fn() }));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({ usePilotSession: sessionMocks.usePilotSession }));
vi.mock("../../src/pilot/pilotConfig", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotConfig")>("../../src/pilot/pilotConfig");
  return { ...actual, demoReadOnly: true, pilotSeedLoginEnabled: () => true };
});

import { PilotLoginPage } from "../../src/pilot/PilotLoginPage";

describe("PilotLoginPage demo mode", () => {
  it("offers only the credential-free read-only entry", () => {
    sessionMocks.usePilotSession.mockReturnValue({ status: "signedOut", error: null, signInDemo: vi.fn() });
    render(<MemoryRouter><PilotLoginPage /></MemoryRouter>);

    expect(screen.getByRole("button", { name: "Enter read-only demo" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in locally" })).not.toBeInTheDocument();
    expect(screen.queryByText("owner@flowtally.local")).not.toBeInTheDocument();
  });
});
