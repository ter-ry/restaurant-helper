import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  describe("Clover locations", () => {
    const cloverSales = { currency: "CAD", source: "clover_orders", provider: "clover", status: "available", available: true, unavailableReason: null, includesToday: false, grossItemSales: null, discounts: null, refunds: null, cancelledOrderCount: null, netItemSales: 36, tax: 4.68, tips: 1.5, totalCollected: 42.18, orderCount: 4, unitsSold: 2, excludedOrderCount: 0, refundOrderCount: 0, verified: { orderCount: 4, netItemSales: 36, tax: 4.68, tips: 1.5 }, byMenuItem: [{ menuItemId: null, name: "Chicken Plate", category: "", quantity: 2, grossAmount: null, discountAmount: null, netAmount: null, costAvailable: false, estimatedFoodCostPercent: null, quantityDelta: 2, quantityDeltaPercent: null }], byMenuItemUnavailableReason: null, unmappedLines: [] };
    const cloverReport = {
      ...report, provider: "clover", sales: cloverSales,
      costing: { estimatedFoodCostPercent: 11.11, costCoveragePercent: null, costReadySalesAmount: null, totalMappedMenuSalesAmount: null, usageAvailable: true, usageCost: 4 },
      usageVariance: { valid: false, message: "Physical usage variance is not available for Clover locations yet.", rows: [] }, exceptions: [],
    };

    it("shows verified Clover figures, honest unavailable fields and no dollar value for what Clover cannot supply", async () => {
      mockFetch.mockResolvedValueOnce(cloverReport);
      render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText("$42.18")).toBeInTheDocument());
      expect(screen.queryByTestId("sales-unavailable")).not.toBeInTheDocument();
      expect(screen.getByText("$36.00")).toBeInTheDocument();
      expect(screen.getByText("11.1%")).toBeInTheDocument();
      // Gross, discounts and refunds are not derivable from Clover evidence: never rendered as $0.00.
      for (const label of ["Gross item sales", "Discounts", "Refunds"]) {
        expect(within(screen.getAllByText(label)[0].parentElement as HTMLElement).getByText(/Unavailable/)).toBeInTheDocument();
      }
      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
      expect(screen.getByText("Physical usage variance is not available for Clover locations yet.")).toBeInTheDocument();
      expect(screen.queryByText(/Flowtally will calculate it when valid opening/)).not.toBeInTheDocument();
    });

    it("never shows a confident $0 when Clover has nothing verified for the period", async () => {
      mockFetch.mockResolvedValueOnce({ ...cloverReport, sales: { ...cloverSales, status: "unavailable", available: false, unavailableReason: "No verified paid Clover orders are stored for this period.", netItemSales: null, tax: null, tips: null, totalCollected: null, orderCount: 0, unitsSold: null, verified: { orderCount: 0, netItemSales: 0, tax: 0, tips: 0 }, byMenuItem: [] }, costing: { ...cloverReport.costing, estimatedFoodCostPercent: null, usageCost: null } });
      render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
      const notice = await screen.findByTestId("sales-unavailable");
      expect(notice).toHaveAttribute("role", "status");
      expect(notice).toHaveTextContent("Clover sales are unavailable");
      expect(notice).toHaveTextContent("No verified paid Clover orders are stored for this period.");
      expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
      expect(screen.getByText("Total collected").nextElementSibling).toHaveTextContent("Unavailable");
      expect(screen.getByText("Orders").nextElementSibling).toHaveTextContent("Unavailable");
    });

    it("explains a partly verified period, keeps totals hidden and offers the verified subtotal and Daily Close", async () => {
      mockFetch.mockResolvedValueOnce({ ...cloverReport, sales: { ...cloverSales, status: "partial", available: false, unavailableReason: "1 Clover order(s) in this period are excluded because they have a refund.", netItemSales: null, tax: null, tips: null, totalCollected: null, excludedOrderCount: 1, refundOrderCount: 1 }, costing: { ...cloverReport.costing, estimatedFoodCostPercent: null } });
      render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
      const notice = await screen.findByTestId("sales-unavailable");
      expect(notice).toHaveTextContent("Clover sales are only partly verified");
      expect(notice).toHaveTextContent("Verified orders only (4): net item sales $36.00, tax $4.68, tips $1.50");
      expect(within(notice).getByRole("link", { name: "Use Daily Close" })).toHaveAttribute("href", "/app/daily-close");
      expect(screen.getByText("Total collected").nextElementSibling).toHaveTextContent("Unavailable");
      expect(screen.getByText("Orders").nextElementSibling).toHaveTextContent("4 verified");
      expect(screen.getByText("Refunds").parentElement).toHaveTextContent("Unavailable · 1 order(s)");
    });

    it("renders weekly comparison and unavailable movers without inventing deltas", async () => {
      mockFetch.mockResolvedValueOnce({ ...cloverReport, period: { ...cloverReport.period, view: "weekly", priorStartDate: "2026-08-29", priorEndDate: "2026-08-29" }, changes: { sales: null, orders: null, purchaseSpend: { current: 0, prior: 0, delta: 0, percent: null }, menuMovers: [] } });
      render(<MemoryRouter><PilotReportsPage initialView="weekly" /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText("Period comparison")).toBeInTheDocument());
      expect(screen.getAllByText("No comparison").length).toBe(2);
      expect(screen.getByText("Collected sales").nextElementSibling).toHaveTextContent("Unavailable");
    });

    it("lists menu items without fake money columns and says why when item sales are unavailable", async () => {
      mockFetch.mockResolvedValueOnce({ ...cloverReport, sales: { ...cloverSales, byMenuItem: [], byMenuItemUnavailableReason: "Item sales need verified sales and complete inventory usage for the whole period." } });
      render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText("Item sales need verified sales and complete inventory usage for the whole period.")).toBeInTheDocument());
    });
  });

  it("shows an error with a retry, drops the stale report, and recovers on retry", async () => {
    mockFetch.mockResolvedValueOnce(report).mockRejectedValueOnce(new Error("Report service unavailable"));
    render(<MemoryRouter><PilotReportsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("$181.80")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Report service unavailable");
    expect(screen.queryByText("$181.80")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("$181.80")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
