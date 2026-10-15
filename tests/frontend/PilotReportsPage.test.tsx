import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotReportsPage } from "../../src/pilot/PilotReportsPage";

const mockFetch = vi.hoisted(() => vi.fn());
vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return { ...actual, fetchPilotReport: mockFetch };
});

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({ currentLocation: { id: 1, timezone: "America/Toronto" } }),
}));

const report = {
  scope: { organizationId: 1, locationId: 1, locationName: "Harbour Kitchen", timezone: "America/Toronto" },
  period: { view: "daily", startDate: "2026-10-07", endDate: "2026-10-07", priorStartDate: null, priorEndDate: null },
  sales: { currency: "CAD", grossItemSales: 180, discounts: 2.7, tax: 0, tips: 4.5, refunds: 0, totalCollected: 181.8, orderCount: 8, unitsSold: 10, cancelledOrderCount: 0, source: "square_daily_sales_summaries", byMenuItem: [{ menuItemId: 1, name: "Harbour Burger", category: "Burgers", quantity: 10, grossAmount: 180, netAmount: 177.3, costAvailable: true, estimatedFoodCostPercent: 12.3, quantityDelta: 10, quantityDeltaPercent: null }, { menuItemId: 2, name: "Truffle Special", category: "Mains", quantity: 2, grossAmount: 400, netAmount: 400, costAvailable: true, estimatedFoodCostPercent: 8, quantityDelta: 2, quantityDeltaPercent: null }], unmappedLines: [] },
  purchasing: {}, inventory: {}, costing: { estimatedFoodCostPercent: 12.3, costCoveragePercent: 100, costReadySalesAmount: 177.3, totalMappedMenuSalesAmount: 177.3 }, variance: {}, usageVariance: { valid: false, message: "No completed count evidence", rows: [] }, changes: null, exceptions: [{ type: "missing_count_evidence", title: "Count evidence unavailable", detail: "No completed count brackets this period." }, { type: "usage_variance", title: "Usage needs review", detail: "Review physical usage." }, { type: "reorder_now", title: "Reorder pressure", detail: "Review stock." }, { type: "unmapped_square_sales", title: "Square mappings needed", detail: "Map imported sales." }], generatedAt: "2026-10-07T14:00:00Z",
};

describe("PilotReportsPage", () => {
  beforeEach(() => { mockFetch.mockReset(); mockFetch.mockResolvedValue(report); });

  it("shows sales, menu performance and current-cost coverage", async () => {
    render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("Harbour Burger").length).toBeGreaterThan(0));
    expect(screen.getByRole("heading", { name: "Daily report" })).toBeInTheDocument();
    expect(screen.queryByText("How was the day?")).not.toBeInTheDocument();
    expect(screen.queryByText("See what happened and what needs attention.")).not.toBeInTheDocument();
    expect(screen.getByText("Sales breakdown")).toBeInTheDocument();
    expect(screen.queryByText("The financial detail behind total collected.")).not.toBeInTheDocument();
    expect(screen.getByText("Menu-item breakdown")).toBeInTheDocument();
    expect(screen.getByText("Total collected")).toBeInTheDocument();
    expect(screen.getByText("Physical variance not available for this full business day. Flowtally will calculate it when valid opening and closing counts bracket the period.")).toBeInTheDocument();
    expect(screen.getByText("$181.80")).toBeInTheDocument();
    expect(screen.getByText("Units sold")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Daily" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Weekly" })).not.toBeInTheDocument();
    expect(screen.getByText("Menu performance")).toBeInTheDocument();
    expect(screen.getByText("Most ordered")).toBeInTheDocument();
    expect(screen.getByText("10 units")).toBeInTheDocument();

    expect(screen.queryByText("Count evidence unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review usage" })).toHaveAttribute("href", "/app/inventory?view=usage");
    expect(screen.getByRole("link", { name: "Review reorder" })).toHaveAttribute("href", "/app/inventory?view=reorder");
    expect(screen.getByRole("link", { name: "Review mappings" })).toHaveAttribute("href", "/app/square");
  });
it("ranks weekly menu movers by absolute quantity change", async () => {
    mockFetch.mockResolvedValueOnce({
      ...report,
      period: { ...report.period, view: "weekly", priorStartDate: "2026-09-30", priorEndDate: "2026-10-06" },
      changes: {
        sales: { current: 200, delta: 10, percent: 5 },
        orders: { current: 8, delta: 1, percent: 14 },
        purchaseSpend: { current: 100, delta: -20, percent: -17 },
        menuMovers: [
          { menuItemId: 1, name: "Small change", currentQuantity: 3, priorQuantity: 2, quantityDelta: 1, quantityDeltaPercent: 50 },
          { menuItemId: 2, name: "Largest change", currentQuantity: 12, priorQuantity: 3, quantityDelta: 9, quantityDeltaPercent: 300 },
        ],
      },
    });
    render(<MemoryRouter><PilotReportsPage initialView="weekly" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Menu movers")).toBeInTheDocument());
    const pageText = document.body.textContent ?? "";
    expect(pageText.indexOf("Largest change")).toBeLessThan(pageText.indexOf("Small change"));
    expect(screen.getByRole("heading", { name: "Weekly report" })).toBeInTheDocument();
    expect(screen.getByText("Period comparison")).toBeInTheDocument();
    expect(screen.queryByText("Period-over-period movement using the selected business dates.")).not.toBeInTheDocument();
    expect(screen.queryByText("Period-over-period quantity changes, ranked by magnitude.")).not.toBeInTheDocument();
    expect(screen.queryByText("What changed this week?")).not.toBeInTheDocument();
    expect(screen.queryByText("What changed")).not.toBeInTheDocument();
  });
  it("lets a lone report card use the full row", async () => {
    mockFetch.mockResolvedValueOnce({ ...report, exceptions: [] });
    render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Menu performance")).toBeInTheDocument());
    expect(screen.getByText("Menu performance").closest("div.grid")).not.toHaveClass("lg:grid-cols-2");

    mockFetch.mockResolvedValueOnce({
      ...report,
      period: { ...report.period, view: "weekly" },
      changes: { sales: { current: 10, delta: 0, percent: 0 }, orders: { current: 1, delta: 0, percent: 0 }, purchaseSpend: { current: 5, delta: 0, percent: 0 }, menuMovers: [] },
      exceptions: [],
    });
    render(<MemoryRouter><PilotReportsPage initialView="weekly" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Period comparison")).toBeInTheDocument());
    expect(screen.getByText("Period comparison").closest("div.grid")).not.toHaveClass("lg:grid-cols-2");
  });

});
