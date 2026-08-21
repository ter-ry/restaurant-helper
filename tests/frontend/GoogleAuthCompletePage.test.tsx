import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { GoogleAuthCompletePage } from "../../src/pages/GoogleAuthCompletePage";

const authMocks = vi.hoisted(() => ({
  fetchCustomerSession: vi.fn(),
  createCustomerProspectOrganization: vi.fn(),
  requestCustomerSetup: vi.fn(),
  logoutCustomer: vi.fn(),
  selectCustomerOrganization: vi.fn(),
  startGoogleLogin: vi.fn(),
}));

vi.mock("../../src/lib/customerAuth", () => ({
  fetchCustomerSession: authMocks.fetchCustomerSession,
  createCustomerProspectOrganization: authMocks.createCustomerProspectOrganization,
  requestCustomerSetup: authMocks.requestCustomerSetup,
  logoutCustomer: authMocks.logoutCustomer,
  selectCustomerOrganization: authMocks.selectCustomerOrganization,
  startGoogleLogin: authMocks.startGoogleLogin,
}));

function renderPage(path = "/auth/google/complete") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GoogleAuthCompletePage />
    </MemoryRouter>,
  );
}

function renderPageWithAppRoute(path = "/auth/google/complete") {
  const router = createMemoryRouter(
    [
      { path: "/auth/google/complete", element: <GoogleAuthCompletePage /> },
      { path: "/app", element: <div>App shell</div> },
    ],
    { initialEntries: [path] },
  );

  return render(<RouterProvider router={router} />);
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

  it("restores an existing organization session instead of showing the creation form", async () => {
    const resumeSession = {
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: null,
      currentLocationId: null,
      organizations: [
        {
          organization: {
            id: 77,
            name: "Prospect Cafe",
            lifecycleStatus: "ONBOARDING",
            setupStatus: "INTAKE",
            subscriptionStatus: "NONE",
            isProspect: true,
          },
          membershipRole: "owner",
          selected: false,
        },
      ],
      csrfToken: "csrf-3",
    };
    const restoredSession = {
      ...resumeSession,
      currentOrganizationId: 77,
      currentLocationId: 8,
      organizations: [
        {
          ...resumeSession.organizations[0],
          selected: true,
        },
      ],
    };

    authMocks.fetchCustomerSession
      .mockResolvedValueOnce(resumeSession)
      .mockResolvedValueOnce(restoredSession);
    authMocks.selectCustomerOrganization.mockResolvedValueOnce({
      organization: restoredSession.organizations[0].organization,
      membershipRole: "owner",
      currentLocationId: 8,
    });

    renderPage();

    await screen.findByRole("heading", { name: "Customer setup" });
    expect(screen.queryByRole("heading", { name: "Set up your first restaurant" })).not.toBeInTheDocument();
    expect(screen.getByText("Logged-in prospect")).toBeVisible();
    expect(screen.getByText(/Prospect Cafe/)).toBeVisible();
    expect(authMocks.selectCustomerOrganization).toHaveBeenCalledWith(77);
  });

  it("treats a duplicate organization post as recoverable by restoring the existing workspace", async () => {
    const resumeSession = {
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: null,
      currentLocationId: null,
      organizations: [
        {
          organization: {
            id: 88,
            name: "Existing Bistro",
            lifecycleStatus: "ONBOARDING",
            setupStatus: "INTAKE",
            subscriptionStatus: "NONE",
            isProspect: true,
          },
          membershipRole: "owner",
          selected: false,
        },
      ],
      csrfToken: "csrf-4",
    };
    const restoredSession = {
      ...resumeSession,
      currentOrganizationId: 88,
      currentLocationId: 9,
      organizations: [
        {
          ...resumeSession.organizations[0],
          selected: true,
        },
      ],
    };

    authMocks.fetchCustomerSession
      .mockResolvedValueOnce({ ...resumeSession, organizations: [] })
      .mockResolvedValueOnce(resumeSession)
      .mockResolvedValueOnce(restoredSession);
    authMocks.createCustomerProspectOrganization.mockRejectedValueOnce(Object.assign(new Error("This account already has a prospective organization."), { status: 409 }));
    authMocks.selectCustomerOrganization.mockResolvedValueOnce({
      organization: restoredSession.organizations[0].organization,
      membershipRole: "owner",
      currentLocationId: 9,
    });

    renderPage();

    await screen.findByRole("heading", { name: "Set up your first restaurant" });
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Existing Bistro" } });
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Dining Room" } });
    fireEvent.click(screen.getByRole("button", { name: /Create your workspace/i }));

    await waitFor(() => expect(authMocks.selectCustomerOrganization).toHaveBeenCalledWith(88));
    expect(await screen.findByRole("heading", { name: "Customer setup" })).toBeVisible();
    expect(screen.getByText(/Existing Bistro/)).toBeVisible();
    expect(screen.queryByText("This account already has a prospective organization.")).not.toBeInTheDocument();
  });
});
