import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthCompletePage } from "../../src/pages/GoogleAuthCompletePage";

const authMocks = vi.hoisted(() => ({
  fetchCustomerSession: vi.fn(),
  createCustomerProspectOrganization: vi.fn(),
  consumeLoginReturnTo: vi.fn(),
  requestCustomerSetup: vi.fn(),
  logoutCustomer: vi.fn(),
  selectCustomerOrganization: vi.fn(),
  startGoogleLogin: vi.fn(),
}));

vi.mock("../../src/lib/customerAuth", () => ({
  fetchCustomerSession: authMocks.fetchCustomerSession,
  createCustomerProspectOrganization: authMocks.createCustomerProspectOrganization,
  consumeLoginReturnTo: authMocks.consumeLoginReturnTo,
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
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.consumeLoginReturnTo.mockReturnValue(null);
  });

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
          organization: { id: 42, name: "Demo Bistro", lifecycleStatus: "READY_FOR_REVIEW", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAYMENT_PENDING", isProspect: true },
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

    await screen.findByRole("heading", { name: "Request Flowtally access" });
    fireEvent.change(screen.getByLabelText("Restaurant name"), { target: { value: "Demo Bistro" } });
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Dining Room" } });
    fireEvent.click(screen.getByRole("button", { name: /Request setup/i }));

    await waitFor(() => expect(authMocks.fetchCustomerSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Welcome back, owner@example.com")).toBeVisible();
    expect(screen.getByText("Logged-in prospect")).toBeVisible();
    expect(screen.getByText(/Request received/)).toBeVisible();
  });

  it("preserves a created organization when request submission fails and retries without duplicating it", async () => {
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
      organizations: [{ organization: { id: 42, name: "Demo Bistro", lifecycleStatus: "ONBOARDING", setupStatus: "INTAKE", subscriptionStatus: "NONE", isProspect: true }, membershipRole: "owner", selected: true }],
    };
    const requestedSession = {
      ...createdSession,
      organizations: [{ ...createdSession.organizations[0], organization: { ...createdSession.organizations[0].organization, lifecycleStatus: "READY_FOR_REVIEW", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAYMENT_PENDING" } }],
    };
    authMocks.fetchCustomerSession.mockResolvedValueOnce(initialSession).mockResolvedValueOnce(requestedSession);
    authMocks.createCustomerProspectOrganization.mockResolvedValueOnce({ organization: { id: 42, name: "Demo Bistro" }, membershipRole: "owner", currentLocationId: 8 });
    authMocks.requestCustomerSetup.mockRejectedValueOnce(new Error("Temporary setup service failure.")).mockResolvedValueOnce({ organization: requestedSession.organizations[0].organization });

    renderPage();
    await screen.findByRole("heading", { name: "Request Flowtally access" });
    fireEvent.change(screen.getByLabelText("Restaurant name"), { target: { value: "Demo Bistro" } });
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Dining Room" } });
    fireEvent.click(screen.getByRole("button", { name: /^Request setup$/i }));

    expect(await screen.findByText(/Information saved, but the request was not submitted/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Retry Request setup/i }));

    await waitFor(() => expect(authMocks.createCustomerProspectOrganization).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Request received/)).toBeVisible();
    expect(authMocks.requestCustomerSetup).toHaveBeenCalledTimes(2);
  });

  it("keeps request success separate when the follow-up session refresh fails", async () => {
    const initialSession = {
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: null,
      currentLocationId: null,
      organizations: [],
      csrfToken: "csrf-refresh",
    };
    authMocks.fetchCustomerSession.mockResolvedValueOnce(initialSession).mockRejectedValueOnce(new Error("Session refresh unavailable."));
    authMocks.createCustomerProspectOrganization.mockResolvedValueOnce({ organization: { id: 55, name: "Refresh Bistro" }, membershipRole: "owner", currentLocationId: 8 });
    authMocks.requestCustomerSetup.mockResolvedValueOnce({ organization: { id: 55, name: "Refresh Bistro" } });

    renderPage();
    await screen.findByRole("heading", { name: "Request Flowtally access" });
    fireEvent.change(screen.getByLabelText("Restaurant name"), { target: { value: "Refresh Bistro" } });
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Dining Room" } });
    fireEvent.click(screen.getByRole("button", { name: /^Request setup$/i }));

    expect(await screen.findByText(/Request received, but we could not refresh your status/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeVisible();
    expect(screen.queryByText(/request was not submitted/i)).not.toBeInTheDocument();
  });

  it("restores an existing prospect and lets the owner submit its pending request", async () => {
    const existingSession = {
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: 88,
      currentLocationId: 9,
      organizations: [{ organization: { id: 88, name: "Existing Bistro", lifecycleStatus: "ONBOARDING", setupStatus: "INTAKE", subscriptionStatus: "NONE", isProspect: true }, membershipRole: "owner", selected: true }],
      csrfToken: "csrf-4",
    };
    const requestedSession = {
      ...existingSession,
      organizations: [{ ...existingSession.organizations[0], organization: { ...existingSession.organizations[0].organization, lifecycleStatus: "READY_FOR_REVIEW", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAYMENT_PENDING" } }],
    };
    authMocks.fetchCustomerSession.mockResolvedValueOnce(existingSession).mockResolvedValueOnce(requestedSession);
    authMocks.requestCustomerSetup.mockResolvedValueOnce({ organization: requestedSession.organizations[0].organization });

    renderPage();
    await screen.findByRole("heading", { name: "Customer setup" });
    fireEvent.click(screen.getByRole("button", { name: "Request setup" }));

    await waitFor(() => expect(authMocks.requestCustomerSetup).toHaveBeenCalledWith(88));
    expect(await screen.findByText(/Request received/)).toBeVisible();
  });

  it("automatically resumes a single existing organization session", async () => {
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
    expect(screen.queryByRole("heading", { name: "Request Flowtally access" })).not.toBeInTheDocument();
    expect(screen.getByText("Logged-in prospect")).toBeVisible();
    expect(screen.getByText(/Prospect Cafe/)).toBeVisible();
    expect(authMocks.selectCustomerOrganization).toHaveBeenCalledWith(77);
  });

  it("shows a chooser when multiple memberships are available and no current organization is selected", async () => {
    const multiSession = {
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
        {
          organization: {
            id: 88,
            name: "Sister Bistro",
            lifecycleStatus: "ACTIVE",
            setupStatus: "COMPLETE",
            subscriptionStatus: "ACTIVE",
            isProspect: false,
          },
          membershipRole: "manager",
          selected: false,
        },
      ],
      csrfToken: "csrf-chooser",
    };

    authMocks.fetchCustomerSession.mockResolvedValueOnce(multiSession);

    renderPage();

    await screen.findByRole("heading", { name: "Pick the workspace to continue" });
    expect(screen.getByLabelText("Available organizations")).toBeVisible();
    expect(screen.getByRole("option", { name: /Prospect Cafe/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Sister Bistro/ })).toBeVisible();
    expect(authMocks.selectCustomerOrganization).not.toHaveBeenCalled();
  });

  it("continues into the selected workspace after choosing an organization", async () => {
    const multiSession = {
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
        {
          organization: {
            id: 88,
            name: "Sister Bistro",
            lifecycleStatus: "ACTIVE",
            setupStatus: "COMPLETE",
            subscriptionStatus: "ACTIVE",
            isProspect: false,
          },
          membershipRole: "manager",
          selected: false,
        },
      ],
      csrfToken: "csrf-chooser",
    };
    const resumedSession = {
      ...multiSession,
      currentOrganizationId: 88,
      currentLocationId: 12,
      organizations: [
        {
          ...multiSession.organizations[0],
          selected: false,
        },
        {
          ...multiSession.organizations[1],
          selected: true,
        },
      ],
    };

    authMocks.fetchCustomerSession
      .mockResolvedValueOnce(multiSession)
      .mockResolvedValueOnce(resumedSession);
    authMocks.selectCustomerOrganization.mockResolvedValueOnce({
      organization: resumedSession.organizations[1].organization,
      membershipRole: "manager",
      currentLocationId: 12,
    });

    renderPageWithAppRoute();

    await screen.findByRole("heading", { name: "Pick the workspace to continue" });
    fireEvent.change(screen.getByLabelText("Available organizations"), { target: { value: "88" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(authMocks.selectCustomerOrganization).toHaveBeenCalledWith(88));
    expect(await screen.findByText("App shell")).toBeVisible();
  });

  it("preserves an explicit current organization and continues normally", async () => {
    const resumedSession = {
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: 88,
      currentLocationId: 12,
      organizations: [
        {
          organization: {
            id: 88,
            name: "Sister Bistro",
            lifecycleStatus: "ACTIVE",
            setupStatus: "COMPLETE",
            subscriptionStatus: "ACTIVE",
            isProspect: false,
          },
          membershipRole: "owner",
          selected: true,
        },
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
      csrfToken: "csrf-4",
    };

    authMocks.fetchCustomerSession.mockResolvedValueOnce(resumedSession);

    renderPageWithAppRoute();

    expect(await screen.findByText("App shell")).toBeVisible();
    expect(authMocks.selectCustomerOrganization).not.toHaveBeenCalled();
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

    await screen.findByRole("heading", { name: "Request Flowtally access" });
    fireEvent.change(screen.getByLabelText("Restaurant name"), { target: { value: "Existing Bistro" } });
    fireEvent.change(screen.getByLabelText("Location name"), { target: { value: "Main Dining Room" } });
    fireEvent.click(screen.getByRole("button", { name: /Request setup/i }));

    await waitFor(() => expect(authMocks.selectCustomerOrganization).toHaveBeenCalledWith(88));
    expect(await screen.findByRole("heading", { name: "Customer setup" })).toBeVisible();
    expect(screen.getByText(/Existing Bistro/)).toBeVisible();
    expect(screen.queryByText("This account already has a prospective organization.")).not.toBeInTheDocument();
  });
});
