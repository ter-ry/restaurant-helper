import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDailyClosePage } from "../../src/pilot/PilotDailyClosePage";

const pilotSessionMock = vi.hoisted(() => ({
  usePilotSession: vi.fn(),
}));

const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotDailyClose: vi.fn(),
  openPilotDailyClose: vi.fn(),
  syncPilotDailyCloseSales: vi.fn(),
  updatePilotDailyClose: vi.fn(),
  finalizePilotDailyClose: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: pilotSessionMock.usePilotSession,
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotDailyClose: pilotApiMocks.fetchPilotDailyClose,
    openPilotDailyClose: pilotApiMocks.openPilotDailyClose,
    syncPilotDailyCloseSales: pilotApiMocks.syncPilotDailyCloseSales,
    updatePilotDailyClose: pilotApiMocks.updatePilotDailyClose,
    finalizePilotDailyClose: pilotApiMocks.finalizePilotDailyClose,
  };
});

describe("PilotDailyClosePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pilotSessionMock.usePilotSession.mockReturnValue({
      organization: { id: 42, name: "Variance Cafe" },
      currentLocation: { id: 7, name: "Line Kitchen" },
      locations: [{ id: 7, name: "Line Kitchen" }],
    });
  });

  it("starts a daily close and keeps square context visible", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue({
      session: null,
      snapshot: {
        healthStatus: "Open",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: null, percent: null, value: 0 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: [],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });
    pilotApiMocks.openPilotDailyClose.mockResolvedValue({
      session: {
        id: 9,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-30",
        status: "DRAFT",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "",
        completedAt: null,
        completedByUserId: null,
        createdByUserId: 1,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
      },
      snapshot: {
        healthStatus: "Open",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: null, percent: null, value: 0 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: [],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });

    render(
      <MemoryRouter>
        <PilotDailyClosePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Close the day with a clear snapshot" })).toBeVisible();
    expect(screen.getByLabelText("Business date")).toHaveValue("2026-08-30");
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Start daily close" }));
    await waitFor(() => expect(pilotApiMocks.openPilotDailyClose).toHaveBeenCalledWith({ locationId: 7, businessDate: "2026-08-30" }));
  });

  it("renders date-only business dates without a timezone shift", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue({
      session: null,
      snapshot: { healthStatus: "Open", inventoryValue: 0, sales: {}, usage: { totals: {}, ingredientUsage: [] }, variance: { quantity: null, percent: null, value: 0 }, square: {}, readyToFinalize: true },
      usage: { totals: {}, ingredientUsage: [] },
      exceptions: [],
      history: [{ id: 9, organizationId: 42, locationId: 7, businessDate: "2026-09-01", status: "DRAFT", notes: "", currentSnapshot: null }],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-09-01",
      square: {},
    });

    render(<MemoryRouter><PilotDailyClosePage /></MemoryRouter>);

    expect(await screen.findByText("Business date Sep 1")).toBeVisible();
    expect(screen.getByText("Sep 1")).toBeVisible();
  });

  it("syncs Square sales for the selected business date and refreshes the draft", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue({
      session: {
        id: 12,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-30",
        status: "DRAFT",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "Initial note",
        completedAt: null,
        completedByUserId: null,
        createdByUserId: 1,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
        currentSnapshot: {
          healthStatus: "Ready with warnings",
          inventoryValue: 1250,
          sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
          usage: {
            period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
            coverage: {},
            totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
            contributingMenuItems: [],
            unmappedVariations: [],
            ingredientUsage: [],
          },
          variance: { quantity: 1, percent: 5.6, value: 4.2 },
          square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
          readyToFinalize: true,
        },
      },
      snapshot: {
        healthStatus: "Ready with warnings",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: 1, percent: 5.6, value: 4.2 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: ["Square not synced."],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });
    pilotApiMocks.syncPilotDailyCloseSales.mockResolvedValue({
      session: {
        id: 12,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-30",
        status: "DRAFT",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "Initial note",
        completedAt: null,
        completedByUserId: null,
        createdByUserId: 1,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
        currentSnapshot: {
          healthStatus: "Reconciled",
          inventoryValue: 1250,
          sales: { netSales: 1234.56, orders: 18, refunds: 0, cancelledOrders: 0 },
          usage: {
            period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
            coverage: {},
            totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
            contributingMenuItems: [],
            unmappedVariations: [],
            ingredientUsage: [],
          },
          variance: { quantity: 1, percent: 5.6, value: 4.2 },
          square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
          readyToFinalize: true,
        },
      },
      snapshot: {
        healthStatus: "Reconciled",
        inventoryValue: 1250,
        sales: { netSales: 1234.56, orders: 18, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: 1, percent: 5.6, value: 4.2 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: ["Square not synced."],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });

    render(
      <MemoryRouter>
        <PilotDailyClosePage />
      </MemoryRouter>,
    );

    const syncButton = await screen.findByRole("button", { name: "Sync sales" });
    expect(syncButton).toBeEnabled();
    fireEvent.click(syncButton);
    await waitFor(() => expect(pilotApiMocks.syncPilotDailyCloseSales).toHaveBeenCalledWith(12, { businessDate: "2026-08-30" }));
    expect(await screen.findByText((text) => text.startsWith("Synced Square sales for"))).toBeVisible();
    expect(screen.getAllByText("$1,234.56").length).toBeGreaterThan(0);
  });

  it("shows Connect Square when the close is disconnected", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue({
      session: null,
      snapshot: {
        healthStatus: "Incomplete",
        inventoryValue: 1250,
        sales: { netSales: 0, orders: 0, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 0, actualUsage: null, discrepancy: null, discrepancyPercent: null },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: null, percent: null, value: 0 },
        square: { squareStatus: "Not connected", squareSynced: false, locationMapped: false },
        readyToFinalize: false,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 0, actualUsage: null, discrepancy: null, discrepancyPercent: null },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: ["Square not synced."],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Not connected", squareSynced: false, locationMapped: false },
    });

    render(
      <MemoryRouter>
        <PilotDailyClosePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Start a daily close")).toBeVisible();
    expect(screen.getByRole("link", { name: "Connect Square" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sync sales" })).not.toBeInTheDocument();
  });

  it("saves notes and finalizes an existing daily close", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue({
      session: {
        id: 12,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-30",
        status: "DRAFT",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "Initial note",
        completedAt: null,
        completedByUserId: null,
        createdByUserId: 1,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
        currentSnapshot: {
          healthStatus: "Ready with warnings",
          inventoryValue: 1250,
          sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
          usage: {
            period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
            coverage: {},
            totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
            contributingMenuItems: [],
            unmappedVariations: [],
            ingredientUsage: [
              {
                inventoryItemId: 1,
                inventoryItemName: "Chicken Breast",
                theoreticalUsage: 1.2,
                actualUsage: 1.0,
                discrepancy: -0.2,
                warnings: [],
              },
            ],
          },
          variance: { quantity: 1, percent: 5.6, value: 4.2 },
          square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
          readyToFinalize: true,
        },
      },
      snapshot: {
        healthStatus: "Ready with warnings",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: 1, percent: 5.6, value: 4.2 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: ["Square not synced."],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });
    pilotApiMocks.updatePilotDailyClose.mockResolvedValue({
      session: {
        id: 12,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-30",
        status: "DRAFT",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "Updated note",
        completedAt: null,
        completedByUserId: null,
        createdByUserId: 1,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T00:00:00Z",
        currentSnapshot: {
          healthStatus: "Ready with warnings",
          inventoryValue: 1250,
          sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
          usage: {
            period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
            coverage: {},
            totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
            contributingMenuItems: [],
            unmappedVariations: [],
            ingredientUsage: [],
          },
          variance: { quantity: 1, percent: 5.6, value: 4.2 },
          square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
          readyToFinalize: true,
        },
      },
      snapshot: {
        healthStatus: "Ready with warnings",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: 1, percent: 5.6, value: 4.2 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: ["Square not synced."],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });
    pilotApiMocks.finalizePilotDailyClose.mockResolvedValue({
      session: {
        id: 12,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-30",
        status: "COMPLETED",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: ["Square not synced."],
        notes: "Updated note",
        completedAt: "2026-08-30T23:59:00Z",
        completedByUserId: 1,
        createdByUserId: 1,
        createdAt: "2026-08-30T00:00:00Z",
        updatedAt: "2026-08-30T23:59:00Z",
        currentSnapshot: {
          healthStatus: "Reconciled",
          inventoryValue: 1250,
          sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
          usage: {
            period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
            coverage: {},
            totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
            contributingMenuItems: [],
            unmappedVariations: [],
            ingredientUsage: [],
          },
          variance: { quantity: 1, percent: 5.6, value: 4.2 },
          square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
          readyToFinalize: true,
        },
      },
      snapshot: {
        healthStatus: "Reconciled",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: 1, percent: 5.6, value: 4.2 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: ["Square not synced."],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });

    render(
      <MemoryRouter>
        <PilotDailyClosePage />
      </MemoryRouter>,
    );

    const notes = await screen.findByRole("textbox");
    expect(notes).toHaveValue("Initial note");
    fireEvent.change(notes, { target: { value: "Updated note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(pilotApiMocks.updatePilotDailyClose).toHaveBeenCalledWith(12, { notes: "Updated note" }));

    fireEvent.click(screen.getByRole("button", { name: "Finalize daily close" }));
    await waitFor(() => expect(pilotApiMocks.finalizePilotDailyClose).toHaveBeenCalledWith(12));
    expect(await screen.findByText("Completed daily close")).toBeVisible();
    expect(screen.getAllByText("Read only").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Sync sales" })).not.toBeInTheDocument();
  });

  it("opens a historical daily close from history and keeps the loaded session read-only", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValueOnce({
      session: null,
      snapshot: {
        healthStatus: "Open",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
          contributingMenuItems: [], unmappedVariations: [], ingredientUsage: [],
        },
        variance: { quantity: null, percent: null, value: 0 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
        contributingMenuItems: [], unmappedVariations: [], ingredientUsage: [],
      },
      exceptions: [],
      history: [
        {
          id: 77,
          organizationId: 42,
          locationId: 7,
          businessDate: "2026-08-29",
          status: "COMPLETED",
          summarySnapshot: {},
          usageSnapshot: {},
          exceptionsSnapshot: [],
          notes: "Closed yesterday",
          completedAt: "2026-08-29T23:59:00Z",
          completedByUserId: 1,
          createdByUserId: 1,
          createdAt: "2026-08-29T00:00:00Z",
          updatedAt: "2026-08-29T23:59:00Z",
        },
      ],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-30",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValueOnce({
      session: {
        id: 77,
        organizationId: 42,
        locationId: 7,
        businessDate: "2026-08-29",
        status: "COMPLETED",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "Closed yesterday",
        completedAt: "2026-08-29T23:59:00Z",
        completedByUserId: 1,
        createdByUserId: 1,
        createdAt: "2026-08-29T00:00:00Z",
        updatedAt: "2026-08-29T23:59:00Z",
        currentSnapshot: {
          healthStatus: "Reconciled",
          inventoryValue: 1250,
          sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
          usage: {
            period: { startAt: "2026-08-28T00:00:00Z", endAt: "2026-08-29T00:00:00Z" },
            coverage: {},
            totals: { theoreticalUsage: 16, actualUsage: 16, discrepancy: 0, discrepancyPercent: 0 },
            contributingMenuItems: [],
            unmappedVariations: [],
            ingredientUsage: [],
          },
          variance: { quantity: 0, percent: 0, value: 0 },
          square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
          readyToFinalize: true,
        },
      },
      snapshot: {
        healthStatus: "Reconciled",
        inventoryValue: 1250,
        sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
        usage: {
          period: { startAt: "2026-08-28T00:00:00Z", endAt: "2026-08-29T00:00:00Z" },
          coverage: {},
          totals: { theoreticalUsage: 16, actualUsage: 16, discrepancy: 0, discrepancyPercent: 0 },
          contributingMenuItems: [],
          unmappedVariations: [],
          ingredientUsage: [],
        },
        variance: { quantity: 0, percent: 0, value: 0 },
        square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
        readyToFinalize: true,
      },
      usage: {
        period: { startAt: "2026-08-28T00:00:00Z", endAt: "2026-08-29T00:00:00Z" },
        coverage: {},
        totals: { theoreticalUsage: 16, actualUsage: 16, discrepancy: 0, discrepancyPercent: 0 },
        contributingMenuItems: [],
        unmappedVariations: [],
        ingredientUsage: [],
      },
      exceptions: [],
      history: [],
      location: { id: 7, name: "Line Kitchen", timezone: "America/Toronto" },
      businessDate: "2026-08-29",
      square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    });

    render(
      <MemoryRouter>
        <PilotDailyClosePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Closed yesterday")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Open / }));
    await waitFor(() => expect(pilotApiMocks.fetchPilotDailyClose).toHaveBeenLastCalledWith(7, "2026-08-29"));
    expect(await screen.findByText("Completed daily close")).toBeVisible();
    expect(screen.getByLabelText("Business date")).toHaveValue("2026-08-29");
    expect(screen.getAllByText("Read only").length).toBeGreaterThan(0);
  });
});
