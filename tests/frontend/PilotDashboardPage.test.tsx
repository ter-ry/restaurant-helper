import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotDashboardPage } from "../../src/pilot/PilotDashboardPage";

const navigate = vi.fn();

const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotDashboard: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotDashboard: pilotApiMocks.fetchPilotDashboard,
  };
});

describe("PilotDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pilotApiMocks.fetchPilotDashboard.mockResolvedValue({
      summary: {
        weeklyInvoiceSpend: 1200,
        weeklyInvoiceCount: 4,
        monthlyInvoiceSpend: 3400,
        monthlyInvoiceCount: 12,
        inventoryValue: 9000,
        inventoryItemCount: 45,
        inventoryReorderNowCount: 2,
        inventoryLowStockCount: 5,
        invoiceReviewQueueCount: 3,
        inventoryCountNeededCount: 1,
        recentPriceChangeCount: 2,
      },
      recentInvoices: [],
      recentMovements: [
        {
          id: 1,
          inventoryItemName: "Chicken Breast",
          reason: "Count finalized",
          quantityDelta: -2,
          unit: "kg",
          createdAt: "2026-08-25T10:00:00.000Z",
        },
      ],
      recentPriceChanges: [
        {
          id: 1,
          itemName: "Milk",
          supplier: "Dairy Co",
          changePercent: 8,
          invoiceDate: "2026-08-24",
        },
      ],
      pendingDraftInvoices: [
        {
          id: 2,
          invoiceNumber: "FD-1002",
          invoiceDate: "2026-08-19",
          supplier: { id: 21, name: "Fresh Dairy Toronto" },
          status: "Draft",
        },
      ],
      pendingDraftCountSessions: [
        {
          id: 7,
          countedLineCount: 0,
          itemCount: 10,
          varianceTotal: 0,
          status: "Draft",
        },
      ],
      pendingDraftReorderPlans: [
        {
          id: 5,
          name: "Weekly Reorder",
          lineCount: 4,
          supplierCount: 2,
          status: "Draft",
        },
      ],
      supplierSpend: [
        {
          supplier: "Dairy Co",
          invoiceCount: 4,
          spend: 1200,
          change: 5,
        },
      ],
      reorderSuggestions: [
        {
          id: 1,
          inventoryItemId: 30,
          inventoryItemName: "Butter",
          category: "Dairy",
          supplier: "Dairy Co",
          currentQuantity: 2,
          unit: "kg",
          minimumQuantity: 5,
          parLevel: 8,
          suggestedQuantity: 6,
          adjustedQuantity: 6,
          latestPurchasePrice: 8,
          estimatedCost: 48,
          stockStatus: "Reorder now",
          status: "Urgent",
          daysRemaining: 1,
        },
      ],
      workflow: {
        purchase: "Needs review",
        review: "Needs review",
        inventory: "Not ready",
        reorder: "Alert",
        close: "Not ready",
        export: "Not ready",
      },
    });
  });

  it("prioritizes urgent metrics and keeps unfinished work clear", async () => {
    render(
      <MemoryRouter>
        <PilotDashboardPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "What the owner needs to know today" });
    expect(screen.getAllByText("Invoices to review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reorder now").length).toBeGreaterThan(0);
    expect(screen.getByText("Low stock")).toBeVisible();
    expect(screen.getByText("These are unfinished records, not history. Reopen the exact invoice, count, or reorder draft you last touched.")).toBeVisible();
    expect(screen.getByText("The items that need attention now, from low stock through urgent reorder.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open reorder plan" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/reorder-plan"));
  });
});
