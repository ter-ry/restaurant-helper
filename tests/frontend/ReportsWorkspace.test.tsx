import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ReportsWorkspace, type ReportsWorkspaceSnapshot } from "../../src/pilot/reports/ReportsWorkspace";
import { customRange } from "../../src/pilot/reports/reportDateRange";

const snapshot: ReportsWorkspaceSnapshot = {
  salesStatus: "partial",
  salesStatusMessage: "One provider batch is still syncing.",
  overview: { metrics: [{ label: "Net sales", value: "$99", availability: "unavailable" }], salesTrend: [{ label: "Mon", value: null }], purchaseTrend: [{ label: "Mon", value: 120, displayValue: "$120" }] },
  sales: { metrics: [{ label: "Orders", value: "12 verified" }], byItem: [{ label: "Latte", value: "$40" }] },
  purchases: { metrics: [{ label: "Received invoices", value: "2" }], receivedSpendLabel: "$120", pendingSpendLabel: "$30", historyCountLabel: "3 records" },
  inventory: { metrics: [{ label: "Low stock", value: "1" }], exceptions: [{ label: "Milk", value: "Reorder now" }] },
  exports: { bookkeepingReady: true, auditReady: true, historyReady: true, notes: ["No rows were silently truncated."] },
};

describe("ReportsWorkspace", () => {
  it("shows the applied date range and distinguishes partial data from zero", () => {
    render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} />);
    expect(screen.getByText("Nov 23, 2026 – Nov 29, 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("Partially verified data");
    expect(screen.queryByText("Confirmed zero")).not.toBeInTheDocument();
  });

  it("changes between independently renderable sections", () => {
    render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Purchases" }));
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exports" }));
    expect(screen.getByRole("button", { name: "Export Bookkeeping export" })).toBeEnabled();
  });

  it("sends a distinct rolling range to the integration owner", () => {
    const onRangeChange = vi.fn();
    render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} onRangeChange={onRangeChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Report date range" }), { target: { value: "last-7-days" } });
    expect(onRangeChange).toHaveBeenCalledWith({ startDate: "2026-11-21", endDate: "2026-11-27", preset: "last-7-days" });
  });

  it("does not enable exports that are not authoritative-ready", () => {
    render(<ReportsWorkspace today="2026-11-27" snapshot={{ ...snapshot, exports: { ...snapshot.exports, bookkeepingReady: false } }} initialSection="exports" />);
    expect(screen.getByRole("button", { name: "Export Bookkeeping export" })).toBeDisabled();
  });

  it("keeps stale snapshots hidden while a requested range is loading or failed", () => {
    const requested = customRange("2026-11-24", "2026-11-30");
    const loaded = customRange("2026-11-17", "2026-11-23");
    const { rerender } = render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} initialRange={requested} loadedRange={loaded} rangeStatus="loading" initialSection="exports" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the selected report range");
    expect(screen.queryByText("Bookkeeping export")).not.toBeInTheDocument();
    rerender(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} initialRange={requested} loadedRange={loaded} rangeStatus="error" rangeError="Request failed" initialSection="exports" />);
    expect(screen.getByRole("status")).toHaveTextContent("Request failed");
    expect(screen.queryByText("Bookkeeping export")).not.toBeInTheDocument();
  });

  it("validates custom drafts without throwing and applies only a valid pair", () => {
    const onRangeChange = vi.fn();
    render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} onRangeChange={onRangeChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Report date range" }), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Report start date"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("on or before");
    expect(onRangeChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Report end date"), { target: { value: "2026-12-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onRangeChange).toHaveBeenCalledWith(customRange("2026-12-01", "2026-12-05"));
  });

  it("renders unavailable trend points as gaps and confirmed zeros as zero-height bars", () => {
    const zeroSnapshot = { ...snapshot, salesStatus: "available" as const, overview: { ...snapshot.overview, salesTrend: [{ label: "Mon", value: null }, { label: "Tue", value: 0 }, { label: "Wed", value: 0 }] } };
    render(<ReportsWorkspace today="2026-11-27" snapshot={zeroSnapshot} />);
    expect(screen.getByLabelText("Mon: Unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Tue: 0").querySelector("div")?.getAttribute("style")).toContain("height: 0%");
    expect(screen.getAllByText("Bars use authoritative values only; unavailable points are left empty.").length).toBe(2);
  });

  it("uses each metric's favourable direction for change styling", () => {
    const metricSnapshot = { ...snapshot, salesStatus: "available" as const, overview: { ...snapshot.overview, metrics: [{ label: "Food cost", value: "28%", change: { value: "down 4%", direction: "down" as const, favourableDirection: "down" as const } }, { label: "Sales", value: "$1,000", change: { value: "up 4%", direction: "up" as const, favourableDirection: "up" as const } }] } };
    render(<ReportsWorkspace today="2026-11-27" snapshot={metricSnapshot} />);
    expect(screen.getByText("down 4%")).toHaveClass("text-emerald-700");
    expect(screen.getByText("up 4%")).toHaveClass("text-emerald-700");
  });
});
