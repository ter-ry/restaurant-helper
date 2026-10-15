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
  purchasing: {}, inventory: {}, costing: { estimatedFoodCostPercent: 12.3, costCoveragePercent: 100, costReadySalesAmount: 177.3, totalMappedMenuSalesAmount: 177.3 }, variance: {}, usageVariance: { valid: false, message: "No completed count evidence", rows: [] }, changes: null, exceptions: [{ type: "missing_count_evidence", title: "Count evidence unavailable", detail: "No completed count brackets this period." }, { type: "usage_variance", title: "Usage needs review", detail: "Review physical usage." }, { type: "reorder", title: "Reorder pressure", detail: "Review stock." }], generatedAt: "2026-10-07T14:00:00Z",
};

describe("PilotReportsPage", () => {
  beforeEach(() => { mockFetch.mockReset(); mockFetch.mockResolvedValue(report); });

  it("shows sales, menu performance and current-cost coverage", async () => {
    render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("Harbour Burger").length).toBeGreaterThan(0));
    expect(screen.getByText("How was the day?")).toBeInTheDocument();
    expect(screen.getByText("Sales breakdown")).toBeInTheDocument();
    expect(screen.getByText("View menu-item breakdown")).toBeInTheDocument();
    expect(screen.getByText("Total collected")).toBeInTheDocument();
    expect(screen.getByText("Physical variance not available for this full business day. Flowtally will calculate it when valid opening and closing counts bracket the period.")).toBeInTheDocument();
    expect(screen.getByText("$181.80")).toBeInTheDocument();
    expect(screen.getByText("Units sold")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Daily" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Weekly" })).not.toBeInTheDocument();
    expect(screen.getByText("Most ordered item")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent?.includes("Harbour Burger") && element.textContent.includes("10 units.") ? true : false)).toBeInTheDocument();
    expect(screen.queryByText("Count evidence unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review usage" })).toHaveAttribute("href", "/app/inventory?view=usage");
    expect(screen.getByRole("link", { name: "Review reorder" })).toHaveAttribute("href", "/app/inventory?view=reorder");
  });
});
