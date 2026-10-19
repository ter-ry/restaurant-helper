import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotReorderPlanPage } from "../../src/pilot/PilotReorderPlanPage";
import type { PilotInventoryItem, PilotReorderPlan, PilotReorderSuggestion } from "../../src/pilot/pilotApi";

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
    purchaseUnit: "case",
    conversionFactor: 2,
    suggestedPurchaseQuantity: 4,
    latestPurchasePrice: 9,
    estimatedCost: 36,
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
    estimatedCost: 36,
    includedCost: 36,
    estimateStatus: "complete",
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
        orderQuantity: 4,
        excluded: false,
        estimatedUnitCost: 9,
        estimatedLineCost: 36,
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
    vi.clearAllMocks();
    const draftPlan = createPlan("Draft", 1);
    const completedPlan = createPlan("Completed", 2);

    mockApi.fetchPilotReorderPlan.mockResolvedValue({
      suggestions: [createSuggestion()],
      inventoryItems: [{ id: 302, name: "Olive Oil", category: "Pantry", stockUnit: "L", currentOnHand: 20, parLevel: 10, preferredSupplierName: "Fresh Foods" } as PilotInventoryItem],
      groupedBySupplier: [
        {
          supplier: "Fresh Foods",
          lines: [createSuggestion()],
          itemCount: 1,
          estimatedOrderTotal: 36,
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

  it("shows a compact zero-state when nothing needs reordering", async () => {
    mockApi.fetchPilotReorderPlan.mockResolvedValue({
      suggestions: [],
      groupedBySupplier: [],
      activeInventoryItemCount: 2,
      refreshedAt: "2026-08-29T12:00:00.000Z",
    });
    mockApi.fetchPilotReorderPlans.mockResolvedValue({
      plans: [createPlan("Completed", 2)],
      activeDraftPlanId: null,
    });

    renderPage();

    expect(await screen.findByText("No items currently need reorder.")).toBeVisible();
    expect(screen.getByText(/Checked/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Start manual draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "View history" })).toBeVisible();
    expect(screen.queryByText("Current reorder pressure")).not.toBeInTheDocument();
    expect(screen.queryByText("Supplier groups")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved plans")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed plan history")).not.toBeInTheDocument();
    expect(screen.queryByText("Week 1 completed")).not.toBeInTheDocument();
  });

  it("separates live planning from completed history and keeps the draft actions clear", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "What to buy" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Live planning" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Needs reorder").length).toBeGreaterThan(0);
    expect(screen.getByText("By supplier")).toBeVisible();
    expect(screen.getByText("Saved plans")).toBeVisible();
    expect(screen.getAllByText("Week 1 draft").length).toBeGreaterThan(0);
    expect(screen.queryByText("Week 1 completed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Week 1 draft/ }));

    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    expect(screen.getByRole("button", { name: "In draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark prepared" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Complete plan" })).toBeVisible();
    expect(screen.getByText("$36.00 estimated")).toBeVisible();
    expect(screen.getByLabelText("Order qty (case)")).toHaveAttribute("step", "1");

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Completed plan history").length).toBeGreaterThan(0);
    expect(screen.queryByText("Current reorder pressure")).not.toBeInTheDocument();
    expect(screen.getAllByText("Week 1 completed").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Week 1 completed/ }));

    await waitFor(() => expect(screen.getByText("Drafts stay editable. Prepared and completed plans open as read-only snapshots.")).toBeVisible());
    expect(screen.getByText("Read-only reorder snapshot opened.")).toBeVisible();
  });

  it("lets a draft add any active inventory item separately from recommendations", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());

    expect(screen.getByLabelText("Search inventory to add")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search inventory to add"), { target: { value: "Olive" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(mockApi.updatePilotReorderPlan).toHaveBeenCalled());
    const payload = mockApi.updatePilotReorderPlan.mock.calls.at(-1)?.[1] as { lines: Array<{ inventoryItemId?: number }> };
    expect(payload.lines).toEqual(expect.arrayContaining([expect.objectContaining({ inventoryItemId: 302 })]));
  });

  it("explains when every active inventory item is already in the draft", async () => {
    mockApi.fetchPilotReorderPlan.mockResolvedValue({
      suggestions: [createSuggestion()],
      inventoryItems: [{ id: 301, name: "Chicken Breast", category: "Proteins", stockUnit: "kg", currentOnHand: 12, parLevel: 10, preferredSupplierName: "Fresh Foods" } as PilotInventoryItem],
      groupedBySupplier: [],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    expect(screen.getByRole("button", { name: "In draft" })).toBeVisible();
    expect(screen.getByText("All active inventory items are already in this draft.")).toBeVisible();
  });

  it("adds a live recommendation on the first click, creating a draft when needed", async () => {
    const newDraft = { ...createPlan("Draft", 3), lines: [], lineCount: 0, estimatedCost: 0, includedCost: 0, supplierCount: 0 };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [createPlan("Completed", 2)], activeDraftPlanId: null });
    mockApi.createPilotReorderPlan.mockResolvedValue(newDraft);
    mockApi.updatePilotReorderPlan.mockImplementation(async (_planId: number, payload: Record<string, unknown>) => ({
      ...newDraft,
      lines: (payload.lines as PilotReorderPlan["lines"]).map((line, index) => ({
        ...createPlan("Draft", 3).lines[0],
        ...line,
        id: 3010 + index,
        planId: 3,
        inventoryItemId: 301,
        inventoryItemName: "Chicken Breast",
        supplierName: "Fresh Foods",
        estimatedUnitCost: 9,
        estimatedLineCost: 36,
      })),
      lineCount: 1,
      supplierCount: 1,
      estimatedCost: 36,
      includedCost: 36,
    }));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add to draft" }));

    await waitFor(() => expect(mockApi.createPilotReorderPlan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockApi.updatePilotReorderPlan).toHaveBeenCalledTimes(1));
    expect(mockApi.updatePilotReorderPlan.mock.calls.at(-1)?.[1]).toMatchObject({
      lines: [expect.objectContaining({ inventoryItemId: 301, orderQuantity: 4 })],
    });
    expect(await screen.findByText("Item added to the working order plan.")).toBeVisible();
  });

  it("completes a prepared snapshot without attempting another update", async () => {
    const prepared = createPlan("Prepared", 4);
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [prepared], activeDraftPlanId: null });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(prepared);
    mockApi.completePilotReorderPlan.mockResolvedValue({ ...prepared, status: "Completed" });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Read-only reorder snapshot opened.")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Complete plan" }));
    expect(screen.getByRole("dialog", { name: "Complete this reorder plan?" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Complete this reorder plan?" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Complete plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm completion" }));
    await waitFor(() => expect(mockApi.completePilotReorderPlan).toHaveBeenCalledWith(4));
    expect(mockApi.updatePilotReorderPlan).not.toHaveBeenCalled();
  });

  it("keeps a prepared plan discoverable when suggestions are empty after reload", async () => {
    const prepared = { ...createPlan("Prepared", 8), estimateStatus: "partial" as const };
    mockApi.fetchPilotReorderPlan.mockResolvedValue({ suggestions: [], groupedBySupplier: [], activeInventoryItemCount: 4 });
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [prepared], activeDraftPlanId: null });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(prepared);

    renderPage("/app/reorder-plan?planId=8");

    expect(await screen.findByRole("button", { name: /Week 1 draft/ })).toBeVisible();
    expect(screen.getAllByText("$36.00 known-cost subtotal").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Complete plan" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review recommendation changes" })).not.toBeInTheDocument();
  });

  it("recalculates provisional line estimates while editing without saving", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());

    expect(screen.getByText("$36.00 estimated")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Order qty (case)"), { target: { value: "6" } });
    expect(screen.getByText("$54.00 estimated")).toBeVisible();
    expect(mockApi.updatePilotReorderPlan).not.toHaveBeenCalled();
  });

  it("uses stock units per purchase unit for conversion labels", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());

    expect(screen.getByText("2 kg per case")).toBeVisible();
    expect(screen.queryByText("2 case per kg")).not.toBeInTheDocument();
  });

  it("shows precise small purchase conversions", async () => {
    const plan = createPlan("Draft", 12);
    plan.lines[0] = { ...plan.lines[0], purchaseUnit: "bag", conversionFactor: 0.25 };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 12 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());

    expect(screen.getByText("0.25 kg per bag")).toBeVisible();
  });

  it("reviews and selectively applies current recommendation changes without saving", async () => {
    const plan = createPlan("Draft", 13);
    plan.lines[0] = { ...plan.lines[0], purchaseUnit: "bag", conversionFactor: 0.25, orderQuantity: 5, estimatedUnitCost: 48, estimatedLineCost: 240 };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 13 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);
    mockApi.fetchPilotReorderPlan.mockResolvedValue({
      suggestions: [createSuggestion({ inventoryItemId: 301, purchaseUnit: "bag", conversionFactor: 0.25, suggestedPurchaseQuantity: 20, latestPurchasePrice: 48, estimatedCost: 960, currentQuantity: 1, parLevel: 6 })],
      groupedBySupplier: [],
      inventoryItems: [],
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Review recommendation changes" }));
    expect(await screen.findByRole("dialog", { name: "Review recommendation changes" })).toHaveTextContent("Saved draft: 5 bag");
    expect(screen.getByRole("dialog", { name: "Review recommendation changes" })).toHaveTextContent("Current recommendation: 20 bag");
    expect(screen.getByRole("dialog", { name: "Review recommendation changes" })).toHaveTextContent("$960.00");
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply selected changes" }));

    expect(await screen.findByDisplayValue("20")).toBeVisible();
    expect(screen.getByText("Selected recommendation changes applied locally. Save draft to persist them.")).toBeVisible();
    expect(mockApi.updatePilotReorderPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mockApi.updatePilotReorderPlan).toHaveBeenCalledTimes(1));
    const payload = mockApi.updatePilotReorderPlan.mock.calls[0]?.[1] as { lines: Array<Record<string, unknown>> };
    expect(payload.lines[0]).toMatchObject({ orderQuantity: 20 });
    expect(payload.lines[0]).not.toHaveProperty("estimatedUnitCost");
  });

  it("derives saved review cost from quantity and saved unit price when a legacy line cost is stale", async () => {
    const plan = createPlan("Draft", 17);
    plan.lines[0] = { ...plan.lines[0], purchaseUnit: "bag", conversionFactor: 0.25, orderQuantity: 5, estimatedUnitCost: 48, estimatedLineCost: 960 };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 17 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);
    mockApi.fetchPilotReorderPlan.mockResolvedValue({ suggestions: [createSuggestion({ purchaseUnit: "bag", conversionFactor: 0.25, suggestedPurchaseQuantity: 20, latestPurchasePrice: 48, estimatedCost: 960 })], groupedBySupplier: [], inventoryItems: [] });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Review recommendation changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review recommendation changes" });
    expect(dialog).toHaveTextContent("Saved draft: 5 bag · $240.00");
    expect(dialog).toHaveTextContent("Using the saved quantity and unit-price snapshot");
    expect(dialog).toHaveTextContent("Current recommendation: 20 bag");
  });

  it("requires manual review when the current recommendation price differs from the saved snapshot", async () => {
    const plan = createPlan("Draft", 14);
    plan.lines[0] = { ...plan.lines[0], purchaseUnit: "bag", conversionFactor: 0.25, orderQuantity: 5, estimatedUnitCost: 40, estimatedLineCost: 200 };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 14 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);
    mockApi.fetchPilotReorderPlan.mockResolvedValue({ suggestions: [createSuggestion({ purchaseUnit: "bag", conversionFactor: 0.25, suggestedPurchaseQuantity: 20, latestPurchasePrice: 48, estimatedCost: 960 })], groupedBySupplier: [], inventoryItems: [] });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Review recommendation changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review recommendation changes" });
    expect(dialog).toHaveTextContent("saved $40.00; current $48.00");
    expect(screen.getByText("Review manually")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeVisible();
    expect(mockApi.updatePilotReorderPlan).not.toHaveBeenCalled();
  });

  it("keeps unknown prices and changed conversions in manual review", async () => {
    const plan = createPlan("Draft", 15);
    plan.lines[0] = { ...plan.lines[0], purchaseUnit: "bag", conversionFactor: 0.25, orderQuantity: 5, estimatedUnitCost: null, estimatedLineCost: null };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 15 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);
    mockApi.fetchPilotReorderPlan.mockResolvedValue({ suggestions: [createSuggestion({ purchaseUnit: "case", conversionFactor: 2, suggestedPurchaseQuantity: 3, latestPurchasePrice: null })], groupedBySupplier: [], inventoryItems: [] });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Review recommendation changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review recommendation changes" });
    expect(dialog).toHaveTextContent("Current purchase price is unavailable.");
    expect(dialog).toHaveTextContent("Review manually");
    expect(screen.queryByRole("checkbox", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("does not apply a stale comparison after the draft changes while fetching", async () => {
    const plan = createPlan("Draft", 16);
    const pending = new Promise<Awaited<ReturnType<typeof mockApi.fetchPilotReorderPlan>>>(() => undefined);
    mockApi.fetchPilotReorderPlan.mockResolvedValue({ suggestions: [createSuggestion()], groupedBySupplier: [], inventoryItems: [] });
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 16 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    mockApi.fetchPilotReorderPlan.mockReturnValue(pending);
    fireEvent.click(screen.getByRole("button", { name: "Review recommendation changes" }));
    fireEvent.change(screen.getByLabelText("Order qty (case)"), { target: { value: "7" } });
    expect(screen.queryByRole("dialog", { name: "Review recommendation changes" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeVisible();
  });

  it("protects unsaved draft edits before opening recommendation review", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());
    fireEvent.change(screen.getByLabelText("Order qty (case)"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Review recommendation changes" }));

    expect(screen.getByText("Save the draft before reviewing current recommendations.")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Review recommendation changes" })).not.toBeInTheDocument();
  });

  it("omits redundant one-to-one conversion labels", async () => {
    const plan = createPlan("Draft", 11);
    plan.lines[0] = { ...plan.lines[0], purchaseUnit: "kg", inventoryUnit: "kg", conversionFactor: 1 };
    mockApi.fetchPilotReorderPlans.mockResolvedValue({ plans: [plan], activeDraftPlanId: 11 });
    mockApi.fetchPilotReorderPlanDetail.mockResolvedValue(plan);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Week 1 draft/ }));
    await waitFor(() => expect(screen.getByText("Draft reorder plan opened.")).toBeVisible());

    expect(screen.queryByText("1 kg per kg")).not.toBeInTheDocument();
  });
});
