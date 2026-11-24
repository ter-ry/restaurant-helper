import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PilotCloverConnection } from "../../src/pilot/PilotCloverConnection";

const api = vi.hoisted(() => ({
  fetchPilotCloverStatus: vi.fn(),
  fetchPilotCloverCatalog: vi.fn(),
  fetchPilotCloverShadowOrders: vi.fn(),
  disconnectPilotClover: vi.fn(),
  beginPilotCloverConnection: vi.fn(),
  resumePilotCloverLaunch: vi.fn(),
}));

vi.mock("../../src/pilot/PilotSessionProvider", () => ({
  usePilotSession: () => ({
    user: { id: 10, email: "qa@example.com" },
    organization: { id: 1, name: "Org" },
    currentLocation: { id: 5, name: "Main" },
    locations: [],
  }),
}));
vi.mock("../../src/pilot/pilotApi", () => api);
vi.mock("../../src/pilot/pilotConfig", () => ({ demoReadOnly: false }));

const line = {
  id: 1, cloverLineItemId: "L1", cloverItemId: "ITEM1", name: "Latte", quantity: 2, unitPriceCents: 450,
  mappingStatus: "mapped" as const,
  recipePreview: { recipeName: "Latte recipe", flowtallyMenuItemName: "Latte", ingredients: [{ inventoryItemId: 9, name: "Whole milk", quantity: "0.5", unit: "L" }] },
  modifiers: [],
};
const baseOrder = {
  id: 1, cloverOrderId: "ORD-PAID", providerStatus: "PAID", status: "paid" as const, paymentStatus: "PAID",
  potentiallyEligible: true, requiresReview: false, incomplete: false, lineItemsIncomplete: false,
  financialIncomplete: false, refundsUnverified: false, paymentStateConflict: false,
  createdAt: null, modifiedAt: null, closedAt: null, totalCents: 900, currency: "CAD", lines: [line],
};
const result = (orders: unknown[]) => ({ readOnly: true, previewOnly: true, retrievedAt: "2026-11-24T12:00:00Z", count: orders.length, orders });

async function openPanel() {
  render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);
  const region = await screen.findByRole("region", { name: "Clover shadow orders" });
  return region;
}

describe("Clover shadow orders operator journey (mocked)", () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.fetchPilotCloverStatus.mockResolvedValue({
      enabled: true, catalogEnabled: true, shadowOrdersEnabled: true,
      connection: { environment: "sandbox", merchantName: "Sandbox Cafe", merchantId: "M1", status: "connected" },
    });
  });

  it("is labelled preview-only before and after a fetch, and shows nothing retrieved yet", async () => {
    const region = await openPanel();
    expect(within(region).getByText("Preview only — inventory unchanged.")).toBeTruthy();
    expect(within(region).getByText("No retrieval completed yet.")).toBeTruthy();
  });

  it("shows provider-OPEN with a SUCCESS payment record as a review conflict, not paid or ready", async () => {
    api.fetchPilotCloverShadowOrders.mockResolvedValue(result([{
      ...baseOrder, cloverOrderId: "80CM9MTRVQ7C4", providerStatus: "OPEN", paymentStatus: "OPEN",
      status: "review", potentiallyEligible: false, requiresReview: true, paymentStateConflict: true,
    }]));
    const region = await openPanel();
    fireEvent.click(within(region).getByRole("button", { name: /fetch recent orders/i }));
    await within(region).findByText("80CM9MTRVQ7C4");
    expect(within(region).getByText("review")).toBeTruthy();
    expect(within(region).queryByText("paid")).toBeNull();
    expect(within(region).getByText(/Provider: OPEN · Payment: OPEN/)).toBeTruthy();
    const warning = within(region).getByText(/Warning: .*payment/i);
    expect(warning.textContent).toMatch(/Clover still reports this order as open/i);
    expect(warning.textContent).toMatch(/payment record/i);
    expect(warning.textContent).toMatch(/not been treated as paid|review required/i);
    expect(within(region).queryByText(/ready/i)).toBeNull();
  });

  it("shows an unpaid OPEN order as pending with no payment warning", async () => {
    api.fetchPilotCloverShadowOrders.mockResolvedValue(result([{
      ...baseOrder, cloverOrderId: "ORD-OPEN", providerStatus: "OPEN", paymentStatus: "OPEN",
      status: "pending", potentiallyEligible: false,
    }]));
    const region = await openPanel();
    fireEvent.click(within(region).getByRole("button", { name: /fetch recent orders/i }));
    await within(region).findByText("ORD-OPEN");
    expect(within(region).getByText("pending")).toBeTruthy();
    expect(within(region).queryByText(/conflict|payment record/i)).toBeNull();
  });

  it("shows a verified PAID order with the exact ingredient preview and no conflict warning", async () => {
    api.fetchPilotCloverShadowOrders.mockResolvedValue(result([baseOrder]));
    const region = await openPanel();
    fireEvent.click(within(region).getByRole("button", { name: /fetch recent orders/i }));
    await within(region).findByText("ORD-PAID");
    expect(within(region).getByText("paid")).toBeTruthy();
    expect(within(region).getByText("Whole milk: 0.5 L")).toBeTruthy();
    expect(within(region).queryByText(/Warning/)).toBeNull();
  });

  it("surfaces refund-unverified, incomplete and unmapped lines as warnings", async () => {
    api.fetchPilotCloverShadowOrders.mockResolvedValue(result([{
      ...baseOrder, cloverOrderId: "ORD-REV", status: "review", potentiallyEligible: false, requiresReview: true,
      lineItemsIncomplete: true, financialIncomplete: true, refundsUnverified: true,
      lines: [{ ...line, mappingStatus: "unmapped", recipePreview: {} }],
    }]));
    const region = await openPanel();
    fireEvent.click(within(region).getByRole("button", { name: /fetch recent orders/i }));
    await within(region).findByText("ORD-REV");
    expect(within(region).getByText(/line-item data was incomplete/)).toBeTruthy();
    expect(within(region).getByText(/payment\/refund verification is unavailable/)).toBeTruthy();
    expect(within(region).getByText("Refund status is unverified.")).toBeTruthy();
    expect(within(region).getByText(/no Clover-to-Flowtally mapping exists/)).toBeTruthy();
  });

  it("locks the button while fetching so a double click sends one request", async () => {
    let resolve!: (value: unknown) => void;
    api.fetchPilotCloverShadowOrders.mockReturnValue(new Promise((r) => { resolve = r; }));
    const region = await openPanel();
    const button = within(region).getByRole("button", { name: /fetch recent orders/i });
    fireEvent.click(button);
    const busy = await within(region).findByRole("button", { name: /fetching orders/i });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(api.fetchPilotCloverShadowOrders).toHaveBeenCalledTimes(1);
    resolve(result([]));
    await within(region).findByText("No Clover orders were returned for this location.");
  });

  it("shows the failure, keeps earlier results out of view of a false zero, and a retry succeeds", async () => {
    api.fetchPilotCloverShadowOrders.mockRejectedValueOnce(new Error("Clover access was denied (403)."));
    const region = await openPanel();
    fireEvent.click(within(region).getByRole("button", { name: /fetch recent orders/i }));
    await screen.findByText(/Clover access was denied \(403\)/);
    expect(within(region).getByText("No retrieval completed yet.")).toBeTruthy();
    api.fetchPilotCloverShadowOrders.mockResolvedValueOnce(result([baseOrder]));
    fireEvent.click(within(region).getByRole("button", { name: /fetch recent orders/i }));
    await within(region).findByText("ORD-PAID");
    await waitFor(() => expect(within(region).getByText(/1 result$/)).toBeTruthy());
  });

  it("hides the panel entirely when shadow orders are disabled", async () => {
    api.fetchPilotCloverStatus.mockResolvedValue({
      enabled: true, catalogEnabled: true, shadowOrdersEnabled: false,
      connection: { environment: "sandbox", merchantName: "Sandbox Cafe", merchantId: "M1", status: "connected" },
    });
    render(<MemoryRouter><PilotCloverConnection /></MemoryRouter>);
    await screen.findByText(/Sandbox Cafe/);
    expect(screen.queryByRole("region", { name: "Clover shadow orders" })).toBeNull();
  });
});
