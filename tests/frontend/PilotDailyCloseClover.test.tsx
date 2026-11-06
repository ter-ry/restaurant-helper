import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDailyClosePage } from "../../src/pilot/PilotDailyClosePage";

const pilotSessionMock = vi.hoisted(() => ({ usePilotSession: vi.fn() }));
const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotDailyClose: vi.fn(),
  openPilotDailyClose: vi.fn(),
  syncPilotDailyCloseSales: vi.fn(),
  updatePilotDailyClose: vi.fn(),
  finalizePilotDailyClose: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({ usePilotSession: pilotSessionMock.usePilotSession }));
vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, ...pilotApiMocks };
});

const usage = {
  period: { startAt: "2026-08-30T04:00:00Z", endAt: "2026-08-31T03:59:59Z" },
  coverage: {},
  totals: { theoreticalUsage: null, actualUsage: null, discrepancy: null, discrepancyPercent: null },
  contributingMenuItems: [],
  unmappedVariations: [],
  ingredientUsage: [],
};

function cloverResponse(overrides: { sales?: Record<string, unknown>; cash?: Record<string, unknown>; foodCost?: Record<string, unknown>; attention?: unknown[] } = {}) {
  const snapshot = {
    provider: "clover",
    healthStatus: "Ready",
    inventoryValue: 100,
    sales: { provider: "clover", cloverStatus: "connected", locationMapped: true, orders: 4, netSales: 36, netSalesAvailable: true, tax: 4.68, tips: 1.5, deliveryOrders: 1, excludedOrders: 0, grossSales: null, discounts: null, refunds: null, cancelledOrders: null, ...overrides.sales },
    usage,
    foodCost: { available: true, usageCostCents: 400, netSalesCents: 3600, percent: 11.11, unavailableReason: null, ...overrides.foodCost },
    variance: { quantity: null, percent: null, value: null },
    reconciliation: { recordedWasteQuantity: 0, recordedWasteCost: 0, otherAdjustmentQuantity: 0 },
    cashReconciliation: { status: "available", mode: "clover_cash_tenders", expectedCash: 12.8, openingFloat: null, cashPayments: 12.8, cashRefunds: null, paidIn: null, paidOut: null, closedCash: null, reason: null, ...overrides.cash },
    attentionItems: overrides.attention ?? [],
    manualReconciliation: {},
    readyToFinalize: true,
  };
  return {
    session: null,
    snapshot,
    usage,
    exceptions: [],
    history: [],
    location: { id: 7, name: "Queen St Cafe", timezone: "America/Toronto" },
    businessDate: "2026-08-30",
    square: null,
  };
}

function withSession(response: ReturnType<typeof cloverResponse>) {
  return {
    ...response,
    session: { id: 9, organizationId: 42, locationId: 7, businessDate: "2026-08-30", status: "DRAFT", summarySnapshot: {}, usageSnapshot: {}, exceptionsSnapshot: [], notes: "", completedAt: null, completedByUserId: null, createdByUserId: 1, createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z", currentSnapshot: response.snapshot },
  };
}

describe("PilotDailyClosePage with a Clover location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pilotSessionMock.usePilotSession.mockReturnValue({
      organization: { id: 42, name: "Clover Cafe" },
      currentLocation: { id: 7, name: "Queen St Cafe", timezone: "America/Toronto" },
      locations: [{ id: 7, name: "Queen St Cafe" }],
    });
  });

  it("identifies Clover, shows exact net sales, food cost and verified expected cash, and never mentions Square", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue(withSession(cloverResponse()));
    const { container } = render(<MemoryRouter><PilotDailyClosePage /></MemoryRouter>);

    expect(await screen.findByTestId("clover-sales")).toBeInTheDocument();
    expect(screen.getByTestId("clover-net-sales")).toHaveTextContent("$36.00");
    expect(screen.getByTestId("clover-food-cost")).toHaveTextContent("11.11%");
    expect(screen.getByTestId("clover-data-basis")).toBeInTheDocument();
    const settingsLinks = screen.getAllByRole("link", { name: /Open Clover settings/ });
    expect(settingsLinks.length).toBeGreaterThan(0);
    settingsLinks.forEach((link) => expect(link).toHaveAttribute("href", "/app/square"));
    expect(screen.getAllByText("Clover").length).toBeGreaterThan(0);
    expect(screen.getByText("$12.80")).toBeInTheDocument(); // expected cash from verified Clover cash tenders
    expect(container.textContent).not.toMatch(/Square/);
    expect(screen.queryByText("Refunds")).not.toBeInTheDocument();
  });

  it("calculates the over/short from the counted cash against the verified Clover expected cash", async () => {
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue(withSession(cloverResponse()));
    render(<MemoryRouter><PilotDailyClosePage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Counted cash"), { target: { value: "12.30" } });
    expect(await screen.findByText(/\$0\.50 short/)).toBeInTheDocument();
  });

  it("shows unavailable, never $0.00 or gross, when net sales and cash cannot be verified", async () => {
    const reason = "Cash reconciliation unavailable: 1 Clover order(s) for this day need review, so the cash taken cannot be verified.";
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue(withSession(cloverResponse({
      sales: { netSales: null, netSalesAvailable: false, tips: null },
      foodCost: { available: false, percent: null, usageCostCents: 400, unavailableReason: "Net sales are unavailable." },
      cash: { status: "unavailable", expectedCash: null, cashPayments: null, reason, expectedCashUnavailableReason: reason, varianceStatus: "unavailable", varianceUnavailableReason: reason },
    })));
    const { container } = render(<MemoryRouter><PilotDailyClosePage /></MemoryRouter>);

    expect(await screen.findByTestId("clover-net-sales")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("clover-food-cost")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("clover-food-cost-reason")).toHaveTextContent("Net sales are unavailable.");
    expect(within(screen.getByTestId("clover-sales")).queryByText("$0.00")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: "50" } });
    const unavailable = await screen.findByTestId("variance-unavailable");
    expect(unavailable).toHaveTextContent(reason);
    expect(screen.getByText("Variance unavailable")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Square/);
  });

  it("saves the counted cash and completes the close through the existing Clover-neutral endpoints", async () => {
    const draft = withSession(cloverResponse());
    pilotApiMocks.fetchPilotDailyClose.mockResolvedValue(draft);
    const completed = { ...draft, session: { ...draft.session, status: "COMPLETED", completedAt: "2026-08-31T02:00:00Z" } };
    pilotApiMocks.updatePilotDailyClose.mockResolvedValue(draft);
    pilotApiMocks.finalizePilotDailyClose.mockResolvedValue(completed);
    render(<MemoryRouter><PilotDailyClosePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Counted cash"), { target: { value: "12.80" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete close" }));
    await waitFor(() => expect(pilotApiMocks.finalizePilotDailyClose).toHaveBeenCalledWith(9));
    expect(pilotApiMocks.updatePilotDailyClose).toHaveBeenCalledWith(9, expect.objectContaining({ reconciliation: { countedCash: 12.8 } }));
    expect(pilotApiMocks.syncPilotDailyCloseSales).not.toHaveBeenCalled();
    expect(await screen.findByText("Completed snapshot")).toBeInTheDocument();
  });
});
