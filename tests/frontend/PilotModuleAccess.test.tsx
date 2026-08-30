import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDailyClosePage } from "../../src/pilot/PilotDailyClosePage";
import { PilotMenuCostingPage } from "../../src/pilot/PilotMenuCostingPage";
import { PilotSquarePage } from "../../src/pilot/PilotSquarePage";
import { PilotModuleGate } from "../../src/pilot/PilotModuleGate";
import { PilotSquareUsagePage } from "../../src/pilot/PilotSquareUsagePage";
import { PilotWorkspaceLayout } from "../../src/pilot/PilotWorkspaceLayout";
import { SquareIntegrationPage } from "../../src/pages/SquareIntegrationPage";

const sessionMock = vi.hoisted(() => ({
  usePilotSession: vi.fn(),
}));

const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotMenuCosting: vi.fn(),
  fetchPilotInventory: vi.fn(),
  fetchPilotDailyClose: vi.fn(),
  openPilotDailyClose: vi.fn(),
  updatePilotDailyClose: vi.fn(),
  finalizePilotDailyClose: vi.fn(),
  fetchPilotSquareStatus: vi.fn(),
  fetchPilotSquareCatalogMappings: vi.fn(),
  fetchPilotSquareUsage: vi.fn(),
  beginPilotSquareConnection: vi.fn(),
  disconnectPilotSquare: vi.fn(),
  syncPilotSquareLocations: vi.fn(),
  syncPilotSquareCatalog: vi.fn(),
  syncPilotSquareOrders: vi.fn(),
  updatePilotSquareLocationMapping: vi.fn(),
  updatePilotSquareCatalogMapping: vi.fn(),
}));

const squareIntegrationMocks = vi.hoisted(() => ({
  fetchCustomerSession: vi.fn(),
  fetchSquareStatus: vi.fn(),
  fetchSquareCatalogMappings: vi.fn(),
  fetchSquareUsage: vi.fn(),
  beginSquareConnection: vi.fn(),
  disconnectSquare: vi.fn(),
  syncSquareCatalog: vi.fn(),
  syncSquareLocations: vi.fn(),
  syncSquareOrders: vi.fn(),
  updateSquareCatalogMapping: vi.fn(),
  updateSquareLocationMapping: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: sessionMock.usePilotSession,
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotMenuCosting: pilotApiMocks.fetchPilotMenuCosting,
    fetchPilotInventory: pilotApiMocks.fetchPilotInventory,
    fetchPilotDailyClose: pilotApiMocks.fetchPilotDailyClose,
    openPilotDailyClose: pilotApiMocks.openPilotDailyClose,
    updatePilotDailyClose: pilotApiMocks.updatePilotDailyClose,
    finalizePilotDailyClose: pilotApiMocks.finalizePilotDailyClose,
    fetchPilotSquareStatus: pilotApiMocks.fetchPilotSquareStatus,
    fetchPilotSquareCatalogMappings: pilotApiMocks.fetchPilotSquareCatalogMappings,
    fetchPilotSquareUsage: pilotApiMocks.fetchPilotSquareUsage,
    beginPilotSquareConnection: pilotApiMocks.beginPilotSquareConnection,
    disconnectPilotSquare: pilotApiMocks.disconnectPilotSquare,
    syncPilotSquareLocations: pilotApiMocks.syncPilotSquareLocations,
    syncPilotSquareCatalog: pilotApiMocks.syncPilotSquareCatalog,
    syncPilotSquareOrders: pilotApiMocks.syncPilotSquareOrders,
    updatePilotSquareLocationMapping: pilotApiMocks.updatePilotSquareLocationMapping,
    updatePilotSquareCatalogMapping: pilotApiMocks.updatePilotSquareCatalogMapping,
  };
});

vi.mock("../../src/lib/customerAuth", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchCustomerSession: squareIntegrationMocks.fetchCustomerSession,
  };
});

vi.mock("../../src/lib/squareIntegration", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchSquareStatus: squareIntegrationMocks.fetchSquareStatus,
    fetchSquareCatalogMappings: squareIntegrationMocks.fetchSquareCatalogMappings,
    fetchSquareUsage: squareIntegrationMocks.fetchSquareUsage,
    beginSquareConnection: squareIntegrationMocks.beginSquareConnection,
    disconnectSquare: squareIntegrationMocks.disconnectSquare,
    syncSquareCatalog: squareIntegrationMocks.syncSquareCatalog,
    syncSquareLocations: squareIntegrationMocks.syncSquareLocations,
    syncSquareOrders: squareIntegrationMocks.syncSquareOrders,
    updateSquareCatalogMapping: squareIntegrationMocks.updateSquareCatalogMapping,
    updateSquareLocationMapping: squareIntegrationMocks.updateSquareLocationMapping,
  };
});

describe("Pilot module access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    sessionMock.usePilotSession.mockReturnValue({
      status: "signedIn",
      error: null,
      user: { id: 1, email: "owner@flowtally.local", isActive: true, createdAt: null, updatedAt: null },
      organization: { id: 42, name: "Variance Cafe" },
      enabledModuleKeys: ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS"],
      organizations: [],
      locations: [{ id: 7, name: "Line Kitchen" }],
      currentLocation: { id: 7, name: "Line Kitchen" },
      membershipRole: "owner",
      csrfToken: "csrf",
      refreshSession: vi.fn(),
      signIn: vi.fn(),
      switchOrganization: vi.fn(),
      switchLocation: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it("hides unavailable pilot nav items while keeping enabled routes visible", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <PilotWorkspaceLayout />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Purchases" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Inventory" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Menu Costing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Square" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Daily Close" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usage / Variance" })).not.toBeInTheDocument();
  });

  it("remembers the desktop sidebar preference", async () => {
    window.localStorage.setItem("flowtally:pilot-sidebar-collapsed", "true");

    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <PilotWorkspaceLayout />
      </MemoryRouter>,
    );

    const expandButtons = await screen.findAllByRole("button", { name: "Expand sidebar" });
    fireEvent.click(expandButtons[0]);
    expect((await screen.findAllByRole("button", { name: "Collapse sidebar" }))[0]).toBeVisible();
    expect(window.localStorage.getItem("flowtally:pilot-sidebar-collapsed")).toBe("false");
  });

  it("keeps the expanded sidebar context compact and the collapsed rail icon-only", () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <PilotWorkspaceLayout />
      </MemoryRouter>,
    );

    expect(screen.getByText("Organization")).toBeVisible();
    expect(screen.getByText("Location")).toBeVisible();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Variance Cafe · Line Kitchen")).not.toBeInTheDocument();

    const purchasesLink = screen.getByRole("link", { name: "Purchases" });
    expect(purchasesLink).toHaveTextContent(/Purchases.*P/);
  });

  it("removes workspace cards and shows a visible public-site icon when collapsed", async () => {
    window.localStorage.setItem("flowtally:pilot-sidebar-collapsed", "true");

    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <PilotWorkspaceLayout />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Variance Cafe")).not.toBeInTheDocument();

    const publicSiteLink = screen.getByRole("link", { name: "Public site" });
    expect(publicSiteLink).toBeVisible();
    expect(publicSiteLink.querySelector("svg")).not.toBeNull();
  });

  it("shows a module unavailable state for menu costing without mounting the page", async () => {
    render(
      <MemoryRouter initialEntries={["/app/menu-costing"]}>
        <PilotModuleGate moduleKey="MENU_COSTING" moduleName="Menu Costing">
          <PilotMenuCostingPage />
        </PilotModuleGate>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Menu Costing is not available for this organization")).toBeVisible();
    expect(pilotApiMocks.fetchPilotMenuCosting).not.toHaveBeenCalled();
    expect(pilotApiMocks.fetchPilotInventory).not.toHaveBeenCalled();
  });

  it("blocks square-dependent pages before they can fetch", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations/square"]}>
        <PilotModuleGate moduleKey="SQUARE_INTEGRATION" moduleName="Square Integration">
          <SquareIntegrationPage />
        </PilotModuleGate>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Square Integration is not available for this organization")).toBeVisible();
    await waitFor(() => expect(squareIntegrationMocks.fetchCustomerSession).not.toHaveBeenCalled());
    expect(squareIntegrationMocks.fetchSquareStatus).not.toHaveBeenCalled();
    expect(squareIntegrationMocks.fetchSquareCatalogMappings).not.toHaveBeenCalled();
    expect(squareIntegrationMocks.fetchSquareUsage).not.toHaveBeenCalled();
  });

  it("blocks the pilot Square page before it can fetch", async () => {
    render(
      <MemoryRouter initialEntries={["/app/square"]}>
        <PilotModuleGate moduleKey="SQUARE_INTEGRATION" moduleName="Square Integration">
          <PilotSquarePage />
        </PilotModuleGate>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Square Integration is not available for this organization")).toBeVisible();
    expect(pilotApiMocks.fetchPilotSquareStatus).not.toHaveBeenCalled();
    expect(pilotApiMocks.fetchPilotSquareCatalogMappings).not.toHaveBeenCalled();
    expect(pilotApiMocks.fetchPilotSquareUsage).not.toHaveBeenCalled();
    expect(pilotApiMocks.beginPilotSquareConnection).not.toHaveBeenCalled();
    expect(pilotApiMocks.disconnectPilotSquare).not.toHaveBeenCalled();
    expect(pilotApiMocks.syncPilotSquareLocations).not.toHaveBeenCalled();
    expect(pilotApiMocks.syncPilotSquareCatalog).not.toHaveBeenCalled();
    expect(pilotApiMocks.syncPilotSquareOrders).not.toHaveBeenCalled();
    expect(pilotApiMocks.updatePilotSquareLocationMapping).not.toHaveBeenCalled();
    expect(pilotApiMocks.updatePilotSquareCatalogMapping).not.toHaveBeenCalled();
  });

  it("blocks daily close before it can fetch", async () => {
    render(
      <MemoryRouter initialEntries={["/app/daily-close"]}>
        <PilotModuleGate moduleKey="DAILY_CLOSE" moduleName="Daily Close">
          <PilotDailyClosePage />
        </PilotModuleGate>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Daily Close is not available for this organization")).toBeVisible();
    expect(pilotApiMocks.fetchPilotDailyClose).not.toHaveBeenCalled();
    expect(pilotApiMocks.openPilotDailyClose).not.toHaveBeenCalled();
    expect(pilotApiMocks.updatePilotDailyClose).not.toHaveBeenCalled();
    expect(pilotApiMocks.finalizePilotDailyClose).not.toHaveBeenCalled();
  });
});
