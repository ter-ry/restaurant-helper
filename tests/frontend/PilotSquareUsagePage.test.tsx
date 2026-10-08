import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotSquareUsagePage } from "../../src/pilot/PilotSquareUsagePage";

const mockApi = vi.hoisted(() => ({
  fetchSquareCatalogMappings: vi.fn(),
  fetchSquareUsage: vi.fn(),
  updateSquareCatalogMapping: vi.fn(),
  deleteSquareCatalogMapping: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    organization: { id: 42, name: "Variance Cafe" },
    currentLocation: { id: 7, name: "Line Kitchen" },
    locations: [{ id: 7, name: "Line Kitchen" }],
  }),
}));

vi.mock("../../src/lib/squareIntegration", async () => {
  const actual = (await vi.importActual("../../src/lib/squareIntegration")) as any;
  return { ...actual, fetchSquareCatalogMappings: mockApi.fetchSquareCatalogMappings, fetchSquareUsage: mockApi.fetchSquareUsage, updateSquareCatalogMapping: mockApi.updateSquareCatalogMapping, deleteSquareCatalogMapping: mockApi.deleteSquareCatalogMapping };
});

const menuItem = { id: 11, organizationId: 42, locationId: 7, recipeId: 21, name: "Classic Cheeseburger", normalizedName: "classic cheeseburger", category: "Burgers", sellingPrice: 18, active: true, notes: "", createdAt: null, updatedAt: null };
const unmappedVariation = { id: 1, squareCatalogObjectId: 501, squareObjectId: "VAR-1", squareObjectType: "ITEM_VARIATION", squareObjectName: "Classic Cheeseburger - Regular", squareItemName: "Classic Cheeseburger", isDeleted: false, soldUnits: 10, suggestedMenuItemId: 11, suggestedMenuItemName: "Classic Cheeseburger", mapping: null };
const mappedVariation = { ...unmappedVariation, mapping: { id: 1, squareCatalogObjectId: 501, squareObjectId: "VAR-1", squareObjectType: "ITEM_VARIATION", squareObjectName: "Classic Cheeseburger - Regular", squareItemName: "Classic Cheeseburger", mappingType: "menu_item", flowtallyEntityType: "menu_item", flowtallyEntityId: "11", status: "mapped", mappedByUserId: 1, createdAt: null, updatedAt: null } };
const usageReport = { organizationId: 42, locationId: 7, period: { startAt: "2026-08-04T00:00", endAt: "2026-08-11T00:00" }, coverage: { totalSoldUnits: 10, mappedSoldUnits: 10, calculableSoldUnits: 10, excludedUnmappedUnits: 0, excludedIncompleteUnits: 0, excludedCancelledUnits: 0, mappedSalesCoveragePercent: 100, calculableSalesCoveragePercent: 100, mappedVariationCount: 1, unmappedVariationCount: 0 }, ingredientUsage: [{ inventoryItemId: 201, inventoryItemName: "Beef", unit: "kg", currentOnHand: 20, theoreticalUsage: 1.8, soldMenuUnits: 10, contributingMenuItems: [{ menuItemId: 11, menuItemName: "Classic Cheeseburger", soldUnits: 10, theoreticalUsage: 1.8, recipeId: 21, recipeYield: 1 }], mappingStatus: "complete", actualUsage: 2.1, actualUsageBasis: { available: true, warnings: [], openingQuantity: 21.6, openingCountSessionId: 1, openingCountCompletedAt: "2026-08-04T00:00:00.000Z", closingQuantity: 19.5, closingCountSessionId: 2, closingCountCompletedAt: "2026-08-11T00:00:00.000Z", movementNet: 0, actualUsage: 2.1 }, discrepancy: 0.3, discrepancyPercent: 16.7, warnings: [] }], totals: { theoreticalUsage: 1.8, actualUsage: 2.1, discrepancy: 0.3, discrepancyPercent: 16.7 }, contributingMenuItems: [{ menuItemId: 11, menuItemName: "Classic Cheeseburger", soldUnits: 10, recipeYield: 1, recipeYieldUnit: "servings", warnings: [] }], unmappedVariations: [], warnings: [] };

function buildResponse(overrides: Record<string, unknown> = {}) {
  return { connection: { id: 1, organizationId: 42, status: "connected" }, menuItems: [menuItem], mappings: [mappedVariation], unmappedVariations: [], mappingCoverage: { mappedVariationCount: 1, totalVariationCount: 1, mappedPercent: 100 }, usage: usageReport, ...overrides };
}

function renderPage() {
  return render(<MemoryRouter><PilotSquareUsagePage /></MemoryRouter>);
}

describe("PilotSquareUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.fetchSquareUsage.mockResolvedValue(buildResponse({ mappings: [], unmappedVariations: [unmappedVariation] }));
    mockApi.updateSquareCatalogMapping.mockResolvedValue({ ok: true });
    mockApi.deleteSquareCatalogMapping.mockResolvedValue({ ok: true });
  });

  it("loads directly without Square Setup and makes one authoritative Usage request", async () => {
    renderPage();
    expect(await screen.findByText("Classic Cheeseburger - Regular")).toBeVisible();
    expect(mockApi.fetchSquareUsage).toHaveBeenCalledTimes(1);
    expect(mockApi.fetchSquareCatalogMappings).not.toHaveBeenCalled();
  });

  it("preserves mapping controls and reloads them from the authoritative Usage response", async () => {
    mockApi.fetchSquareUsage.mockResolvedValueOnce(buildResponse({ mappings: [], unmappedVariations: [unmappedVariation] })).mockResolvedValueOnce(buildResponse());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Map" }));
    await waitFor(() => expect(mockApi.updateSquareCatalogMapping).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 42, squareCatalogObjectId: 501, flowtallyEntityId: "11", status: "mapped" })));
    await waitFor(() => expect(screen.getByText("Current mapping: Classic Cheeseburger")).toBeVisible());
    expect(mockApi.fetchSquareUsage).toHaveBeenCalledTimes(2);
    expect(mockApi.fetchSquareCatalogMappings).not.toHaveBeenCalled();
  });

  it("does not request intermediate date ranges and applies both draft dates once", async () => {
    renderPage();
    await screen.findByText("Classic Cheeseburger - Regular");
    mockApi.fetchSquareUsage.mockClear();
    fireEvent.change(screen.getByLabelText("Start at"), { target: { value: "2026-10-07T13:45" } });
    fireEvent.change(screen.getByLabelText("End at"), { target: { value: "2026-10-07T14:45" } });
    expect(mockApi.fetchSquareUsage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mockApi.fetchSquareUsage).toHaveBeenCalledTimes(1));
    expect(mockApi.fetchSquareUsage).toHaveBeenCalledWith(expect.objectContaining({ startAt: "2026-10-07T17:45:00.000Z", endAt: "2026-10-07T18:45:00.000Z" }));
  });

  it("clears stale values while a new Usage request is pending", async () => {
    let resolveNext!: (value: unknown) => void;
    mockApi.fetchSquareUsage.mockResolvedValueOnce(buildResponse()).mockReturnValueOnce(new Promise((resolve) => { resolveNext = resolve; }));
    renderPage();
    await screen.findByText("16.7%");
    fireEvent.change(screen.getByLabelText("Start at"), { target: { value: "2026-10-07T13:45" } });
    fireEvent.change(screen.getByLabelText("End at"), { target: { value: "2026-10-07T14:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByText("Loading usage and mapping data…")).toBeVisible());
    expect(screen.queryByText("16.7%")).not.toBeInTheDocument();
    resolveNext(buildResponse());
    await waitFor(() => expect(screen.queryByText("Loading usage and mapping data…")).not.toBeInTheDocument());
  });

  it("shows one meaningful error when the authoritative request fails", async () => {
    mockApi.fetchSquareUsage.mockRejectedValueOnce(new Error("Failed to fetch"));
    renderPage();
    expect(await screen.findByText("Usage and mapping data unavailable")).toBeVisible();
    expect(screen.getByText("Failed to fetch")).toBeVisible();
    expect(screen.queryByText("Mapping data unavailable")).not.toBeInTheDocument();
  });

  it("shows the backend stock-count basis and equations when a variance row is opened", async () => {
    mockApi.fetchSquareUsage.mockResolvedValueOnce(buildResponse());
    renderPage();
    fireEvent.click(await screen.findByText("Beef"));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByText("Opening count")).toBeVisible();
    expect(screen.getByText("Closing count")).toBeVisible();
    expect(screen.getByText("Qualifying movement net")).toBeVisible();
    expect(screen.getByText(/Opening \+ qualifying movements/)).toBeVisible();
  });
});
