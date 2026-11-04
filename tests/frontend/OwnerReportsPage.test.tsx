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
  fetchPilotDailyClose: vi.fn(),
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
  fetchPilotDailyClose: mocks.fetchPilotDailyClose,
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
    mocks.fetchPilotDailyClose.mockResolvedValueOnce({ history: [] });
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

  it("downloads the exact summary rows for a completed close as the backend reports it (Complete)", async () => {
    mocks.fetchCustomerSession.mockResolvedValueOnce({
      user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
      membershipRole: "owner",
      currentOrganizationId: 42,
      currentLocationId: 7,
      organizations: [{ organization: { id: 42, name: "Queen St Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE" }, membershipRole: "owner", selected: true }],
      csrfToken: "csrf-token",
    });
    mocks.fetchPilotDashboard.mockResolvedValueOnce({
      summary: { inventoryItemCount: 12, inventoryMovementCount: 9, recentPriceChangeCount: 0 },
      recentInvoices: [], recentMovements: [], recentPriceChanges: [], pendingDraftInvoices: [], pendingDraftCountSessions: [], pendingDraftReorderPlans: [],
      supplierSpend: [{ supplier: "Dairy Co", spend: 240.5, invoiceCount: 3 }],
      reorderSuggestions: [],
      workflow: { purchase: "Done", review: "Done", inventory: "Updated", reorder: "Done", close: "Complete", export: "Not ready" },
    });
    mocks.fetchPilotPurchases.mockResolvedValueOnce({
      invoices: [], suppliers: [], purchaseLines: [], priceChanges: [],
      summary: { thisMonthSpend: 0, uploadsNeedingReview: 0, priceChangesFlagged: 0, mappedItems: 0, exportReady: 3, needsMapping: 0 },
      exportReadiness: { readyForCsv: 3, needsReview: 0, needsMapping: 0, quickBooksFutureOnly: true },
    });
    mocks.fetchCustomerAuditEvents.mockResolvedValueOnce({ events: [] });
    mocks.fetchPilotDailyClose.mockResolvedValueOnce({
      history: [{
        id: 7, businessDate: "2026-08-30", status: "COMPLETED", completedAt: "2026-08-30T22:00:00Z", notes: "",
        summarySnapshot: { sales: { grossSales: 900, refunds: 20, tips: 30, netSales: 880 }, cashReconciliation: { expectedCash: 300, countedCash: 295, overShort: -5 } },
      }],
    });

    renderPage();
    await screen.findByRole("heading", { name: "Reports & exports" });
    fireEvent.click(screen.getByRole("button", { name: "Download Daily Close CSV" }));
    expect(mocks.downloadCsvFile).toHaveBeenLastCalledWith("flowtally-daily-close-queen-st-cafe.csv", [
      { businessDate: "2026-08-30", completedAt: "2026-08-30T22:00:00Z", grossSales: 900, refunds: 20, tips: 30, netSales: 880, expectedCash: 300, countedCash: 295, cashOverShort: -5, notes: "" },
    ]);
    mocks.downloadCsvFile.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Download summary CSV" }));
    expect(mocks.downloadCsvFile).toHaveBeenCalledTimes(1);
    const [filename, rows] = mocks.downloadCsvFile.mock.calls[0];
    expect(filename).toBe("flowtally-owner-report-queen-st-cafe.csv");
    expect(rows).toEqual([
      { section: "Purchase CSV", status: "Ready", detail: "3 invoices are ready for bookkeeping export." },
      { section: "Supplier spend", status: "Ready", detail: "Dairy Co leads spending this period." },
      { section: "Inventory summary", status: "Ready", detail: "12 items and 9 movement records tracked." },
      { section: "Daily close", status: "Complete", detail: "Close workflow is caught up." },
      { section: "Price changes", status: "No events", detail: "No price changes were detected." },
      { section: "Monthly owner report", status: "Ready", detail: "Queen St Cafe is ready for the accountant handoff when the blockers clear." },
      { section: "Audit trail", status: "No events", detail: "No audit events have been recorded yet." },
    ]);
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
