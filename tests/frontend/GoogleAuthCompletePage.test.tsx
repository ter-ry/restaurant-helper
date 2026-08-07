import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { GoogleAuthCompletePage } from "../../src/pages/GoogleAuthCompletePage";

const authMocks = vi.hoisted(() => ({
  fetchCustomerSession: vi.fn(),
  createCustomerProspectOrganization: vi.fn(),
  requestCustomerSetup: vi.fn(),
  logoutCustomer: vi.fn(),
  startGoogleLogin: vi.fn(),
}));

vi.mock("../../src/lib/customerAuth", () => ({
  fetchCustomerSession: authMocks.fetchCustomerSession,
  createCustomerProspectOrganization: authMocks.createCustomerProspectOrganization,
  requestCustomerSetup: authMocks.requestCustomerSetup,
  logoutCustomer: authMocks.logoutCustomer,
  startGoogleLogin: authMocks.startGoogleLogin,
}));

function renderPage(path = "/auth/google/complete") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GoogleAuthCompletePage />
    </MemoryRouter>,
  );
}

describe("GoogleAuthCompletePage", () => {
  it("shows the session-expired state when the customer session cannot be loaded", async () => {
    authMocks.fetchCustomerSession.mockRejectedValueOnce(new Error("Session expired."));

    renderPage();

    await screen.findByRole("heading", { name: "Your sign-in session expired" });
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });

  it("walks a new Google prospect through onboarding and account creation", async () => {
    const initialSession = {
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: null,
      currentLocationId: null,
      organizations: [],
      csrfToken: "csrf-1",
    };
    const createdSession = {
      ...initialSession,
      currentOrganizationId: 42,
      organizations: [
        {
          organization: { id: 42, name: "Demo Bistro", lifecycleStatus: "ONBOARDING", setupStatus: "INTAKE", subscriptionStatus: "NONE", isProspect: true },
          membershipRole: "owner",
          selected: true,
        },
      ],
    };

    authMocks.fetchCustomerSession
      .mockResolvedValueOnce(initialSession)
      .mockResolvedValueOnce(createdSession);
    authMocks.createCustomerProspectOrganization.mockResolvedValueOnce({
      organization: { id: 42, name: "Demo Bistro" },
      membershipRole: "owner",
      currentLocationId: 8,
    });
    authMocks.requestCustomerSetup.mockResolvedValueOnce({ organization: { id: 42, name: "Demo Bistro" } });

    renderPage();

    await screen.findByRole("heading", { name: "Set up your first restaurant" });
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Demo Bistro" } });
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Dining Room" } });
    fireEvent.click(screen.getByRole("button", { name: /Create your workspace/i }));

    await waitFor(() => expect(authMocks.fetchCustomerSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Welcome back, owner@example.com")).toBeVisible();
    expect(screen.getByText("Logged-in prospect")).toBeVisible();
  });

  it("shows the logged-in prospect landing state when an organization already exists", async () => {
    authMocks.fetchCustomerSession.mockResolvedValueOnce({
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: 11,
      currentLocationId: 2,
      organizations: [
        {
          organization: { id: 11, name: "Owner Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE" },
          membershipRole: "owner",
          selected: true,
        },
      ],
      csrfToken: "csrf-2",
    });

    renderPage();

    await screen.findByRole("heading", { name: "Customer setup" });
    expect(screen.getByText(/Owner Cafe/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Logout" })[0]).toBeVisible();
  });
});
