import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ReportsWorkspace, type ReportsWorkspaceSnapshot } from "../../src/pilot/reports/ReportsWorkspace";

const snapshot: ReportsWorkspaceSnapshot = {
  salesStatus: "partial",
  salesStatusMessage: "One provider batch is still syncing.",
  overview: { metrics: [{ label: "Net sales", value: "Unavailable" }], salesTrend: [{ label: "Mon", value: null }], purchaseTrend: [{ label: "Mon", value: 120, displayValue: "$120" }] },
  sales: { metrics: [{ label: "Orders", value: "12 verified" }], byItem: [{ label: "Latte", value: "$40" }] },
  purchases: { metrics: [{ label: "Received invoices", value: "2" }], receivedSpendLabel: "$120", pendingSpendLabel: "$30", historyCountLabel: "3 records" },
  inventory: { metrics: [{ label: "Low stock", value: "1" }], exceptions: [{ label: "Milk", value: "Reorder now" }] },
  exports: { bookkeepingReady: true, auditReady: true, historyReady: true, notes: ["No rows were silently truncated."] },
};

describe("ReportsWorkspace", () => {
  it("shows the applied date range and distinguishes partial data from zero", () => {
    render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} />);
    expect(screen.getByText("Nov 23, 2026 – Nov 29, 2026")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Partially verified data");
    expect(screen.queryByText("Confirmed zero")).not.toBeInTheDocument();
  });

  it("changes between independently renderable sections", () => {
    render(<ReportsWorkspace today="2026-11-27" snapshot={snapshot} />);
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
});
