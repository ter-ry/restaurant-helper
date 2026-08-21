import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PilotLoginPage } from "../../src/pilot/PilotLoginPage";

const sessionMocks = vi.hoisted(() => ({
  usePilotSession: vi.fn(),
  startGoogleLogin: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: sessionMocks.usePilotSession,
}));

vi.mock("../../src/lib/customerAuth", () => ({
  startGoogleLogin: sessionMocks.startGoogleLogin,
}));

function renderPage(initialEntry = "/app/login?redirectTo=/app/purchases") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PilotLoginPage />
    </MemoryRouter>,
  );
}

describe("PilotLoginPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("shows the commercial Google-first login without seed credentials", () => {
    vi.stubEnv("VITE_ENABLE_PILOT_SEED_LOGIN", "false");
    sessionMocks.usePilotSession.mockReturnValue({ status: "signedOut", error: null });

    renderPage();

    expect(screen.getByRole("heading", { name: "Sign in to Flowtally" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.queryByText("owner@flowtally.local")).not.toBeInTheDocument();
    expect(screen.queryByText("PilotOwner123!")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(sessionMocks.startGoogleLogin).toHaveBeenCalledWith({ returnTo: "/app/purchases" });
  });

  it("keeps the seed login available only when explicitly enabled", async () => {
    vi.stubEnv("VITE_ENABLE_PILOT_SEED_LOGIN", "true");
    const signIn = vi.fn().mockResolvedValue(undefined);
    sessionMocks.usePilotSession.mockReturnValue({ status: "signedOut", error: null, signIn });

    renderPage("/app/login");

    expect(screen.getByText("Local development only")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveValue("owner@flowtally.local");
    expect(screen.getByLabelText("Password")).toHaveValue("PilotOwner123!");
    fireEvent.click(screen.getByRole("button", { name: "Sign in locally" }));
    expect(signIn).toHaveBeenCalledWith("owner@flowtally.local", "PilotOwner123!");
  });
});
