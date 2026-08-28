import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotReorderPlanPage } from "../../src/pilot/PilotReorderPlanPage";

const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotReorderPlan: vi.fn(),
  fetchPilotReorderPlans: vi.fn(),
  fetchPilotReorderPlanDetail: vi.fn(),
  createPilotReorderPlan: vi.fn(),
  updatePilotReorderPlan: vi.fn(),
  preparePilotReorderPlan: vi.fn(),
  completePilotReorderPlan: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotReorderPlan: pilotApiMocks.fetchPilotReorderPlan,
    fetchPilotReorderPlans: pilotApiMocks.fetchPilotReorderPlans,
    fetchPilotReorderPlanDetail: pilotApiMocks.fetchPilotReorderPlanDetail,
    createPilotReorderPlan: pilotApiMocks.createPilotReorderPlan,
    updatePilotReorderPlan: pilotApiMocks.updatePilotReorderPlan,
    preparePilotReorderPlan: pilotApiMocks.preparePilotReorderPlan,
    completePilotReorderPlan: pilotApiMocks.completePilotReorderPlan,
  };
});

function clonePlan(plan: any) {
  return JSON.parse(JSON.stringify(plan));
}

function createPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    organizationId: 5,
    locationId: 9,
    name: "Harvest Draft",
    status: "Draft",
    notes: "Draft reorder plan",
    createdByUserId: 1,
    preparedByUserId: null,
    completedByUserId: null,
    preparedAt: null,
    completedAt: null,
    lineCount: 1,
    supplierCount: 1,
    estimatedCost: 120,
    includedCost: 120,
    excludedCount: 0,
    lines: [
      {
        id: 111,
        planId: 11,
        inventoryItemId: 30,
        supplierId: 21,
        lineIndex: 0,
        inventoryItemName: "Butter",
        supplierName: "Dairy Co",
        category: "Dairy",
        purchaseUnit: "case",
        inventoryUnit: "kg",
        conversionFactor: 4,
        currentOnHand: 2,
        minimumQuantity: 5,
        parLevel: 8,
        suggestedQuantity: 6,
        orderQuantity: 6,
        excluded: false,
        estimatedUnitCost: 8,
        estimatedLineCost: 48,
        notes: "",
        createdAt: "2026-08-26T09:00:00.000Z",
        updatedAt: "2026-08-26T09:00:00.000Z",
      },
    ],
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:00:00.000Z",
    ...overrides,
  } as any;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("PilotReorderPlanPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps completed plans out of the editor on refresh while opening drafts and clearing after completion", async () => {
    let draftPlan = createPlan();
    const completeDeferred = createDeferred<void>();
    const completedPlan = createPlan({
      id: 12,
      name: "Completed Service Plan",
      status: "Completed",
      completedAt: "2026-08-26T12:00:00.000Z",
      completedByUserId: 1,
      preparedAt: "2026-08-26T11:30:00.000Z",
      preparedByUserId: 1,
      notes: "Completed reorder history",
      updatedAt: "2026-08-26T12:00:00.000Z",
      lines: [
        {
          id: 121,
          planId: 12,
          inventoryItemId: 31,
          supplierId: 21,
          lineIndex: 0,
          inventoryItemName: "Cheese",
          supplierName: "Dairy Co",
          category: "Dairy",
          purchaseUnit: "case",
          inventoryUnit: "kg",
          conversionFactor: 4,
          currentOnHand: 1,
          minimumQuantity: 4,
          parLevel: 6,
          suggestedQuantity: 5,
          orderQuantity: 5,
          excluded: false,
          estimatedUnitCost: 10,
          estimatedLineCost: 50,
          notes: "",
          createdAt: "2026-08-25T09:00:00.000Z",
          updatedAt: "2026-08-25T09:00:00.000Z",
        },
      ],
    });

    pilotApiMocks.fetchPilotReorderPlan.mockResolvedValue({
      suggestions: [
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
      groupedBySupplier: [
        {
          supplier: "Dairy Co",
          itemCount: 1,
          estimatedOrderTotal: 48,
          lines: [
            {
              id: 111,
              inventoryItemName: "Butter",
              adjustedQuantity: 6,
              unit: "kg",
            },
          ],
        },
      ],
    });
    pilotApiMocks.fetchPilotReorderPlans.mockImplementation(async () => ({
      plans: [clonePlan(draftPlan), clonePlan(completedPlan)],
      activeDraftPlanId: 11,
    }));
    pilotApiMocks.fetchPilotReorderPlanDetail.mockImplementation(async (planId: number) => clonePlan(planId === 11 ? draftPlan : completedPlan));
    pilotApiMocks.updatePilotReorderPlan.mockImplementation(async (_planId: number, payload: Record<string, unknown>) => {
      draftPlan = {
        ...draftPlan,
        name: String(payload.name ?? draftPlan.name),
        notes: String(payload.notes ?? draftPlan.notes),
        updatedAt: "2026-08-26T10:00:00.000Z",
      };
      return clonePlan(draftPlan);
    });
    pilotApiMocks.preparePilotReorderPlan.mockImplementation(async () => {
      draftPlan = {
        ...draftPlan,
        status: "Prepared",
        preparedAt: "2026-08-26T10:30:00.000Z",
        preparedByUserId: 1,
        updatedAt: "2026-08-26T10:30:00.000Z",
      };
      return clonePlan(draftPlan);
    });
    pilotApiMocks.completePilotReorderPlan.mockImplementation(async () => {
      await completeDeferred.promise;
      draftPlan = {
        ...draftPlan,
        status: "Completed",
        completedAt: "2026-08-26T11:00:00.000Z",
        completedByUserId: 1,
        updatedAt: "2026-08-26T11:00:00.000Z",
      };
      return clonePlan(draftPlan);
    });
    pilotApiMocks.createPilotReorderPlan.mockImplementation(async () => clonePlan(draftPlan));

    render(
      <MemoryRouter initialEntries={["/app/reorder-plan"]}>
        <PilotReorderPlanPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Plan what needs ordering and preserve the snapshot" });
    expect(screen.getByText("Open a reorder plan")).toBeVisible();
    expect(screen.getByRole("button", { name: /Completed Service Plan/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Completed Service Plan/ }));
    await waitFor(() => expect(screen.getByText("Read-only reorder snapshot opened.")).toBeVisible());
    expect(screen.getByLabelText("Plan name")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("Open a reorder plan")).toBeVisible());
    expect(screen.queryByLabelText("Plan name")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Harvest Draft/ }));
    await waitFor(() => expect(screen.getByLabelText("Plan name")).toHaveValue("Harvest Draft"));
    expect(screen.getByText("Draft reorder plan opened.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete plan" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Complete plan" }));
    await waitFor(() => expect(pilotApiMocks.completePilotReorderPlan).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Completing..." })).toBeVisible();
    completeDeferred.resolve();
    await waitFor(() => expect(screen.getByText("Completed reorder plan Harvest Draft. It is now locked in history.")).toBeVisible());
    expect(screen.getByText("Open a reorder plan")).toBeVisible();
    expect(screen.queryByLabelText("Plan name")).not.toBeInTheDocument();
  });
});
