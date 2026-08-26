import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotStockCountsPage } from "../../src/pilot/PilotStockCountsPage";

const pilotApiMocks = vi.hoisted(() => ({
  fetchPilotCountSessions: vi.fn(),
  fetchPilotCountSession: vi.fn(),
  fetchPilotInventory: vi.fn(),
  createPilotCountSession: vi.fn(),
  updatePilotCountSession: vi.fn(),
  finalizePilotCountSession: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    fetchPilotCountSessions: pilotApiMocks.fetchPilotCountSessions,
    fetchPilotCountSession: pilotApiMocks.fetchPilotCountSession,
    fetchPilotInventory: pilotApiMocks.fetchPilotInventory,
    createPilotCountSession: pilotApiMocks.createPilotCountSession,
    updatePilotCountSession: pilotApiMocks.updatePilotCountSession,
    finalizePilotCountSession: pilotApiMocks.finalizePilotCountSession,
  };
});

function cloneSession(session: any) {
  return JSON.parse(JSON.stringify(session));
}

describe("PilotStockCountsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the requested session fresh after save and shows the apply-to-inventory confirmation", async () => {
    const baseSession = {
      id: 7,
      organizationId: 5,
      locationId: 9,
      status: "Draft",
      startedAt: "2026-08-25T09:00:00.000Z",
      completedAt: null,
      countedBy: "Floor lead",
      notes: "Quick pilot count",
      itemCount: 1,
      countedLineCount: 0,
      uncountedLineCount: 1,
      varianceTotal: 0,
      movementCountSinceStart: 0,
      hasMovementSinceStart: false,
      createdByUserId: 1,
      finalizedByUserId: null,
      lines: [
        {
          id: 71,
          sessionId: 7,
          inventoryItemId: 30,
          lineIndex: 0,
          itemNameSnapshot: "Chicken Breast",
          stockUnitSnapshot: "kg",
          expectedQuantity: 3.3,
          countedQuantity: null,
          variance: null,
          resultingQuantity: null,
          note: "",
          status: "Open",
          movementCountSinceStart: 0,
          hasMovementSinceStart: false,
          createdAt: "2026-08-25T09:00:00.000Z",
          updatedAt: "2026-08-25T09:00:00.000Z",
        },
      ],
      createdAt: "2026-08-25T09:00:00.000Z",
      updatedAt: "2026-08-25T09:00:00.000Z",
    };

    let currentSession = cloneSession(baseSession);

    pilotApiMocks.fetchPilotCountSessions.mockResolvedValue({
      countSessions: [cloneSession(baseSession)],
    });
    pilotApiMocks.fetchPilotCountSession.mockImplementation(async () => cloneSession(currentSession));
    pilotApiMocks.fetchPilotInventory.mockResolvedValue({
      items: [
        {
          id: 30,
          organizationId: 5,
          locationId: 9,
          supplierId: null,
          name: "Chicken Breast",
          normalizedName: "chicken breast",
          category: "Poultry",
          stockUnit: "kg",
          currentOnHand: 3.3,
          minQuantity: 0,
          parLevel: 0,
          preferredSupplierName: "Test Food Supplier",
          latestPurchasePrice: 10,
          lastPurchaseUnit: "kg",
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: null,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: 1,
          updatedByUserId: 1,
          createdAt: null,
          updatedAt: null,
        },
      ],
      movements: [],
      countSessions: [cloneSession(baseSession)],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {},
    });

    pilotApiMocks.updatePilotCountSession.mockImplementation(async (_sessionId: number, payload: Record<string, unknown>) => {
      expect(payload).toMatchObject({
        updatedAt: baseSession.updatedAt,
        countedBy: "Floor lead",
        notes: "Quick pilot count",
      });
      const updatedSession = {
        ...cloneSession(baseSession),
        countedLineCount: 1,
        uncountedLineCount: 0,
        varianceTotal: 0.7,
        lines: [
          {
            ...cloneSession(baseSession.lines[0]),
            countedQuantity: 4.0,
            variance: 0.7,
            resultingQuantity: 4.0,
            note: "",
            status: "Counted",
          },
        ],
        updatedAt: "2026-08-25T09:05:00.000Z",
      };
      currentSession = cloneSession(updatedSession);
      return cloneSession(updatedSession);
    });
    pilotApiMocks.finalizePilotCountSession.mockImplementation(async () => {
      const finalizedSession = {
        ...cloneSession(currentSession),
        status: "Completed",
        completedAt: "2026-08-25T09:10:00.000Z",
        finalizedByUserId: 1,
        lines: [
          {
            ...cloneSession(currentSession.lines[0]),
            status: "Completed",
          },
        ],
        updatedAt: "2026-08-25T09:10:00.000Z",
      };
      currentSession = cloneSession(finalizedSession);
      return cloneSession(finalizedSession);
    });

    render(
      <MemoryRouter initialEntries={["/app/stock-counts?sessionId=7"]}>
        <PilotStockCountsPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Count sessions that turn into real stock adjustments" });
    await waitFor(() => expect(pilotApiMocks.fetchPilotCountSession).toHaveBeenCalledWith(7));
    expect(screen.getByRole("button", { name: /Draft #7/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Draft #7/ })).toHaveTextContent("0/1 counted");

    fireEvent.change(screen.getByLabelText("Counted quantity"), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(pilotApiMocks.updatePilotCountSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /Draft #7/ })).toHaveTextContent("1/1 counted"));
    expect(screen.getByText("Ready to apply this count?")).toBeVisible();
    expect(screen.getByText("Finalizing will write reconciliation movements into inventory and update the on-hand quantities for every counted line.")).toBeVisible();
    expect(screen.getByText("3.3 kg expected → 4 counted")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Apply count to inventory" }));
    await waitFor(() => expect(pilotApiMocks.finalizePilotCountSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveValue("Completed"));
    expect(screen.getByText("Count sessions that turn into real stock adjustments")).toBeVisible();
    expect(screen.getByText("Count applied")).toBeVisible();
  });
});
