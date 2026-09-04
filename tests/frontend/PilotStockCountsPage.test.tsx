import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotStockCountsPage } from "../../src/pilot/PilotStockCountsPage";
import type { PilotCountSession, PilotInventoryItem } from "../../src/pilot/pilotApi";

const mockApi = vi.hoisted(() => ({
  fetchPilotCountSessions: vi.fn(),
  fetchPilotCountSession: vi.fn(),
  fetchPilotInventory: vi.fn(),
  createPilotCountSession: vi.fn(),
  updatePilotCountSession: vi.fn(),
  finalizePilotCountSession: vi.fn(),
}));

vi.mock("../../src/pilot/pilotApi", async () => {
  const actual = await vi.importActual<typeof import("../../src/pilot/pilotApi")>("../../src/pilot/pilotApi");
  return {
    ...actual,
    fetchPilotCountSessions: mockApi.fetchPilotCountSessions,
    fetchPilotCountSession: mockApi.fetchPilotCountSession,
    fetchPilotInventory: mockApi.fetchPilotInventory,
    createPilotCountSession: mockApi.createPilotCountSession,
    updatePilotCountSession: mockApi.updatePilotCountSession,
    finalizePilotCountSession: mockApi.finalizePilotCountSession,
  };
});

function createInventoryItem(overrides: Partial<PilotInventoryItem> = {}): PilotInventoryItem {
  return {
    id: 101,
    organizationId: 42,
    locationId: 7,
    supplierId: null,
    name: "Chicken Breast",
    normalizedName: "chicken breast",
    category: "Proteins",
    stockUnit: "kg",
    currentOnHand: 12,
    minQuantity: 4,
    parLevel: 10,
    preferredSupplierName: "Fresh Foods",
    latestPurchasePrice: 9,
    lastPurchaseUnit: "kg",
    lastPurchaseConversionFactor: 1,
    lastReceivedAt: "2026-08-28T10:00:00.000Z",
    lastCountedAt: "2026-08-27T10:00:00.000Z",
    averageDailyUsage: 1.2,
    estimatedCostMethod: "latest_purchase_price",
    active: true,
    notes: "",
    createdByUserId: 7,
    updatedByUserId: 7,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

function createCountSession(status: "Draft" | "Completed", id: number): PilotCountSession {
  return {
    id,
    organizationId: 42,
    locationId: 7,
    status,
    startedAt: "2026-08-28T09:00:00.000Z",
    completedAt: status === "Completed" ? "2026-08-28T11:00:00.000Z" : null,
    countedBy: status === "Completed" ? "Alex" : "Jamie",
    notes: status === "Completed" ? "Finalize after lunch" : "Working draft",
    itemCount: 2,
    countedLineCount: status === "Completed" ? 2 : 1,
    uncountedLineCount: status === "Completed" ? 0 : 1,
    varianceTotal: 0.7,
    movementCountSinceStart: status === "Completed" ? 0 : 1,
    hasMovementSinceStart: false,
    createdByUserId: 7,
    finalizedByUserId: status === "Completed" ? 8 : null,
    lines: [
      {
        id: id * 10 + 1,
        sessionId: id,
        inventoryItemId: 101,
        lineIndex: 0,
        itemNameSnapshot: "Chicken Breast",
        stockUnitSnapshot: "kg",
        expectedQuantity: 3.3,
        countedQuantity: 4,
        variance: 0.7,
        resultingQuantity: 4,
        note: "spot check",
        status,
        movementCountSinceStart: 0,
        hasMovementSinceStart: false,
        createdAt: "2026-08-28T09:00:00.000Z",
        updatedAt: "2026-08-28T10:00:00.000Z",
      },
      {
        id: id * 10 + 2,
        sessionId: id,
        inventoryItemId: 102,
        lineIndex: 1,
        itemNameSnapshot: "Salsa",
        stockUnitSnapshot: "jar",
        expectedQuantity: 6,
        countedQuantity: null,
        variance: null,
        resultingQuantity: null,
        note: "",
        status: status === "Completed" ? "Completed" : "Pending",
        movementCountSinceStart: 0,
        hasMovementSinceStart: false,
        createdAt: "2026-08-28T09:00:00.000Z",
        updatedAt: "2026-08-28T10:00:00.000Z",
      },
    ],
    createdAt: "2026-08-28T09:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function renderPage(path = "/app/stock-counts") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PilotStockCountsPage />
    </MemoryRouter>,
  );
}

describe("PilotStockCountsPage", () => {
  beforeEach(() => {
    const draftSession = createCountSession("Draft", 7);
    const completedSession = createCountSession("Completed", 8);

    mockApi.fetchPilotCountSessions.mockResolvedValue({ countSessions: [draftSession, completedSession] });
    mockApi.fetchPilotCountSession.mockImplementation(async (sessionId: number) => {
      if (sessionId === 7) {
        return draftSession;
      }
      if (sessionId === 8) {
        return completedSession;
      }
      throw new Error("Session not found");
    });
    mockApi.fetchPilotInventory.mockResolvedValue({
      items: [createInventoryItem()],
      movements: [],
      countSessions: [draftSession, completedSession],
      reorderPlan: { suggestions: [], groupedBySupplier: [] },
      summary: {},
    });
    mockApi.createPilotCountSession.mockResolvedValue(draftSession);
    mockApi.updatePilotCountSession.mockImplementation(async (_sessionId: number, payload: Record<string, unknown>) => ({
      ...draftSession,
      countedBy: (payload.countedBy as string) ?? draftSession.countedBy,
      notes: (payload.notes as string) ?? draftSession.notes,
    }));
    mockApi.finalizePilotCountSession.mockResolvedValue(completedSession);
  });

  it("separates active counts from history and opens an existing draft directly", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Stock Counts" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Active count" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Start count" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply count to inventory" })).toBeVisible();
    expect(screen.getByText("Draft #7")).toBeVisible();
    expect(screen.queryByText("Completed #8")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Completed count #8" })).toBeVisible();
    expect(screen.getByText("Completed #8")).toBeVisible();
    expect(screen.queryByText("Draft #7")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start count" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Completed #8"));

    await waitFor(() => expect(screen.getByText("This count is finalized and the inventory snapshot is read-only.")).toBeVisible());
    expect(screen.getByText("Count applied")).toBeVisible();
  });

  it("shows later movement warnings without a fake review action", async () => {
    const draftSession = createCountSession("Draft", 7);
    draftSession.hasMovementSinceStart = true;
    draftSession.movementCountSinceStart = 2;
    draftSession.countedLineCount = 2;
    draftSession.uncountedLineCount = 0;
    draftSession.varianceTotal = 0.7;
    draftSession.lines[0].hasMovementSinceStart = true;
    draftSession.lines[0].movementCountSinceStart = 2;
    draftSession.lines[1].countedQuantity = 6;
    draftSession.lines[1].variance = 0;
    draftSession.lines[1].resultingQuantity = 6;

    mockApi.fetchPilotCountSessions.mockResolvedValue({ countSessions: [draftSession, createCountSession("Completed", 8)] });
    mockApi.fetchPilotCountSession.mockImplementation(async (sessionId: number) => {
      if (sessionId === 7) {
        return draftSession;
      }
      if (sessionId === 8) {
        return createCountSession("Completed", 8);
      }
      throw new Error("Session not found");
    });
    mockApi.finalizePilotCountSession.mockResolvedValue(draftSession);

    renderPage();

    expect(await screen.findByText("Inventory changed after this count began.")).toBeVisible();
    expect(screen.getByText("1 item has later inventory activity. Review it before applying this count.")).toBeVisible();
    expect(screen.getByRole("button", { name: "View details" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(screen.getAllByText("2 later movements").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Hide details" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Review movements first" })).toBeDisabled();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("I reviewed the later inventory activity and want to reconcile this count against the current ledger."));
    expect(screen.getByRole("button", { name: "Apply count to inventory" })).toBeEnabled();
  });
});
