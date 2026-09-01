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
      pendingDraftDailyCloseSessions: [
        {
          id: 9,
          organizationId: 1,
          locationId: 4,
          businessDate: "2026-08-28",
          status: "DRAFT",
          summarySnapshot: {},
          usageSnapshot: {},
          exceptionsSnapshot: [],
          notes: "Late deliveries",
          completedAt: null,
          completedByUserId: null,
          createdByUserId: 1,
          createdAt: "2026-08-28T22:00:00.000Z",
          updatedAt: "2026-08-28T22:00:00.000Z",
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
        close: "Open",
        export: "Not ready",
      },
      operationalAttention: {
        reorder: { count: 2, severity: "urgent" },
        square: { syncErrorCount: 1, unmappedVariationCount: 2, severity: "urgent" },
        dailyClose: { count: 1, severity: "attention" },
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
    expect(screen.getByText("Reorder pressure")).toBeVisible();
    expect(screen.getByText("Open Reorder Plan")).toBeVisible();
    expect(screen.getByText("Square sync needs attention")).toBeVisible();
    expect(screen.getByText("Square variations need mapping")).toBeVisible();
    expect(screen.getByText("Daily Close is outstanding")).toBeVisible();
    expect(screen.getByText("2 item(s) need attention")).toBeVisible();
    expect(screen.getByText("These are unfinished records, not history. Reopen the exact invoice, count, daily close, or reorder draft you last touched.")).toBeVisible();
    expect(screen.getByText("The items that need attention now, from low stock through urgent reorder.")).toBeVisible();
    expect(screen.getByText("Daily close")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open reorder plan" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/reorder-plan"));
  });
});
