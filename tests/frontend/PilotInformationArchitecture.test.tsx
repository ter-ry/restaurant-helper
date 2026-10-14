import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PilotDashboardWorkspacePage } from "../../src/pilot/PilotDashboardWorkspacePage";
import { PilotInventoryHubPage } from "../../src/pilot/PilotInventoryHubPage";

vi.mock("../../src/pilot/PilotModuleGate", () => ({ PilotModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../src/pilot/PilotDashboardPage", () => ({ PilotDashboardPage: () => <div>Dashboard overview content</div> }));
vi.mock("../../src/pilot/PilotReportsPage", () => ({ PilotReportsPage: ({ initialView }: { initialView: string }) => <div>{initialView} report content</div> }));
vi.mock("../../src/pilot/PilotInventoryPage", () => ({ PilotInventoryPage: () => <div>Stock content</div> }));
vi.mock("../../src/pilot/PilotStockCountsPage", () => ({ PilotStockCountsPage: () => <div>Counts content</div> }));
vi.mock("../../src/pilot/PilotReorderPlanPage", () => ({ PilotReorderPlanPage: () => <div>Reorder content</div> }));
vi.mock("../../src/pilot/PilotSquareUsagePage", () => ({ PilotSquareUsagePage: () => <div>Usage content</div> }));

describe("operational information architecture", () => {
  it("exposes Dashboard overview, daily and weekly tabs", () => {
    render(<MemoryRouter initialEntries={["/app/dashboard"]}><PilotDashboardWorkspacePage /></MemoryRouter>);
    expect(screen.getByText("Dashboard overview content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Daily" }));
    expect(screen.getByText("daily report content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
    expect(screen.getByText("weekly report content")).toBeInTheDocument();
  });

  it("exposes Inventory stock, counts, reorder and usage tabs", () => {
    render(<MemoryRouter initialEntries={["/app/inventory"]}><PilotInventoryHubPage /></MemoryRouter>);
    expect(screen.getByText("Stock content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Counts" }));
    expect(screen.getByText("Counts content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Reorder" }));
    expect(screen.getByText("Reorder content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Usage & Variance" }));
    expect(screen.getByText("Usage content")).toBeInTheDocument();
  });
});
