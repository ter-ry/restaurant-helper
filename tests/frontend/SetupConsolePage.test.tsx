import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupConsolePage } from "../../src/pages/SetupConsolePage";

const platformSetupMocks = vi.hoisted(() => ({
  fetchCustomerSession: vi.fn(),
  fetchSetupOrganizations: vi.fn(),
  fetchSetupOrganization: vi.fn(),
  fetchSupportGrants: vi.fn(),
  updateSetupTemplate: vi.fn(),
  updateSetupState: vi.fn(),
  updateModuleEntitlements: vi.fn(),
  updateLocations: vi.fn(),
  updateDashboardLayout: vi.fn(),
  updateCustomFields: vi.fn(),
  updateLaunchBlockers: vi.fn(),
  updateInternalNotes: vi.fn(),
  updateImports: vi.fn(),
  updateSquareStatus: vi.fn(),
  requestCustomerReview: vi.fn(),
  approveCustomerReview: vi.fn(),
  activateSetupOrganization: vi.fn(),
  createSupportGrant: vi.fn(),
  revokeSupportGrant: vi.fn(),
}));

vi.mock("../../src/lib/customerAuth", () => ({
  fetchCustomerSession: platformSetupMocks.fetchCustomerSession,
  startGoogleLogin: vi.fn(),
}));

vi.mock("../../src/lib/platformSetup", () => ({
  fetchSetupOrganizations: platformSetupMocks.fetchSetupOrganizations,
  fetchSetupOrganization: platformSetupMocks.fetchSetupOrganization,
  fetchSupportGrants: platformSetupMocks.fetchSupportGrants,
  updateSetupTemplate: platformSetupMocks.updateSetupTemplate,
  updateSetupState: platformSetupMocks.updateSetupState,
  updateModuleEntitlements: platformSetupMocks.updateModuleEntitlements,
  updateLocations: platformSetupMocks.updateLocations,
  updateDashboardLayout: platformSetupMocks.updateDashboardLayout,
  updateCustomFields: platformSetupMocks.updateCustomFields,
  updateLaunchBlockers: platformSetupMocks.updateLaunchBlockers,
  updateInternalNotes: platformSetupMocks.updateInternalNotes,
  updateImports: platformSetupMocks.updateImports,
  updateSquareStatus: platformSetupMocks.updateSquareStatus,
  requestCustomerReview: platformSetupMocks.requestCustomerReview,
  approveCustomerReview: platformSetupMocks.approveCustomerReview,
  activateSetupOrganization: platformSetupMocks.activateSetupOrganization,
  createSupportGrant: platformSetupMocks.createSupportGrant,
  revokeSupportGrant: platformSetupMocks.revokeSupportGrant,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/platform/setup"]}>
      <SetupConsolePage />
    </MemoryRouter>,
  );
}

function makeSession() {
  return {
    user: { id: 1, email: "setup.admin@example.com", isActive: true, createdAt: null, updatedAt: null },
    platformRole: "setup_admin",
    membershipRole: null,
    currentOrganizationId: null,
    currentLocationId: null,
    csrfToken: "csrf-token",
    organizations: [
      {
        organization: {
          id: 42,
          name: "Demo Bistro",
          lifecycleStatus: "READY_FOR_REVIEW",
          setupStatus: "CUSTOMER_REVIEW",
          subscriptionStatus: "SETUP_PAID",
          setupTemplateKey: "GENERIC_RESTAURANT",
          setupFeeStatus: "confirmed",
          isProspect: true,
          activeAt: null,
          setupCompletedAt: null,
          createdAt: null,
          updatedAt: null,
        },
        membershipRole: "owner",
        selected: true,
      },
    ],
  };
}

function makeDetail(missingModules: string[] = ["PURCHASES"]) {
  return {
    organization: {
      id: 42,
      name: "Demo Bistro",
      lifecycleStatus: "READY_FOR_REVIEW",
      onboardingStatus: "ONBOARDING",
      setupStatus: "CUSTOMER_REVIEW",
      subscriptionStatus: "SETUP_PAID",
      setupTemplateKey: "GENERIC_RESTAURANT",
      setupFeeStatus: "confirmed",
      isProspect: true,
      activeAt: null,
      setupCompletedAt: null,
      createdAt: null,
      updatedAt: null,
    },
    checklist: {
      ownerCount: 1,
      locationCount: 1,
      setupFeeStatus: "confirmed",
      setupStatus: "CUSTOMER_REVIEW",
      subscriptionStatus: "SETUP_PAID",
      launchBlockers: [],
      missingModules,
      squareRequired: true,
      squareComplete: true,
      customerApproved: false,
      readyForActivation: missingModules.length === 0,
    },
    locations: [{ id: 7, name: "Main Dining Room", city: "Toronto" }],
    modules: [
      { key: "PURCHASES", status: missingModules.includes("PURCHASES") ? "SETUP_REQUIRED" : "ENABLED", configuration: {}, enabledAt: null },
      { key: "INVENTORY", status: missingModules.includes("INVENTORY") ? "SETUP_REQUIRED" : "ENABLED", configuration: {}, enabledAt: null },
      { key: "REORDER_PLANS", status: missingModules.includes("REORDER_PLANS") ? "SETUP_REQUIRED" : "ENABLED", configuration: {}, enabledAt: null },
      { key: "STOCK_COUNTS", status: missingModules.includes("STOCK_COUNTS") ? "SETUP_REQUIRED" : "ENABLED", configuration: {}, enabledAt: null },
    ],
    memberships: [
      {
        id: 1,
        role: "owner",
        createdAt: null,
        user: { id: 1, email: "setup.admin@example.com", isActive: true, createdAt: null, updatedAt: null },
      },
    ],
    configuration: {
      currentVersion: {
        configurationJson: {
          dashboardLayouts: { owner: { layoutKey: "owner", widgets: ["dashboard"] } },
          customFields: { supplier: [], inventoryItem: [], purchaseInvoice: [] },
          launchBlockers: [],
          imports: [],
          square: { required: false, locationMappings: [] },
          internalNotes: [],
        },
      },
    },
    auditEvents: [],
    platformRole: "setup_admin",
  };
}

function setModuleStatus(moduleKey: string, value: string) {
  const select = document.getElementById(`module-${moduleKey}`) as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  fireEvent.change(select as HTMLSelectElement, { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  platformSetupMocks.fetchCustomerSession.mockResolvedValue(makeSession());
  platformSetupMocks.fetchSetupOrganizations.mockResolvedValue({
    organizations: [
      {
        organization: makeDetail().organization,
        checklist: makeDetail().checklist,
        locations: makeDetail().locations,
        modules: makeDetail().modules,
      },
    ],
  });
  platformSetupMocks.fetchSetupOrganization.mockResolvedValue(makeDetail());
  platformSetupMocks.fetchSupportGrants.mockResolvedValue({ grants: [] });
  platformSetupMocks.updateSetupTemplate.mockResolvedValue(makeDetail());
  platformSetupMocks.updateSetupState.mockResolvedValue(makeDetail());
  platformSetupMocks.updateModuleEntitlements.mockResolvedValue(makeDetail(["PURCHASES"]));
  platformSetupMocks.updateLocations.mockResolvedValue(makeDetail());
  platformSetupMocks.updateDashboardLayout.mockResolvedValue(makeDetail());
  platformSetupMocks.updateCustomFields.mockResolvedValue(makeDetail());
  platformSetupMocks.updateLaunchBlockers.mockResolvedValue(makeDetail());
  platformSetupMocks.updateInternalNotes.mockResolvedValue(makeDetail());
  platformSetupMocks.updateImports.mockResolvedValue(makeDetail());
  platformSetupMocks.updateSquareStatus.mockResolvedValue(makeDetail());
  platformSetupMocks.requestCustomerReview.mockResolvedValue(makeDetail());
  platformSetupMocks.approveCustomerReview.mockResolvedValue(makeDetail());
  platformSetupMocks.activateSetupOrganization.mockResolvedValue(makeDetail([]));
  platformSetupMocks.createSupportGrant.mockResolvedValue({ grant: { id: 1 } });
  platformSetupMocks.revokeSupportGrant.mockResolvedValue({ grant: { id: 1 } });
});

describe("SetupConsolePage", () => {
  it("shows saving state, prevents duplicate save clicks, and refreshes authoritative module data", async () => {
    let resolveUpdate!: (value: unknown) => void;
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    platformSetupMocks.updateModuleEntitlements.mockReturnValueOnce(updatePromise);
    platformSetupMocks.fetchSetupOrganization.mockResolvedValueOnce(makeDetail(["PURCHASES"])).mockResolvedValueOnce(makeDetail([]));

    renderPage();

    await screen.findByRole("heading", { name: "Internal setup console" });
    setModuleStatus("PURCHASES", "ENABLED");
    setModuleStatus("INVENTORY", "ENABLED");
    setModuleStatus("REORDER_PLANS", "ENABLED");
    setModuleStatus("STOCK_COUNTS", "ENABLED");

    const saveButton = screen.getByRole("button", { name: "Save modules" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Saving..." }));
    expect(platformSetupMocks.updateModuleEntitlements).toHaveBeenCalledTimes(1);

    resolveUpdate(makeDetail([]));

    await waitFor(() => expect(platformSetupMocks.fetchSetupOrganization).toHaveBeenCalledTimes(2));
    await screen.findByText("Modules saved", { selector: "p" });
    expect(screen.getByText("Missing modules").parentElement).toHaveTextContent("None");
    expect(screen.getByText("Ready").parentElement).toHaveTextContent("Yes");
    expect(screen.getByRole("button", { name: "Modules saved" })).toBeVisible();
    expect(platformSetupMocks.fetchSupportGrants).toHaveBeenCalledTimes(2);
  });

  it("shows visible failure feedback and does not leave a false saved state on error", async () => {
    let rejectUpdate!: (reason?: unknown) => void;
    const updatePromise = new Promise((_, reject) => {
      rejectUpdate = reject;
    });
    platformSetupMocks.updateModuleEntitlements.mockReturnValueOnce(updatePromise);

    renderPage();

    await screen.findByRole("heading", { name: "Internal setup console" });
    setModuleStatus("PURCHASES", "ENABLED");
    const saveButton = screen.getByRole("button", { name: "Save modules" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled());
    rejectUpdate(new Error("Request failed with status 500"));
    await screen.findByText("Request failed with status 500");
    expect(screen.queryByText("Modules saved")).not.toBeInTheDocument();
    expect(screen.getByText("Save failed")).toBeVisible();
  });
});
