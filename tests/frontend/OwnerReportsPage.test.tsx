import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { OwnerReportsPage } from "../../src/pages/OwnerReportsPage";

const mocks = vi.hoisted(() => ({
  fetchCustomerSession: vi.fn(),
  fetchCustomerAuditEvents: vi.fn(),
  fetchPilotDashboard: vi.fn(),
  fetchPilotPurchases: vi.fn(),
  downloadCsvFile: vi.fn(),
  startGoogleLogin: vi.fn(),
}));

vi.mock("../../src/lib/customerAuth", () => ({
  fetchCustomerSession: mocks.fetchCustomerSession,
  startGoogleLogin: mocks.startGoogleLogin,
}));

vi.mock("../../src/lib/audit", () => ({
  fetchCustomerAuditEvents: mocks.fetchCustomerAuditEvents,
}));

vi.mock("../../src/pilot/pilotApi", () => ({
  fetchPilotDashboard: mocks.fetchPilotDashboard,
  fetchPilotPurchases: mocks.fetchPilotPurchases,
}));

vi.mock("../../src/lib/reportExports", () => ({
  downloadCsvFile: mocks.downloadCsvFile,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage(path = "/owner/reports") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OwnerReportsPage />
    </MemoryRouter>,
  );
}

describe("OwnerReportsPage", () => {
  it("renders owner reporting summaries and csv downloads from authenticated data", async () => {
    mocks.fetchCustomerSession.mockResolvedValueOnce({
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: 42,
      currentLocationId: 7,
      organizations: [
        {
          organization: { id: 42, name: "Demo Bistro", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE" },
          membershipRole: "owner",
          selected: true,
        },
      ],
      csrfToken: "csrf-token",
    });
    mocks.fetchPilotDashboard.mockResolvedValueOnce({
      summary: {
        weeklyInvoiceSpend: 482.5,
        weeklyInvoiceCount: 4,
        monthlyInvoiceCount: 8,
        monthlyInvoiceSpend: 1120.25,
        invoiceReviewQueueCount: 1,
        inventoryItemCount: 12,
        inventoryLowStockCount: 3,
        inventoryOutOfStockCount: 1,
        inventoryCountNeededCount: 2,
        inventoryMovementCount: 9,
        inventoryReceiptCount: 6,
        inventoryValue: 915.75,
        recentPriceChangeCount: 2,
        inventoryItemsToReorderCount: 4,
      },
      recentInvoices: [],
      recentMovements: [],
      recentPriceChanges: [
        { itemName: "Milk", supplier: "Dairy Co", invoiceDate: "2026-06-21", changePercent: 12.5, status: "Increased" },
      ],
      pendingDraftInvoices: [],
      pendingDraftCountSessions: [],
      pendingDraftReorderPlans: [],
      supplierSpend: [
        { supplier: "Dairy Co", spend: 240.5, invoiceCount: 3 },
        { supplier: "Bakery Ltd", spend: 180.25, invoiceCount: 2 },
      ],
      reorderSuggestions: [],
      workflow: { purchase: "Done", review: "Done", inventory: "Updated", reorder: "Alert", close: "Done", export: "Not ready" },
    });
    mocks.fetchPilotPurchases.mockResolvedValueOnce({
      invoices: [
        {
          id: 101,
          organizationId: 42,
          locationId: 7,
          supplierId: 21,
          supplier: { id: 21, organizationId: 42, name: "Dairy Co" },
          invoiceNumber: "INV-1001",
          invoiceDate: "2026-06-21",
          subtotal: 100,
          tax: 13,
          totalAmount: 113,
          notes: "",
          status: "Completed",
          sourceFileName: "",
          sourceFileType: "",
          sourceFileKey: "",
          extractedText: "",
          extractionStatus: "",
          receivedAt: null,
          receivedByUserId: null,
          createdByUserId: null,
          updatedByUserId: null,
          postedAt: null,
          lineItems: [{ id: 1 }, { id: 2 }],
          createdAt: "2026-06-21T09:00:00.000Z",
          updatedAt: "2026-06-21T09:30:00.000Z",
        },
        {
          id: 102,
          organizationId: 42,
          locationId: 7,
          supplierId: 22,
          supplier: { id: 22, organizationId: 42, name: "Bakery Ltd" },
          invoiceNumber: "INV-1002",
          invoiceDate: "2026-06-22",
          subtotal: 75,
          tax: 9.75,
          totalAmount: 84.75,
          notes: "",
          status: "Draft",
          sourceFileName: "",
          sourceFileType: "",
          sourceFileKey: "",
          extractedText: "",
          extractionStatus: "",
          receivedAt: null,
          receivedByUserId: null,
          createdByUserId: null,
          updatedByUserId: null,
          postedAt: null,
          lineItems: [{ id: 3 }],
          createdAt: "2026-06-22T10:00:00.000Z",
          updatedAt: "2026-06-22T10:15:00.000Z",
        },
      ],
      suppliers: [],
      purchaseLines: [],
      priceChanges: [],
      summary: {
        thisMonthSpend: 197.75,
        uploadsNeedingReview: 1,
        priceChangesFlagged: 2,
        mappedItems: 6,
        exportReady: 1,
        needsMapping: 0,
      },
      exportReadiness: {
        readyForCsv: 1,
        needsReview: 1,
        needsMapping: 0,
        quickBooksFutureOnly: true,
      },
    });
    mocks.fetchCustomerAuditEvents.mockResolvedValueOnce({
      events: [
        {
          id: 1,
          organizationId: 42,
          locationId: 7,
          actorUserId: 1,
          eventType: "invoice.completed",
          entityType: "purchase_invoice",
          entityId: 101,
          requestId: null,
          sourceIp: null,
          userAgent: null,
          metadata: { totalAmount: 113 },
          createdAt: "2026-06-21T09:35:00.000Z",
        },
      ],
    });

    renderPage();

    await screen.findByRole("heading", { name: "Reports & exports" });
    expect(screen.getByText("Demo Bistro")).toBeVisible();
    expect(screen.getByText("Purchase CSV")).toBeVisible();
    expect(screen.getByText("Dairy Co leads spending this period.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Download summary CSV" }));
    expect(mocks.downloadCsvFile).toHaveBeenCalledWith(
      "flowtally-owner-report-demo-bistro.csv",
      expect.arrayContaining([
        expect.objectContaining({ section: "Purchase CSV", status: "Needs review" }),
        expect.objectContaining({ section: "Audit trail", status: "Ready" }),
      ]),
    );
  });

  it("shows the owner-only permission state for non-owner sessions", async () => {
    mocks.fetchCustomerSession.mockResolvedValueOnce({
      user: { id: 1, email: "manager@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "manager",
      currentOrganizationId: 42,
      currentLocationId: 7,
      organizations: [],
      csrfToken: "csrf-token",
    });

    renderPage();

    await screen.findByRole("heading", { name: "You do not have owner access to reporting" });
    expect(mocks.fetchPilotDashboard).not.toHaveBeenCalled();
    expect(mocks.fetchPilotPurchases).not.toHaveBeenCalled();
  });
});
