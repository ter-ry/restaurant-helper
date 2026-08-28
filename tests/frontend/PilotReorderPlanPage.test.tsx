import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotReorderPlanPage } from "../../src/pilot/PilotReorderPlanPage";
import type { PilotReorderPlan, PilotReorderSuggestion } from "../../src/pilot/pilotApi";

const mockApi = vi.hoisted(() => ({
  fetchPilotReorderPlan: vi.fn(),
  fetchPilotReorderPlans: vi.fn(),
  fetchPilotReorderPlanDetail: vi.fn(),
  createPilotReorderPlan: vi.fn(),
  updatePilotReorderPlan: vi.fn(),
  preparePilotReorderPlan: vi.fn(),
  completePilotReorderPlan: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return {
    ...actual,
    fetchPilotReorderPlan: mockApi.fetchPilotReorderPlan,
    fetchPilotReorderPlans: mockApi.fetchPilotReorderPlans,
    fetchPilotReorderPlanDetail: mockApi.fetchPilotReorderPlanDetail,
    createPilotReorderPlan: mockApi.createPilotReorderPlan,
    updatePilotReorderPlan: mockApi.updatePilotReorderPlan,
    preparePilotReorderPlan: mockApi.preparePilotReorderPlan,
    completePilotReorderPlan: mockApi.completePilotReorderPlan,
  };
});

function createSuggestion(overrides: Partial<PilotReorderSuggestion> = {}): PilotReorderSuggestion {
  return {
    id: 101,
    inventoryItemId: 301,
    inventoryItemName: "Chicken Breast",
    category: "Proteins",
    supplier: "Fresh Foods",
    currentQuantity: 12,
    unit: "kg",
    minimumQuantity: 4,
    parLevel: 10,
    suggestedQuantity: 8,
    adjustedQuantity: 8,
    latestPurchasePrice: 9,
    estimatedCost: 72,
    stockStatus: "Reorder now",
    status: "Needs review",
    daysRemaining: 1.5,
    ...overrides,
  };
}

function createPlan(status: "Draft" | "Prepared" | "Completed", id: number): PilotReorderPlan {
  return {
    id,
    organizationId: 42,
    locationId: 7,
    name: status === "Completed" ? "Week 1 completed" : "Week 1 draft",
    status,
    notes: "Plan notes",
    createdByUserId: 7,
    preparedByUserId: status === "Prepared" || status === "Completed" ? 8 : null,
    completedByUserId: status === "Completed" ? 9 : null,
    preparedAt: status === "Prepared" || status === "Completed" ? "2026-08-28T10:00:00.000Z" : null,
    completedAt: status === "Completed" ? "2026-08-28T11:00:00.000Z" : null,
    lineCount: 1,
    supplierCount: 1,
    estimatedCost: 72,
    includedCost: 72,
    excludedCount: 0,
    lines: [
      {
        id: id * 10 + 1,
        planId: id,
        inventoryItemId: 301,
        supplierId: 501,
        lineIndex: 0,
        inventoryItemName: "Chicken Breast",
        supplierName: "Fresh Foods",
        category: "Proteins",
        purchaseUnit: "case",
        inventoryUnit: "kg",
        conversionFactor: 2,
        currentOnHand: 12,
        minimumQuantity: 4,
        parLevel: 10,
        suggestedQuantity: 8,
        orderQuantity: 8,
        excluded: false,
        estimatedUnitCost: 9,
        estimatedLineCost: 72,
        notes: "Order if under par",
        createdAt: "2026-08-28T09:00:00.000Z",
        updatedAt: "2026-08-28T10:00:00.000Z",
      },
    ],
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function renderPage(path = "/app/reorder-plan") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PilotReorderPlanPage />
    </MemoryRouter>,
  );
}

describe("PilotReorderPlanPage", () => {
  beforeEach(() => {
    const draftPlan = createPlan("Draft", 1);
    const completedPlan = createPlan("Completed", 2);

    mockApi.fetchPilotReorderPlan.mockResolvedValue({
      suggestions: [createSuggestion()],
      groupedBySupplier: [
        {
          supplier: "Fresh Foods",
          lines: [createSuggestion()],
          itemCount: 1,
          estimatedOrderTotal: 72,
        },
      ],
    });
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [draftPlan, completedPlan], activeDraftPlanId: 1 });
    mockApi.fetchPilotReorderPlanDetail.mockImplementation(async (planId: number) => {
      if (planId === 1) {
        return draftPlan;
      }
      if (planId === 2) {
        return completedPlan;
      }
      throw new Error("Plan not found");
    });
    mockApi.createPilotReorderPlan.mockResolvedValue(draftPlan);
    mockApi.updatePilotReorderPlan.mockImplementation(async (_planId: number, payload: Record<string, unknown>) => ({
      ...draftPlan,
      name: (payload.name as string) ?? draftPlan.name,
      notes: (payload.notes as string) ?? draftPlan.notes,
    }));
    mockApi.preparePilotReorderPlan.mockResolvedValue({
      ...draftPlan,
      status: "Prepared",
      preparedAt: "2026-08-28T10:15:00.000Z",
    });
    mockApi.completePilotReorderPlan.mockResolvedValue({
      ...completedPlan,
      status: "Completed",
      completedAt: "2026-08-28T11:15:00.000Z",
    });
  });

  it("separates live planning from completed history and keeps the draft actions clear", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Plan what needs ordering and preserve the snapshot" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Live planning/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Current reorder pressure")).toBeVisible();
    expect(screen.getByText("Supplier groups")).toBeVisible();
    expect(screen.getByText("Saved plans")).toBeVisible();
    expect(screen.getByText("Drafts stay editable. Completed plans preserve their snapshots.")).toBeVisible();
    expect(screen.getAllByText("Week 1 draft").length).toBeGreaterThan(0);
    expect(screen.queryByText("Week 1 completed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Week 1 draft/ }));

    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark prepared" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete plan" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /History/ }));

    expect(screen.getByRole("button", { name: /History/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("Completed plan history").length).toBeGreaterThan(0);
    expect(screen.queryByText("Current reorder pressure")).not.toBeInTheDocument();
    expect(screen.getAllByText("Week 1 completed").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Week 1 completed/ }));

    await waitFor(() => expect(screen.getByText("Drafts stay editable. Prepared and completed plans open as read-only snapshots.")).toBeVisible());
    expect(screen.getByText("Read-only reorder snapshot opened.")).toBeVisible();
  });
});
