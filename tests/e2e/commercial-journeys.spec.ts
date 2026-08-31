import { expect, test, type Page } from "@playwright/test";

declare const process: {
  env: Record<string, string | undefined>;
};

type OrganizationSummary = {
  id: number;
  name: string;
  lifecycleStatus: string;
  setupStatus: string;
  subscriptionStatus: string;
  setupTemplateKey?: string;
  setupFeeStatus?: string;
  isProspect?: boolean;
  activeAt?: string | null;
  setupCompletedAt?: string | null;
};

type Session = {
  user: { id: number; email: string; isActive: boolean; createdAt: string | null; updatedAt: string | null };
  platformRole: string | null;
  membershipRole: string | null;
  currentOrganizationId: number | null;
  currentLocationId: number | null;
  csrfToken: string;
  enabledModuleKeys?: string[];
  supportAccessGrant?: {
    id: number;
    organizationId: number;
    reason: string;
    caseReference: string;
    status: string;
    startsAt: string | null;
    expiresAt: string | null;
  } | null;
  organizations?: Array<{
    organization: OrganizationSummary;
    membershipRole: string;
    selected: boolean;
  }>;
};

type MockState = {
  session: Session | null;
  csrfToken: string;
  currentOrganization: OrganizationSummary | null;
  pilotPurchaseFlow?: EmptyPurchaseFlowState;
  invitations: Array<{
    id: number;
    organizationId: number;
    invitedEmail: string;
    role: string;
    status: string;
    expiresAt: string | null;
    revokedAt: string | null;
    acceptedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  auditEvents: Array<{
    id: number;
    organizationId: number;
    locationId: number | null;
    actorUserId: number | null;
    eventType: string;
    entityType: string;
    entityId: number | null;
    requestId: string | null;
    sourceIp: string | null;
    userAgent: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
  supportGrants: Array<{
    id: number;
    organizationId: number;
    organizationName: string;
    supportUserId: number;
    supportUserEmail: string;
    requestedByUserId: number | null;
    approvedByUserId: number | null;
    reason: string;
    caseReference: string;
    status: string;
    startsAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    visibleInUi: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  squareConnection: any;
  squareCatalogMappings?: any;
  squareUsage?: any;
  menuState?: {
    organizationId: number;
    locationId: number;
    inventory: Array<{
      id: number;
      name: string;
      stockUnit: string;
    }>;
  };
  importJobs: any[];
  importJob: any | null;
};

type DailyCloseUsageFixture = {
  period: { startAt: string; endAt: string };
  coverage: Record<string, number | boolean>;
  totals: {
    theoreticalUsage: number;
    actualUsage: number | null;
    discrepancy: number | null;
    discrepancyPercent: number | null;
  };
  contributingMenuItems: Array<Record<string, unknown>>;
  unmappedVariations: Array<Record<string, unknown>>;
  ingredientUsage: Array<Record<string, unknown>>;
};

type DailyCloseSnapshotFixture = {
  healthStatus: string;
  inventoryValue: number;
  sales: Record<string, unknown>;
  usage: DailyCloseUsageFixture;
  variance: {
    quantity: number | null;
    percent: number | null;
    value: number;
  };
  square: Record<string, unknown>;
  readyToFinalize: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function makeOrganization(overrides: Partial<OrganizationSummary> = {}): OrganizationSummary {
  return {
    id: 42,
    name: "Demo Bistro",
    lifecycleStatus: "ACTIVE",
    setupStatus: "COMPLETE",
    subscriptionStatus: "ACTIVE",
    setupTemplateKey: "GENERIC_RESTAURANT",
    setupFeeStatus: "confirmed",
    isProspect: false,
    activeAt: nowIso(),
    setupCompletedAt: nowIso(),
    ...overrides,
  };
}

function makeActiveOwnerSession(overrides: Partial<Session> = {}): Session {
  const organization = makeOrganization();
  return {
    user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
    platformRole: null,
    membershipRole: "owner",
    currentOrganizationId: organization.id,
    currentLocationId: 7,
    csrfToken: "csrf-token",
    organizations: [{ organization, membershipRole: "owner", selected: true }],
    ...overrides,
  };
}

function makeSetupAdminSession(overrides: Partial<Session> = {}): Session {
  const organization = makeOrganization({
    lifecycleStatus: "READY_FOR_REVIEW",
    setupStatus: "CUSTOMER_REVIEW",
    subscriptionStatus: "SETUP_PAID",
    isProspect: true,
    setupFeeStatus: "confirmed",
  });
  return {
    user: { id: 2, email: "setup.admin@example.com", isActive: true, createdAt: null, updatedAt: null },
    platformRole: "setup_admin",
    membershipRole: null,
    currentOrganizationId: null,
    currentLocationId: null,
    csrfToken: "csrf-token",
    organizations: [{ organization, membershipRole: "owner", selected: true }],
    ...overrides,
  };
}

function makeProspectSession(overrides: Partial<Session> = {}): Session {
  return {
    user: { id: 3, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null },
    platformRole: null,
    membershipRole: "owner",
    currentOrganizationId: null,
    currentLocationId: null,
    csrfToken: "csrf-token",
    organizations: [],
    ...overrides,
  };
}

function createImportJob() {
  return {
    id: 101,
    organizationId: 42,
    entityScope: "supplier",
    sourceFileName: "suppliers.csv",
    sourceColumns: ["name", "contact_email", "city"],
    sampleRows: [{ name: "North Farm", contact_email: "orders@northfarm.test", city: "Toronto" }],
    status: "DRAFT",
    rowCount: 1,
    previewRowCount: 1,
    blockedRowCount: 0,
    warningCount: 0,
    appliedRowCount: 0,
    batchId: "batch-101",
    sourceHash: "sha256:abc123",
    rollbackBlockers: [],
    rows: [
      {
        id: 1,
        rowNumber: 1,
        status: "ready",
        targetEntityType: "supplier",
        targetEntityId: null,
        blockedCount: 0,
        issues: [],
      },
    ],
  };
}

type EmptyPurchaseFlowState = {
  suppliers: Array<{ id: number; name: string; categoryFocus: string; contactName: string; contactPhone: string; contactEmail: string; orderingNotes: string; notes: string; isActive: boolean }>;
  inventoryItems: Array<{ id: number; name: string; stockUnit: string }>;
  invoices: any[];
  nextSupplierId: number;
  nextItemId: number;
  nextInvoiceId: number;
  nextLineId: number;
};

function makeEmptyPurchaseFlowState(): EmptyPurchaseFlowState {
  return {
    suppliers: [],
    inventoryItems: [],
    invoices: [],
    nextSupplierId: 20,
    nextItemId: 30,
    nextInvoiceId: 100,
    nextLineId: 1,
  };
}

function enableEmptyPurchaseWorkflow(state: MockState, flowState: EmptyPurchaseFlowState) {
  state.pilotPurchaseFlow = flowState;
}

function buildEmptyPurchasesResponse(state: EmptyPurchaseFlowState) {
  return {
    invoices: state.invoices,
    suppliers: state.suppliers.map((supplier) => ({
      id: supplier.id,
      organizationId: 5,
      name: supplier.name,
      normalizedName: supplier.name.trim().toLowerCase(),
      categoryFocus: supplier.categoryFocus,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      contactEmail: supplier.contactEmail,
      orderingNotes: supplier.orderingNotes,
      notes: supplier.notes,
      isActive: supplier.isActive,
      inventoryItemCount: 0,
      purchaseInvoiceCount: 0,
      supplierItemMappingCount: 0,
      latestInvoiceDate: null,
      historicalReferenceCount: 0,
      recentInvoices: [],
      recentMappings: [],
    })),
    purchaseLines: state.invoices.flatMap((invoice) => invoice.lineItems ?? []),
    priceChanges: [],
    summary: {
      thisMonthSpend: 0,
      uploadsNeedingReview: 0,
      priceChangesFlagged: 0,
      mappedItems: state.invoices.flatMap((invoice) => invoice.lineItems ?? []).filter((line) => line.inventoryItemId).length,
      exportReady: state.invoices.length,
      needsMapping: state.invoices.flatMap((invoice) => invoice.lineItems ?? []).filter((line) => !line.inventoryItemId).length,
    },
    exportReadiness: {
      readyForCsv: state.invoices.length,
      needsReview: 0,
      needsMapping: 0,
      quickBooksFutureOnly: true,
    },
  };
}

function buildMockPurchaseInvoice(
  state: EmptyPurchaseFlowState,
  body: any,
  invoiceId: number,
  existingLineItems: any[] = [],
) {
  const supplierName = String(body.supplierName ?? "");
  const supplier = state.suppliers.find((entry) => entry.name === supplierName) ?? null;
  const invoiceLineItems = (Array.isArray(body.lineItems) ? body.lineItems : []).map((line: any, index: number) => ({
    id: existingLineItems[index]?.id ?? state.nextLineId++,
    invoiceId,
    supplierName,
    invoiceNumber: String(body.invoiceNumber ?? "FP-1000"),
    invoiceDate: String(body.invoiceDate ?? "2026-08-18"),
    inventoryItemId: line.inventoryItemId ?? null,
    supplierItemMappingId: null,
    lineIndex: index,
    description: String(line.description ?? ""),
    normalizedDescription: String(line.description ?? "").trim().toLowerCase(),
    purchaseUnit: String(line.purchaseUnit ?? "each"),
    inventoryUnit: String(line.inventoryUnit ?? "each"),
    conversionFactor: Number(line.conversionFactor ?? 1),
    quantity: Number(line.quantity ?? 1),
    unitPrice: Number(line.unitPrice ?? 0),
    lineTotal: Number(line.lineTotal ?? 0),
    confidence: Number(line.confidence ?? 0.5),
    needsReview: Boolean(line.needsReview ?? true),
    previousUnitPrice: null,
    priceChangePercent: null,
    note: String(line.note ?? ""),
    createdAt: existingLineItems[index]?.createdAt ?? null,
    updatedAt: null,
  }));

  return {
    id: invoiceId,
    organizationId: 5,
    locationId: 9,
    supplierId: supplier?.id ?? 0,
    supplier: supplier
      ? {
          id: supplier.id,
          organizationId: 5,
          name: supplier.name,
          normalizedName: supplier.name.trim().toLowerCase(),
          categoryFocus: supplier.categoryFocus,
          contactName: supplier.contactName,
          contactPhone: supplier.contactPhone,
          contactEmail: supplier.contactEmail,
          orderingNotes: supplier.orderingNotes,
          notes: supplier.notes,
          isActive: supplier.isActive,
          createdAt: null,
          updatedAt: null,
        }
      : null,
    invoiceNumber: String(body.invoiceNumber ?? "FP-1000"),
    invoiceDate: String(body.invoiceDate ?? "2026-08-18"),
    subtotal: Number(body.subtotal ?? 0),
    tax: Number(body.tax ?? 0),
    totalAmount: Number(body.totalAmount ?? 0),
    notes: String(body.notes ?? ""),
    status: String(body.status ?? "Draft"),
    sourceFileName: String(body.sourceFileName ?? ""),
    sourceFileType: String(body.sourceFileType ?? ""),
    sourceFileKey: "",
    extractedText: String(body.extractedText ?? ""),
    extractionStatus: String(body.extractionStatus ?? "manual"),
    receivedAt: existingLineItems.length ? null : null,
    receivedByUserId: null,
    createdByUserId: 1,
    updatedByUserId: 1,
    postedAt: null,
    lineItems: invoiceLineItems,
    createdAt: null,
    updatedAt: null,
  };
}

function buildEmptyInventoryResponse(state: EmptyPurchaseFlowState) {
  return {
    items: state.inventoryItems.map((item) => ({
      id: item.id,
      organizationId: 5,
      locationId: 9,
      supplierId: null,
      name: item.name,
      normalizedName: item.name.trim().toLowerCase(),
      category: "Other",
      stockUnit: item.stockUnit,
      currentOnHand: 0,
      minQuantity: 0,
      parLevel: 0,
      preferredSupplierName: "",
      latestPurchasePrice: 0,
      lastPurchaseUnit: item.stockUnit,
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
    })),
    movements: [],
    countSessions: [],
    reorderPlan: { suggestions: [], groupedBySupplier: [] },
    summary: {},
  };
}

async function jsonResponse(route: any, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function installMockApi(page: Page, state: MockState) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    const body = (() => {
      const raw = route.request().postData();
      if (!raw) {
        return {};
      }
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    })();

    if (path === "/api/auth/me" && method === "GET") {
      if (state.session === null) {
        return jsonResponse(route, { error: "Authentication required." }, 401);
      }
      return jsonResponse(route, state.session);
    }

    if (path === "/api/auth/csrf" && method === "GET") {
      return jsonResponse(route, { csrfToken: state.csrfToken });
    }

    if (path === "/api/auth/logout" && method === "POST") {
      return jsonResponse(route, { ok: true });
    }

    if (path === "/api/organizations" && method === "GET") {
      const organization = state.currentOrganization ?? state.session?.organizations?.find((entry) => entry.selected)?.organization ?? state.session?.organizations?.[0]?.organization ?? makeOrganization();
      const organizations = state.session?.organizations ?? (state.session
        ? [
            {
              organization,
              membershipRole: state.session.membershipRole ?? "owner",
              selected: Boolean(state.session.currentOrganizationId === organization.id),
            },
          ]
        : []);
      return jsonResponse(route, {
        organizations,
        currentOrganizationId: state.session?.currentOrganizationId ?? null,
        currentMembershipId: state.session?.currentOrganizationId ? 1 : null,
        currentLocationId: state.session?.currentLocationId ?? null,
        currentOrganization: {
          organization,
          restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
          currentLocation: state.session?.currentLocationId ? { id: state.session.currentLocationId, name: "Main Dining Room" } : null,
          membershipRole: state.session?.membershipRole ?? "owner",
          enabledModuleKeys: state.session?.enabledModuleKeys ?? [],
        },
        restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
      });
    }

    if (path === "/api/organizations/select" && method === "POST") {
      const organizationId = Number(body.organizationId ?? 0);
      const organization = state.session?.organizations?.find((entry) => entry.organization.id === organizationId)?.organization ?? state.currentOrganization ?? makeOrganization({ id: organizationId });
      state.currentOrganization = organization;
      if (state.session) {
        state.session = {
          ...state.session,
          currentOrganizationId: organization.id,
          currentLocationId: 7,
          organizations: (state.session.organizations ?? [
            {
              organization,
              membershipRole: state.session.membershipRole ?? "owner",
              selected: true,
            },
          ]).map((entry) => ({
            ...entry,
            selected: entry.organization.id === organization.id,
          })),
        };
      }
      return jsonResponse(route, {
        organization,
        restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
        currentLocation: { id: 7, name: "Main Dining Room" },
        membershipRole: state.session?.membershipRole ?? "owner",
        enabledModuleKeys: state.session?.enabledModuleKeys ?? [],
      });
    }

    if (path === "/api/onboarding/organizations" && method === "POST") {
      if (state.currentOrganization) {
        return jsonResponse(route, { error: "This account already has a prospective organization." }, 409);
      }
      const organization = makeOrganization({
        id: 42,
        name: String(body.name ?? "Demo Bistro"),
        lifecycleStatus: "ONBOARDING",
        setupStatus: "INTAKE",
        subscriptionStatus: "NONE",
        isProspect: true,
      });
      state.currentOrganization = organization;
      if (state.session) {
        state.session = {
          ...state.session,
          currentOrganizationId: organization.id,
          currentLocationId: 8,
          organizations: [{ organization, membershipRole: "owner", selected: true }],
        };
      }
      return jsonResponse(route, {
        organization,
        membershipRole: "owner",
        currentLocationId: 8,
      });
    }

    if (path.startsWith("/api/onboarding/organizations/") && path.endsWith("/request-setup") && method === "POST") {
      if (state.currentOrganization) {
        state.currentOrganization = { ...state.currentOrganization, setupStatus: "DATA_REQUESTED" };
      }
      return jsonResponse(route, { organization: state.currentOrganization });
    }

    if (path === "/api/organization-invitations" && method === "GET") {
      return jsonResponse(route, { invitations: state.invitations });
    }

    if (path === "/api/organization-invitations" && method === "POST") {
      const invitation = {
        id: state.invitations.length + 1,
        organizationId: state.currentOrganization?.id ?? 42,
        invitedEmail: String(body.email ?? ""),
        role: String(body.role ?? "manager"),
        status: "pending",
        expiresAt: null,
        revokedAt: null,
        acceptedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.invitations = [invitation, ...state.invitations];
      return jsonResponse(route, { invitation, invitationUrl: `/invite/token-${invitation.id}` });
    }

    if (path.startsWith("/api/organization-invitations/") && path.endsWith("/cancel") && method === "POST") {
      const invitationId = Number(path.split("/").slice(-2, -1)[0]);
      state.invitations = state.invitations.map((invitation) => (invitation.id === invitationId ? { ...invitation, status: "revoked", revokedAt: nowIso() } : invitation));
      const invitation = state.invitations.find((item) => item.id === invitationId) ?? null;
      return jsonResponse(route, { invitation });
    }

    if (path === "/api/pilot/audit-events" && method === "GET") {
      return jsonResponse(route, { events: state.auditEvents });
    }

    if (path === "/api/pilot/dashboard" && method === "GET") {
      return jsonResponse(route, {
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
    }

    const purchaseFlow = state.pilotPurchaseFlow;

    if (path === "/api/pilot/purchases" && method === "GET") {
      if (purchaseFlow) {
        return jsonResponse(route, buildEmptyPurchasesResponse(purchaseFlow));
      }
      return jsonResponse(route, {
        invoices: [
          {
            id: 101,
            organizationId: 42,
            locationId: 7,
            supplierId: 21,
            supplier: { id: 21, organizationId: 42, name: "Dairy Co", normalizedName: "dairy-co", categoryFocus: "Dairy", contactName: "", contactPhone: "", contactEmail: "", orderingNotes: "", notes: "", isActive: true, createdAt: null, updatedAt: null },
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
            supplier: { id: 22, organizationId: 42, name: "Bakery Ltd", normalizedName: "bakery-ltd", categoryFocus: "Bakery", contactName: "", contactPhone: "", contactEmail: "", orderingNotes: "", notes: "", isActive: true, createdAt: null, updatedAt: null },
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
    }

    const menuState = state.menuState;
    if (path === "/api/pilot/inventory" && method === "GET") {
      if (purchaseFlow) {
        return jsonResponse(route, buildEmptyInventoryResponse(purchaseFlow));
      }
      if (menuState) {
        return jsonResponse(route, {
          items: menuState.inventory.map((item: any) => ({
            id: item.id,
            organizationId: menuState.organizationId,
            locationId: menuState.locationId,
            supplierId: null,
            name: item.name,
            normalizedName: String(item.name).trim().toLowerCase(),
            category: "Prepared",
            stockUnit: item.stockUnit,
            currentOnHand: 0,
            minQuantity: 0,
            parLevel: 0,
            preferredSupplierName: "",
            latestPurchasePrice: null,
            lastPurchaseUnit: item.stockUnit,
            lastPurchaseConversionFactor: 1,
            lastReceivedAt: null,
            lastCountedAt: null,
            averageDailyUsage: null,
            estimatedCostMethod: "latest_purchase_price",
            active: true,
            notes: "",
            createdByUserId: null,
            updatedByUserId: null,
            createdAt: null,
            updatedAt: null,
          })),
          movements: [],
          countSessions: [],
          reorderPlan: { suggestions: [], groupedBySupplier: [] },
          summary: {},
        });
      }
    }

    if (purchaseFlow && path === "/api/pilot/suppliers" && method === "POST") {
      const supplier = {
        id: purchaseFlow.nextSupplierId++,
        name: String(body.name ?? ""),
        categoryFocus: String(body.categoryFocus ?? "Other"),
        contactName: String(body.contactName ?? ""),
        contactPhone: String(body.contactPhone ?? ""),
        contactEmail: String(body.contactEmail ?? ""),
        orderingNotes: String(body.orderingNotes ?? ""),
        notes: String(body.notes ?? ""),
        isActive: body.isActive !== false,
      };
      purchaseFlow.suppliers = [...purchaseFlow.suppliers, supplier];
      return jsonResponse(route, {
        ...supplier,
        organizationId: 5,
        normalizedName: supplier.name.trim().toLowerCase(),
        inventoryItemCount: 0,
        purchaseInvoiceCount: 0,
        supplierItemMappingCount: 0,
        latestInvoiceDate: null,
        historicalReferenceCount: 0,
        recentInvoices: [],
        recentMappings: [],
      });
    }

    if (purchaseFlow && path === "/api/pilot/inventory/items" && method === "POST") {
      const item = {
        id: purchaseFlow.nextItemId++,
        name: String(body.name ?? ""),
        stockUnit: String(body.stockUnit ?? "each"),
      };
      purchaseFlow.inventoryItems = [...purchaseFlow.inventoryItems, item];
      return jsonResponse(route, {
        id: item.id,
        organizationId: 5,
        locationId: 9,
        supplierId: null,
        name: item.name,
        normalizedName: item.name.trim().toLowerCase(),
        category: String(body.category ?? "Other"),
        stockUnit: item.stockUnit,
        currentOnHand: Number(body.currentOnHand ?? 0),
        minQuantity: Number(body.minQuantity ?? 0),
        parLevel: Number(body.parLevel ?? 0),
        preferredSupplierName: String(body.preferredSupplierName ?? ""),
        latestPurchasePrice: Number(body.latestPurchasePrice ?? 0),
        lastPurchaseUnit: String(body.lastPurchaseUnit ?? "each"),
        lastPurchaseConversionFactor: Number(body.lastPurchaseConversionFactor ?? 1),
        lastReceivedAt: null,
        lastCountedAt: null,
        averageDailyUsage: null,
        estimatedCostMethod: "latest_purchase_price",
        active: Boolean(body.active ?? true),
        notes: String(body.notes ?? ""),
        createdByUserId: 1,
        updatedByUserId: 1,
        createdAt: null,
        updatedAt: null,
      });
    }

    if (purchaseFlow && path === "/api/pilot/purchases/invoices" && method === "POST") {
      const invoice = buildMockPurchaseInvoice(purchaseFlow, body, purchaseFlow.nextInvoiceId++);
      purchaseFlow.invoices = [invoice, ...purchaseFlow.invoices.filter((entry) => entry.id !== invoice.id)];
      return jsonResponse(route, invoice);
    }

    if (purchaseFlow && path.startsWith("/api/pilot/purchases/invoices/") && method === "PATCH") {
      const invoiceId = Number(path.split("/").at(-1));
      const index = purchaseFlow.invoices.findIndex((entry) => entry.id === invoiceId);
      const existingInvoice = index >= 0 ? purchaseFlow.invoices[index] : null;
      const invoice = buildMockPurchaseInvoice(purchaseFlow, body, invoiceId, existingInvoice?.lineItems ?? []);
      const nextInvoices = [...purchaseFlow.invoices.filter((entry) => entry.id !== invoice.id)];
      purchaseFlow.invoices = [invoice, ...nextInvoices];
      return jsonResponse(route, invoice);
    }

    if (purchaseFlow && path.endsWith("/receive") && path.startsWith("/api/pilot/purchases/invoices/") && method === "POST") {
      const invoiceId = Number(path.split("/").at(-2));
      const invoice = purchaseFlow.invoices.find((entry) => entry.id === invoiceId) ?? purchaseFlow.invoices[0];
      return jsonResponse(route, {
        ...invoice,
        status: "Completed",
        receivedAt: nowIso(),
      });
    }

    if (menuState && path === "/api/pilot/inventory" && method === "GET") {
      return jsonResponse(route, {
        items: menuState.inventory.map((item: any) => ({
          id: item.id,
          organizationId: menuState.organizationId,
          locationId: menuState.locationId,
          supplierId: null,
          name: item.name,
          normalizedName: String(item.name).trim().toLowerCase(),
          category: "Prepared",
          stockUnit: item.stockUnit,
          currentOnHand: 0,
          minQuantity: 0,
          parLevel: 0,
          preferredSupplierName: "",
          latestPurchasePrice: null,
          lastPurchaseUnit: item.stockUnit,
          lastPurchaseConversionFactor: 1,
          lastReceivedAt: null,
          lastCountedAt: null,
          averageDailyUsage: null,
          estimatedCostMethod: "latest_purchase_price",
          active: true,
          notes: "",
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        })),
        movements: [],
        countSessions: [],
        reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: {},
      });
    }

    if (path === "/api/organizations/current" && method === "GET") {
      if (!state.currentOrganization) {
        return jsonResponse(route, { error: "Organization not found." }, 404);
      }
      return jsonResponse(route, {
        organization: state.currentOrganization,
        restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
        currentLocation: { id: 7, name: "Main Dining Room" },
        membershipRole: "owner",
        enabledModuleKeys: state.session?.enabledModuleKeys ?? [],
      });
    }

    if (path === "/api/imports/organizations/42/jobs" && method === "GET") {
      return jsonResponse(route, { jobs: state.importJobs });
    }

    if (path.startsWith("/api/imports/jobs/") && method === "GET") {
      return jsonResponse(route, { job: state.importJob ?? createImportJob() });
    }

    if (path === "/api/imports/jobs" && method === "POST") {
      const job = state.importJob ?? createImportJob();
      state.importJob = { ...job, status: "UPLOADED" };
      state.importJobs = [state.importJob];
      return jsonResponse(route, { job: state.importJob });
    }

    if (path.endsWith("/mapping") && method === "POST") {
      state.importJob = { ...(state.importJob ?? createImportJob()), status: "MAPPING_REQUIRED" };
      return jsonResponse(route, { job: state.importJob });
    }

    if (path.endsWith("/preview") && method === "POST") {
      state.importJob = { ...(state.importJob ?? createImportJob()), status: "READY_FOR_PREVIEW", previewRowCount: 1, blockedRowCount: 0, warningCount: 0 };
      return jsonResponse(route, { job: state.importJob });
    }

    if (path.endsWith("/approve") && method === "POST") {
      state.importJob = { ...(state.importJob ?? createImportJob()), status: "APPROVED" };
      return jsonResponse(route, { job: state.importJob });
    }

    if (path.endsWith("/execute") && method === "POST") {
      state.importJob = { ...(state.importJob ?? createImportJob()), status: "COMPLETED" };
      return jsonResponse(route, { job: state.importJob });
    }

    if (path.endsWith("/rollback") && method === "POST") {
      state.importJob = { ...(state.importJob ?? createImportJob()), status: "ROLLED_BACK" };
      return jsonResponse(route, { job: state.importJob });
    }

    if (path === "/api/platform/setup/organizations" && method === "GET") {
      const organization = state.currentOrganization ?? makeOrganization();
      return jsonResponse(route, { organizations: [{ organization, checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: organization.setupFeeStatus ?? "confirmed", setupStatus: organization.setupStatus, subscriptionStatus: organization.subscriptionStatus, launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: organization.lifecycleStatus === "ACTIVE", readyForActivation: organization.lifecycleStatus !== "ACTIVE" } }] });
    }

    if (path.startsWith("/api/platform/setup/organizations/") && method === "GET") {
      const organization = state.currentOrganization ?? makeOrganization();
      return jsonResponse(route, {
        organization,
        checklist: {
          ownerCount: 1,
          locationCount: 1,
          setupFeeStatus: organization.setupFeeStatus ?? "confirmed",
          setupStatus: organization.setupStatus,
          subscriptionStatus: organization.subscriptionStatus,
          launchBlockers: [],
          missingModules: [],
          squareRequired: true,
          squareComplete: true,
          customerApproved: organization.lifecycleStatus === "ACTIVE",
          readyForActivation: organization.lifecycleStatus !== "ACTIVE",
        },
        locations: [{ id: 7, name: "Main Dining Room", city: "Toronto" }],
        modules: [
          { moduleKey: "PURCHASES", status: "ENABLED" },
          { moduleKey: "INVENTORY", status: "ENABLED" },
          { moduleKey: "REPORTING", status: "READY_FOR_REVIEW" },
        ],
        memberships: [{ userEmail: "owner@example.com", role: "owner" }],
        configuration: { currentVersion: { configurationJson: { dashboardLayouts: { owner: { layoutKey: "owner", widgets: ["dashboard", "imports"] } }, customFields: { supplier: [] }, launchBlockers: [], imports: [], square: {} } } },
        auditEvents: state.auditEvents,
        platformRole: "setup_admin",
      });
    }

    if (path.endsWith("/template") && method === "POST") {
      state.currentOrganization = { ...(state.currentOrganization ?? makeOrganization()), setupTemplateKey: String(body.templateKey ?? "GENERIC_RESTAURANT") };
      return jsonResponse(route, { organization: state.currentOrganization, checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: state.currentOrganization.setupStatus, subscriptionStatus: state.currentOrganization.subscriptionStatus, launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: {} } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/modules") && method === "POST") {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: body.modules ?? [], memberships: [], configuration: { currentVersion: { configurationJson: {} } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/locations") && method === "POST") {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: body.locations ?? [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: {} } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/dashboard-layout") && method === "POST") {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: { dashboardLayouts: body } } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/custom-fields") && method === "POST") {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: { customFields: body.fields } } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/blockers") && method === "POST") {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: body.blockers ?? [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: { launchBlockers: body.blockers } } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/notes") && method === "POST") {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: { internalNotes: body.notes } } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/imports") && method === "POST" && path.includes("/platform/setup/organizations/")) {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: { imports: body.imports } } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/square") && method === "POST" && path.includes("/platform/setup/organizations/")) {
      return jsonResponse(route, { organization: state.currentOrganization ?? makeOrganization(), checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: false, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: { square: body.square } } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/review") && method === "POST") {
      state.currentOrganization = { ...(state.currentOrganization ?? makeOrganization()), lifecycleStatus: "READY_FOR_REVIEW", setupStatus: "CUSTOMER_REVIEW" };
      return jsonResponse(route, { organization: state.currentOrganization, checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "CUSTOMER_REVIEW", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: true, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: {} } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/review/approve") && method === "POST") {
      state.currentOrganization = { ...(state.currentOrganization ?? makeOrganization()), lifecycleStatus: "READY_FOR_REVIEW", setupStatus: "COMPLETE" };
      return jsonResponse(route, { organization: state.currentOrganization, checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "COMPLETE", subscriptionStatus: "SETUP_PAID", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: true, readyForActivation: true }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: {} } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path.endsWith("/activate") && method === "POST") {
      state.currentOrganization = { ...(state.currentOrganization ?? makeOrganization()), lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE" };
      return jsonResponse(route, { organization: state.currentOrganization, checklist: { ownerCount: 1, locationCount: 1, setupFeeStatus: "confirmed", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", launchBlockers: [], missingModules: [], squareRequired: true, squareComplete: true, customerApproved: true, readyForActivation: false }, locations: [], modules: [], memberships: [], configuration: { currentVersion: { configurationJson: {} } }, auditEvents: state.auditEvents, platformRole: "setup_admin" });
    }

    if (path === "/api/platform/support/grants" && method === "GET") {
      return jsonResponse(route, { grants: state.supportGrants });
    }

    if (path === "/api/platform/support/grants" && method === "POST") {
      const grant = {
        id: state.supportGrants.length + 1,
        organizationId: Number(body.organizationId ?? 42),
        organizationName: "Demo Bistro",
        supportUserId: 9,
        supportUserEmail: String(body.supportUserEmail ?? "support@example.com"),
        requestedByUserId: 1,
        approvedByUserId: 1,
        reason: String(body.reason ?? ""),
        caseReference: String(body.caseReference ?? ""),
        status: "active",
        startsAt: body.startsAt ?? null,
        expiresAt: body.expiresAt ?? null,
        revokedAt: null,
        visibleInUi: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.supportGrants = [grant, ...state.supportGrants];
      return jsonResponse(route, { grant });
    }

    if (path.startsWith("/api/platform/support/grants/") && path.endsWith("/revoke") && method === "POST") {
      const grantId = Number(path.split("/").slice(-2, -1)[0]);
      state.supportGrants = state.supportGrants.map((grant) => (grant.id === grantId ? { ...grant, status: "revoked", revokedAt: nowIso() } : grant));
      const grant = state.supportGrants.find((item) => item.id === grantId) ?? null;
      return jsonResponse(route, { grant });
    }

    if (path === "/api/integrations/square/status" && method === "GET") {
      return jsonResponse(route, { connection: state.squareConnection });
    }

    if (path === "/api/integrations/square/disconnect" && method === "POST") {
      state.squareConnection = { ...(state.squareConnection ?? {}), status: "disconnected", syncStatus: "idle" };
      return jsonResponse(route, { connection: state.squareConnection });
    }

    if (path === "/api/integrations/square/locations/sync" && method === "POST") {
      state.squareConnection = {
        ...(state.squareConnection ?? {}),
        locations: [
          {
            id: 1,
            squareLocationId: "S1",
            name: "Square Location 1",
            status: "active",
            rawPayload: { id: "S1" },
            mappings: [],
          },
        ],
        locationCount: 1,
        lastSyncAt: nowIso(),
        syncStatus: "completed",
      };
      return jsonResponse(route, { connection: state.squareConnection, job: { id: 1, jobType: "locations_sync", status: "completed", requestedAt: nowIso(), startedAt: nowIso(), completedAt: nowIso(), errorMessage: "", cursorJson: {} } });
    }

    if (path === "/api/integrations/square/catalog/sync" && method === "POST") {
      state.squareConnection = {
        ...(state.squareConnection ?? {}),
        catalogObjects: [
          {
            id: 1,
            squareObjectId: "ITEM-1",
            objectType: "ITEM",
            version: 1,
            isDeleted: false,
            rawPayload: { id: "ITEM-1" },
            mappings: [],
          },
        ],
        catalogCount: 1,
        lastSyncAt: nowIso(),
        syncStatus: "completed",
      };
      return jsonResponse(route, { connection: state.squareConnection, job: { id: 2, jobType: "catalog_sync", status: "completed", requestedAt: nowIso(), startedAt: nowIso(), completedAt: nowIso(), errorMessage: "", cursorJson: {} } });
    }

    if (path === "/api/integrations/square/orders/sync" && method === "POST") {
      state.squareConnection = {
        ...(state.squareConnection ?? {}),
        orders: [
          {
            id: 1,
            squareOrderId: "ORDER-1",
            squareLocationId: "S1",
            restaurantLocationId: 7,
            orderState: "COMPLETED",
            currency: "CAD",
            grossAmount: 100,
            discountAmount: 0,
            taxAmount: 13,
            tipAmount: 12,
            refundAmount: 0,
            netAmount: 125,
            itemQuantity: 2,
            lineCount: 1,
            orderedAt: nowIso(),
            closedAt: nowIso(),
            cancelledAt: null,
            refundedAt: null,
            isDeleted: false,
            rawPayload: { id: "ORDER-1" },
            lines: [
              {
                id: 1,
                lineUid: "line-1",
                lineIndex: 0,
                squareItemVariationId: "VAR-1",
                name: "Latte",
                quantity: 2,
                grossAmount: 100,
                discountAmount: 0,
                taxAmount: 13,
                tipAmount: 12,
                netAmount: 125,
                rawPayload: {},
              },
            ],
          },
        ],
        dailySales: [
          {
            id: 1,
            squareLocationId: "S1",
            restaurantLocationId: 7,
            saleDate: nowIso().slice(0, 10),
            currency: "CAD",
            grossAmount: 100,
            discountAmount: 0,
            taxAmount: 13,
            tipAmount: 12,
            refundAmount: 0,
            netAmount: 125,
            orderCount: 1,
            cancelledOrderCount: 0,
            rawPayload: {},
          },
        ],
        orderCount: 1,
        dailySalesCount: 1,
        lastSyncAt: nowIso(),
        syncStatus: "completed",
      };
      return jsonResponse(route, { connection: state.squareConnection, job: { id: 3, jobType: "orders_sync", status: "completed", requestedAt: nowIso(), startedAt: nowIso(), completedAt: nowIso(), errorMessage: "", cursorJson: {} } });
    }

    if (path === "/api/integrations/square/location-mappings" && method === "POST") {
      return jsonResponse(route, { connection: state.squareConnection });
    }

    if (path === "/api/integrations/square/catalog/mappings" && method === "POST") {
      const catalogObjectId = Number(body.squareCatalogObjectId ?? 0);
      const entityId = String(body.flowtallyEntityId ?? "");
      const mapping = {
        id: 1,
        squareCatalogObjectId: catalogObjectId,
        squareObjectId: "VAR-1",
        squareObjectType: "ITEM_VARIATION",
        squareObjectName: "Classic Cheeseburger - Regular",
        squareItemName: "Classic Cheeseburger",
        mappingType: "menu_item",
        flowtallyEntityType: "menu_item",
        flowtallyEntityId: entityId,
        status: "mapped",
        mappedByUserId: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.squareCatalogMappings = {
        connection: state.squareConnection,
        menuItems: [
          { id: 11, organizationId: 42, locationId: 7, recipeId: 21, name: "Classic Cheeseburger", normalizedName: "classic cheeseburger", category: "Burgers", sellingPrice: 18, active: true, notes: "", createdAt: nowIso(), updatedAt: nowIso() },
        ],
        mappings: [mapping],
        unmappedVariations: [],
        mappingCoverage: { mappedVariationCount: 1, totalVariationCount: 1, mappedPercent: 100 },
      };
      if (state.squareUsage) {
        state.squareUsage = {
          ...state.squareUsage,
          mappings: [mapping],
          unmappedVariations: [],
          mappingCoverage: { mappedVariationCount: 1, totalVariationCount: 1, mappedPercent: 100 },
          usage: {
            ...state.squareUsage.usage,
            mappingCoverage: { mappedVariationCount: 1, totalVariationCount: 1, mappedPercent: 100 },
            coverage: {
              ...state.squareUsage.usage.coverage,
              mappedVariationCount: 1,
              mappedSalesCoveragePercent: 100,
            },
          },
        };
      }
      return jsonResponse(route, { connection: state.squareConnection });
    }

    if (path === "/api/integrations/square/catalog/mappings" && method === "GET") {
      return jsonResponse(
        route,
        state.squareCatalogMappings ?? {
          connection: state.squareConnection,
          menuItems: [
            { id: 11, organizationId: 42, locationId: 7, recipeId: 21, name: "Classic Cheeseburger", normalizedName: "classic cheeseburger", category: "Burgers", sellingPrice: 18, active: true, notes: "", createdAt: nowIso(), updatedAt: nowIso() },
          ],
          mappings: [],
          unmappedVariations: [
            {
              id: 1,
              squareCatalogObjectId: 501,
              squareObjectId: "VAR-1",
              squareObjectType: "ITEM_VARIATION",
              squareObjectName: "Classic Cheeseburger - Regular",
              squareItemName: "Classic Cheeseburger",
              isDeleted: false,
              soldUnits: 10,
              suggestedMenuItemId: 11,
              suggestedMenuItemName: "Classic Cheeseburger",
              mapping: null,
            },
          ],
          mappingCoverage: { mappedVariationCount: 0, totalVariationCount: 1, mappedPercent: 0 },
        },
      );
    }

    if (path === "/api/integrations/square/catalog/mappings/1" && method === "DELETE") {
      if (state.squareCatalogMappings) {
        const removedMapping = state.squareCatalogMappings.mappings?.[0] ?? null;
        state.squareCatalogMappings = {
          ...state.squareCatalogMappings,
          mappings: [],
          unmappedVariations: removedMapping
            ? [
                {
                  id: removedMapping.squareCatalogObjectId,
                  squareCatalogObjectId: removedMapping.squareCatalogObjectId,
                  squareObjectId: removedMapping.squareObjectId,
                  squareObjectType: removedMapping.squareObjectType,
                  squareObjectName: removedMapping.squareObjectName,
                  squareItemName: removedMapping.squareItemName,
                  isDeleted: false,
                  soldUnits: 10,
                  suggestedMenuItemId: 11,
                  suggestedMenuItemName: "Classic Cheeseburger",
                  mapping: null,
                },
              ]
            : [],
          mappingCoverage: { mappedVariationCount: 0, totalVariationCount: 1, mappedPercent: 0 },
        };
      }
      if (state.squareUsage) {
        state.squareUsage = {
          ...state.squareUsage,
          mappings: [],
          unmappedVariations: state.squareUsage.unmappedVariations?.length ? state.squareUsage.unmappedVariations : state.squareUsage.mappings ?? [],
          mappingCoverage: { mappedVariationCount: 0, totalVariationCount: 1, mappedPercent: 0 },
          usage: {
            ...state.squareUsage.usage,
            coverage: {
              ...state.squareUsage.usage.coverage,
              mappedVariationCount: 0,
              mappedSalesCoveragePercent: 0,
            },
          },
        };
      }
      return jsonResponse(route, { connection: state.squareConnection });
    }

    if (path === "/api/integrations/square/usage" && method === "GET") {
      return jsonResponse(
        route,
        state.squareUsage ?? {
          connection: state.squareConnection,
          menuItems: [
            { id: 11, organizationId: 42, locationId: 7, recipeId: 21, name: "Classic Cheeseburger", normalizedName: "classic cheeseburger", category: "Burgers", sellingPrice: 18, active: true, notes: "", createdAt: nowIso(), updatedAt: nowIso() },
          ],
          mappings: [
            { id: 1, squareCatalogObjectId: 501, squareObjectId: "VAR-1", squareObjectType: "ITEM_VARIATION", squareObjectName: "Classic Cheeseburger - Regular", squareItemName: "Classic Cheeseburger", mappingType: "menu_item", flowtallyEntityType: "menu_item", flowtallyEntityId: "11", status: "mapped", mappedByUserId: 1, createdAt: nowIso(), updatedAt: nowIso() },
          ],
          unmappedVariations: [],
          mappingCoverage: { mappedVariationCount: 1, totalVariationCount: 1, mappedPercent: 100 },
          usage: {
            organizationId: 42,
            locationId: 7,
            period: { startAt: nowIso(), endAt: nowIso() },
            coverage: {
              totalSoldUnits: 10,
              mappedSoldUnits: 10,
              calculableSoldUnits: 10,
              excludedUnmappedUnits: 0,
              excludedIncompleteUnits: 0,
              excludedCancelledUnits: 0,
              mappedSalesCoveragePercent: 100,
              calculableSalesCoveragePercent: 100,
              mappedVariationCount: 1,
              unmappedVariationCount: 0,
            },
            ingredientUsage: [
              {
                inventoryItemId: 201,
                inventoryItemName: "Beef",
                unit: "kg",
                currentOnHand: 20,
                theoreticalUsage: 1.8,
                soldMenuUnits: 10,
                contributingMenuItems: [
                  { menuItemId: 11, menuItemName: "Classic Cheeseburger", soldUnits: 10, theoreticalUsage: 1.8, recipeId: 21, recipeYield: 1 },
                ],
                mappingStatus: "complete",
                actualUsage: 2.1,
                actualUsageBasis: {
                  available: true,
                  warnings: [],
                  openingQuantity: 21.6,
                  openingCountSessionId: 1,
                  openingCountCompletedAt: nowIso(),
                  closingQuantity: 19.5,
                  closingCountSessionId: 2,
                  closingCountCompletedAt: nowIso(),
                  movementNet: 0,
                  actualUsage: 2.1,
                },
                discrepancy: 0.3,
                discrepancyPercent: 16.7,
                warnings: [],
              },
            ],
            totals: { theoreticalUsage: 1.8, actualUsage: 2.1, discrepancy: 0.3, discrepancyPercent: 16.7 },
            contributingMenuItems: [
              { menuItemId: 11, menuItemName: "Classic Cheeseburger", soldUnits: 10, recipeYield: 1, recipeYieldUnit: "servings", warnings: [] },
            ],
            unmappedVariations: [],
            warnings: [],
          },
        },
      );
    }

    if (path === "/api/organizations/current" && method === "GET") {
      return jsonResponse(route, {
        organization: state.currentOrganization ?? makeOrganization(),
        restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
        currentLocation: { id: 7, name: "Main Dining Room" },
        membershipRole: "owner",
      });
    }

    throw new Error(`Unhandled API route: ${method} ${path}`);
  });
}

test("anonymous demo access stays open to the public demo", async ({ page }) => {
  await page.goto("/demo/cafe/purchases", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/demo\/cafe\/purchases/);
  await expect(page.locator("main")).toContainText("Purchases");
});

test("local browser journeys do not request Google Analytics", async ({ page }) => {
  const analyticsRequests: string[] = [];
  await page.route(/googletagmanager\.com|google-analytics\.com/i, async (route) => {
    analyticsRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto("/demo/cafe/purchases", { waitUntil: "domcontentloaded" });
  await page.goto("/auth/google/complete", { waitUntil: "domcontentloaded" });

  expect(analyticsRequests).toHaveLength(0);
});

test("google login buttons launch the API start endpoint from the configured API origin", async ({ page }) => {
  const expectedApiOrigin = (
    process.env.VITE_FLOWTALLY_API_BASE_URL ?? process.env.VITE_PILOT_API_BASE_URL ?? "http://127.0.0.1:4173"
  ).replace(/\/+$/, "");
  let requestUrl = "";

  await page.route("**/api/auth/google/start**", async (route) => {
    requestUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
  });

  const requestPromise = page.waitForRequest((request) => request.url().includes("/api/auth/google/start?purpose=login"));
  await page.goto("/auth/google/complete?status=error&message=Session%20expired.", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Try Google again" }).click();
  const request = await requestPromise;

  expect(request.url()).toBe(requestUrl);
  expect(new URL(request.url()).origin).toBe(expectedApiOrigin);
  expect(new URL(request.url()).pathname).toBe("/api/auth/google/start");
  expect(new URL(request.url()).searchParams.get("purpose")).toBe("login");
});

test("unauthenticated app visitors land on the commercial Google login page without seed credentials", async ({ page }) => {
  const expectedApiOrigin = (
    process.env.VITE_FLOWTALLY_API_BASE_URL ?? process.env.VITE_PILOT_API_BASE_URL ?? "http://127.0.0.1:4173"
  ).replace(/\/+$/, "");
  let requestUrl = "";

  await page.route("**/api/auth/google/start**", async (route) => {
    requestUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
  });

  const requestPromise = page.waitForRequest((request) => request.url().includes("/api/auth/google/start?purpose=login"));
  await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/login/);
  await expect(page.getByRole("heading", { name: "Sign in to Flowtally" })).toBeVisible();
  await expect(page.getByText("owner@flowtally.local")).not.toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const request = await requestPromise;

  expect(request.url()).toBe(requestUrl);
  expect(new URL(request.url()).origin).toBe(expectedApiOrigin);
  expect(new URL(request.url()).pathname).toBe("/api/auth/google/start");
  expect(new URL(request.url()).searchParams.get("purpose")).toBe("login");
});

test("active customer Google sign-in returns into the app dashboard", async ({ page }) => {
  const organization = makeOrganization({
    id: 5,
    name: "Starter Cafe",
    lifecycleStatus: "ACTIVE",
    setupStatus: "COMPLETE",
    subscriptionStatus: "ACTIVE",
    isProspect: false,
  });
  const state: MockState = {
    session: makeActiveOwnerSession({
      currentOrganizationId: organization.id,
      currentLocationId: 7,
      organizations: [{ organization, membershipRole: "owner", selected: true }],
    }),
    csrfToken: "csrf-token",
    currentOrganization: organization,
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/auth/google/complete", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByRole("heading", { name: "What the owner needs to know today" })).toBeVisible();
});

test("mocked Google registration walks a prospect into onboarding", async ({ page }) => {
  const state: MockState = {
    session: makeProspectSession(),
    csrfToken: "csrf-token",
    currentOrganization: null,
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/auth/google/complete", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Set up your first restaurant" })).toBeVisible();
  await page.getByLabel("Business name").fill("Demo Bistro");
  await page.getByLabel("Location name").fill("Main Dining Room");
  await page.getByRole("button", { name: "Create your workspace" }).click();
  await expect(page.getByText("Logged-in prospect", { exact: true })).toBeVisible();
  await expect(page.getByText("Welcome back, owner@example.com")).toBeVisible();
});

test("existing Google prospect sessions resume the workspace instead of recreating it", async ({ page }) => {
  const existingOrganization = makeOrganization({
    id: 77,
    name: "Prospect Cafe",
    lifecycleStatus: "ONBOARDING",
    setupStatus: "INTAKE",
    subscriptionStatus: "NONE",
    isProspect: true,
  });
  const state: MockState = {
    session: makeProspectSession({
      organizations: [
        {
          organization: existingOrganization,
          membershipRole: "owner",
          selected: false,
        },
      ],
    }),
    csrfToken: "csrf-token",
    currentOrganization: existingOrganization,
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/auth/google/complete", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Customer setup" })).toBeVisible();
  await expect(page.getByText("Logged-in prospect", { exact: true })).toBeVisible();
  await expect(page.getByText(/Prospect Cafe/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up your first restaurant" })).not.toBeVisible();
});

test("authenticated menu costing page loads live pricing data", async ({ page }) => {
  const organization = makeOrganization({
    id: 42,
    name: "Menu Costing Cafe",
  });
  const session = makeActiveOwnerSession({
    currentOrganizationId: organization.id,
    currentLocationId: 7,
    enabledModuleKeys: ["MENU_COSTING"],
    organizations: [{ organization, membershipRole: "owner", selected: true }],
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (path === "/api/auth/me" && method === "GET") {
      return jsonResponse(route, session);
    }
    if (path === "/api/auth/csrf" && method === "GET") {
      return jsonResponse(route, { csrfToken: "csrf-token" });
    }
    if (path === "/api/organizations/current" && method === "GET") {
      return jsonResponse(route, {
        organization,
        restaurantLocations: [{ id: 7, name: "Line Kitchen", city: "Toronto", region: "ON" }],
        currentLocation: { id: 7, name: "Line Kitchen" },
        membershipRole: "owner",
        enabledModuleKeys: ["MENU_COSTING"],
      });
    }
    if (path === "/api/pilot/inventory" && method === "GET") {
      return jsonResponse(route, {
        items: [
          {
            id: 101,
            organizationId: organization.id,
            locationId: 7,
            supplierId: null,
            name: "Cheese",
            normalizedName: "cheese",
            category: "Dairy",
            stockUnit: "each",
            currentOnHand: 0,
            minQuantity: 0,
            parLevel: 0,
            preferredSupplierName: "",
            latestPurchasePrice: 4,
            lastPurchaseUnit: "each",
            lastPurchaseConversionFactor: 2,
            lastReceivedAt: null,
            lastCountedAt: null,
            averageDailyUsage: null,
            estimatedCostMethod: "latest_purchase_price",
            active: true,
            notes: "",
            createdByUserId: null,
            updatedByUserId: null,
            createdAt: null,
            updatedAt: null,
          },
        ],
        movements: [],
        countSessions: [],
        reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: {},
      });
    }
    if (path === "/api/pilot/menu-costing" && method === "GET") {
      return jsonResponse(route, {
        organizationId: organization.id,
        locationId: 7,
        recipes: [
          {
            id: 1,
            organizationId: organization.id,
            locationId: 7,
            name: "Cheesy Toast",
            normalizedName: "cheesy toast",
            description: "Toasted bread with cheese",
            yieldQuantity: 2,
            yieldUnit: "servings",
            active: true,
            notes: "Pilot recipe",
            ingredientCount: 1,
            ingredients: [
              {
                id: 11,
                organizationId: organization.id,
                recipeId: 1,
                inventoryItemId: 101,
                quantityRequired: 2,
                unit: "each",
                notes: "Two portions of cheese",
                sortOrder: 1,
                inventoryItem: null,
                inventoryItemCostPerStockUnit: 2,
                lineCost: 4,
                warnings: [],
                createdAt: null,
                updatedAt: null,
              },
            ],
            totalCost: 4,
            costPerYield: 2,
            costAvailable: true,
            warnings: [],
            createdByUserId: null,
            updatedByUserId: null,
            createdAt: null,
            updatedAt: null,
          },
        ],
        menuItems: [
          {
            id: 21,
            organizationId: organization.id,
            locationId: 7,
            recipeId: 1,
            name: "Cheesy Toast",
            normalizedName: "cheesy toast",
            category: "Breakfast",
            sellingPrice: 12,
            active: true,
            notes: "Pilot menu item",
            recipe: null,
            recipeCostPerYield: 2,
            grossProfit: 10,
            foodCostPercent: 16.7,
            grossMarginPercent: 83.3,
            costAvailable: true,
            warnings: [],
            createdByUserId: null,
            updatedByUserId: null,
            createdAt: null,
            updatedAt: null,
          },
        ],
      });
    }

    throw new Error(`Unhandled API route: ${method} ${path}`);
  });

  await page.goto("/app/menu-costing", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Recipe and menu pricing")).toBeVisible();
  await expect(page.getByText("Cheesy Toast").first()).toBeVisible();
  await expect(page.getByText("Cost $2.00").first()).toBeVisible();
  await page.getByRole("tab", { name: "Menu items" }).click();
  await expect(page.getByText("Food cost 16.7%").first()).toBeVisible();
});

test("operational access is denied before activation", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession({ platformRole: "customer" }),
    csrfToken: "csrf-token",
    currentOrganization: null,
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/imports", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "You do not have access to this migration workspace" })).toBeVisible();
});

test("setup admin can configure the organization and activate it", async ({ page }) => {
  const state: MockState = {
    session: makeSetupAdminSession(),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization({
      lifecycleStatus: "READY_FOR_REVIEW",
      setupStatus: "CUSTOMER_REVIEW",
      subscriptionStatus: "SETUP_PAID",
      isProspect: true,
    }),
    invitations: [],
    auditEvents: [{ id: 1, organizationId: 42, locationId: null, actorUserId: 2, eventType: "platform.setup.loaded", entityType: "organization", entityId: 42, requestId: null, sourceIp: null, userAgent: null, metadata: { stage: "review" }, createdAt: nowIso() }],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/platform/setup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Internal setup console" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Demo Bistro" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "Save modules" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Modules saved" })).toBeVisible();
  await page.getByRole("button", { name: "Approve review" }).first().click();
  state.currentOrganization = {
    ...(state.currentOrganization ?? makeOrganization()),
    lifecycleStatus: "ACTIVE",
    setupStatus: "COMPLETE",
    subscriptionStatus: "ACTIVE",
  };
  await page.reload();
  await expect(page.getByRole("button", { name: "Activate organization" }).first()).toBeDisabled();
});

test("owner can invite a manager and see the invitation in the list", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession({
      enabledModuleKeys: ["SQUARE_INTEGRATION"],
    }),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/owner/team", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Invitation links" })).toBeVisible();
  await page.getByLabel("Invitee email").fill("manager@example.com");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("manager@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("migration preview and approval work for CSV and XLSX setup files", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession({
      supportAccessGrant: {
        id: 99,
        organizationId: 42,
        reason: "Investigate import file",
        caseReference: "CASE-1",
        status: "active",
        startsAt: nowIso(),
        expiresAt: nowIso(),
      },
    }),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [],
    supportGrants: [{ id: 1, organizationId: 42, organizationName: "Demo Bistro", supportUserId: 9, supportUserEmail: "support@example.com", requestedByUserId: 1, approvedByUserId: 1, reason: "Investigate import file", caseReference: "CASE-1", status: "active", startsAt: nowIso(), expiresAt: nowIso(), revokedAt: null, visibleInUi: true, createdAt: nowIso(), updatedAt: nowIso() }],
    squareConnection: null,
    importJobs: [createImportJob()],
    importJob: createImportJob(),
  };
  await installMockApi(page, state);

  await page.goto("/imports", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Upload a migration file" })).toBeVisible();
  await expect(page.getByText("Support access active")).toBeVisible();
  await page.getByRole("button", { name: "Suggest mappings" }).click();
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Execute" })).toBeEnabled();
});

test("Square Sandbox connection and synchronization are visible to the owner", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession({
      enabledModuleKeys: ["SQUARE_INTEGRATION"],
    }),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: {
      id: 1,
      organizationId: 42,
      organization: { id: 42, name: "Demo Bistro" },
      environment: "sandbox",
      squareMerchantId: "merchant-1",
      status: "connected",
      tokenExpiresAt: nowIso(),
      revokedAt: null,
      lastSyncAt: nowIso(),
      syncStatus: "idle",
      syncError: "",
      catalogCount: 0,
      orderCount: 0,
      locationCount: 0,
      dailySalesCount: 0,
      locations: [],
      catalogObjects: [],
      orders: [],
      dailySales: [],
      syncJobs: [],
      webhookEvents: [],
    },
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/integrations/square", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Square Sandbox" })).toBeVisible();
  await page.getByRole("button", { name: "Sync locations" }).click();
  await page.getByRole("button", { name: "Sync catalog" }).click();
  await page.getByRole("button", { name: "Sync orders" }).click();
  await expect(page.getByText("Connected and ready to sync locations, catalog objects, and orders.")).toBeVisible();
});

test("Square usage variance maps and clears variation links", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession({
      enabledModuleKeys: ["SQUARE_INTEGRATION"],
    }),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: {
      id: 1,
      organizationId: 42,
      organization: { id: 42, name: "Demo Bistro" },
      environment: "sandbox",
      squareMerchantId: "merchant-1",
      status: "connected",
      tokenExpiresAt: nowIso(),
      revokedAt: null,
      lastSyncAt: nowIso(),
      syncStatus: "idle",
      syncError: "",
      catalogCount: 0,
      orderCount: 0,
      locationCount: 0,
      dailySalesCount: 0,
      locations: [],
      catalogObjects: [],
      orders: [],
      dailySales: [],
      syncJobs: [],
      webhookEvents: [],
    },
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/app/square-usage", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Inventory usage and variance" })).toBeVisible();
  await expect(page.getByText("Classic Cheeseburger - Regular")).toBeVisible();
  await page.getByRole("button", { name: "Map" }).click();
  await expect(page.getByText("No unmapped Square variations found for the selected scope.")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("Classic Cheeseburger - Regular")).toBeVisible();
});

test("Square sync feeds the daily close and keeps the completed snapshot read-only", async ({ page }) => {
  const organization = makeOrganization({
    id: 42,
    name: "Pilot Bistro",
  });
  const state: MockState = {
    session: makeActiveOwnerSession({
      currentOrganizationId: organization.id,
      currentLocationId: 7,
      enabledModuleKeys: ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "SQUARE_INTEGRATION", "DAILY_CLOSE"],
      organizations: [{ organization, membershipRole: "owner", selected: true }],
    }),
    csrfToken: "csrf-token",
    currentOrganization: organization,
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: {
      id: 1,
      organizationId: organization.id,
      organization: { id: organization.id, name: organization.name },
      environment: "sandbox",
      squareMerchantId: "merchant-42",
      status: "connected",
      tokenExpiresAt: nowIso(),
      revokedAt: null,
      lastSyncAt: nowIso(),
      syncStatus: "idle",
      syncError: "",
      catalogCount: 1,
      orderCount: 0,
      locationCount: 1,
      dailySalesCount: 0,
      locations: [
        {
          id: 1,
          squareLocationId: "SQ-1",
          name: "Main Dining Room",
          status: "active",
          rawPayload: { id: "SQ-1" },
          mappings: [
            {
              id: 1,
              squareLocationId: 1,
              restaurantLocationId: 7,
              restaurantLocation: { id: 7, name: "Main Dining Room" },
              mappedByUserId: 1,
              mappedAt: nowIso(),
            },
          ],
        },
      ],
      catalogObjects: [
        {
          id: 1,
          squareObjectId: "ITEM-1",
          objectType: "ITEM_VARIATION",
          version: 1,
          isDeleted: false,
          rawPayload: { id: "ITEM-1" },
          mappings: [
            {
              id: 1,
              flowtallyEntityType: "menu_item",
              flowtallyEntityId: "21",
              status: "mapped",
            },
          ],
        },
      ],
      orders: [],
      dailySales: [],
      syncJobs: [],
      webhookEvents: [],
    },
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);
  await page.route("**/api/pilot/menu-costing", async (route) => {
    const organization = state.currentOrganization ?? makeOrganization();
    await jsonResponse(route, {
      organizationId: organization.id,
      locationId: 7,
      recipes: [
        {
          id: 1,
          organizationId: organization.id,
          locationId: 7,
          name: "Cheesy Toast",
          normalizedName: "cheesy toast",
          description: "Toasted bread with cheese",
          yieldQuantity: 2,
          yieldUnit: "servings",
          active: true,
          notes: "Pilot recipe",
          ingredientCount: 1,
          ingredients: [
            {
              id: 11,
              organizationId: organization.id,
              recipeId: 1,
              inventoryItemId: 101,
              quantityRequired: 2,
              unit: "each",
              notes: "Two portions of cheese",
              sortOrder: 1,
              inventoryItem: null,
              inventoryItemCostPerStockUnit: 2,
              lineCost: 4,
              warnings: [],
              createdAt: null,
              updatedAt: null,
            },
          ],
          totalCost: 4,
          costPerYield: 2,
          costAvailable: true,
          warnings: [],
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      menuItems: [
        {
          id: 21,
          organizationId: organization.id,
          locationId: 7,
          recipeId: 1,
          name: "Cheesy Toast",
          normalizedName: "cheesy toast",
          category: "Breakfast",
          sellingPrice: 12,
          active: true,
          notes: "Pilot menu item",
          recipe: null,
          recipeCostPerYield: 2,
          grossProfit: 10,
          foodCostPercent: 16.7,
          grossMarginPercent: 83.3,
          costAvailable: true,
          warnings: [],
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
    });
  });

  const businessDate = new Date().toLocaleDateString("en-CA");
  const location = { id: 7, name: "Main Dining Room", timezone: "America/Toronto" };
  const baseUsage: DailyCloseUsageFixture = {
    period: { startAt: "2026-08-29T00:00:00Z", endAt: "2026-08-30T00:00:00Z" },
    coverage: {},
    totals: { theoreticalUsage: 18, actualUsage: null, discrepancy: null, discrepancyPercent: null },
    contributingMenuItems: [],
    unmappedVariations: [],
    ingredientUsage: [],
  };
  const baseSnapshot: DailyCloseSnapshotFixture = {
    healthStatus: "Open",
    inventoryValue: 1250,
    sales: { netSales: 340, orders: 12, refunds: 0, cancelledOrders: 0 },
    usage: baseUsage,
    variance: { quantity: null, percent: null, value: 0 },
    square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    readyToFinalize: true,
  };
  const syncedUsage: DailyCloseUsageFixture = {
    ...baseUsage,
    totals: { theoreticalUsage: 18, actualUsage: 17, discrepancy: 1, discrepancyPercent: 5.6 },
  };
  const syncedSnapshot: DailyCloseSnapshotFixture = {
    healthStatus: "Ready with warnings",
    inventoryValue: 1250,
    sales: { netSales: 375, orders: 13, refunds: 0, cancelledOrders: 0 },
    usage: syncedUsage,
    variance: { quantity: 1, percent: 5.6, value: 4.2 },
    square: { squareStatus: "Connected", squareSynced: true, locationMapped: true },
    readyToFinalize: true,
  };
  let activeSession:
    | null
    | {
        id: number;
        organizationId: number;
        locationId: number;
        businessDate: string;
        status: string;
        summarySnapshot: Record<string, unknown>;
        usageSnapshot: Record<string, unknown>;
        exceptionsSnapshot: string[];
        notes: string;
        completedAt: string | null;
        completedByUserId: number | null;
        createdByUserId: number | null;
        createdAt: string | null;
        updatedAt: string | null;
        currentSnapshot?: DailyCloseSnapshotFixture;
      } = null;
  const buildResponse = () => ({
    session: activeSession,
    snapshot: activeSession?.currentSnapshot ?? baseSnapshot,
    usage: activeSession?.currentSnapshot?.usage ?? baseUsage,
    exceptions: activeSession ? (activeSession.currentSnapshot?.healthStatus === "Ready with warnings" ? ["Square sales synced before finalize."] : []) : [],
    history: activeSession?.status === "COMPLETED" ? [activeSession] : [],
    location,
    businessDate: activeSession?.businessDate ?? businessDate,
    square: baseSnapshot.square,
  });

  await page.route("**/api/pilot/daily-close**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === "GET" && path === "/api/pilot/daily-close") {
      const requestedBusinessDate = url.searchParams.get("businessDate") ?? businessDate;
      if (activeSession && activeSession.businessDate === requestedBusinessDate) {
        await jsonResponse(route, buildResponse());
        return;
      }
      await jsonResponse(route, {
        session: null,
        snapshot: baseSnapshot,
        usage: baseUsage,
        exceptions: [],
        history: [],
        location,
        businessDate,
        square: baseSnapshot.square,
      });
      return;
    }

    if (request.method() === "POST" && path === "/api/pilot/daily-close") {
      activeSession = {
        id: 9,
        organizationId: organization.id,
        locationId: location.id,
        businessDate,
        status: "DRAFT",
        summarySnapshot: {},
        usageSnapshot: {},
        exceptionsSnapshot: [],
        notes: "",
        completedAt: null,
        completedByUserId: null,
        createdByUserId: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        currentSnapshot: baseSnapshot,
      };
      await jsonResponse(route, buildResponse());
      return;
    }

    if (request.method() === "POST" && /\/api\/pilot\/daily-close\/\d+\/sync-sales$/.test(path)) {
      activeSession = {
        ...(activeSession ?? {
          id: 9,
          organizationId: organization.id,
          locationId: location.id,
          businessDate,
          status: "DRAFT",
          summarySnapshot: {},
          usageSnapshot: {},
          exceptionsSnapshot: [],
          notes: "",
          completedAt: null,
          completedByUserId: null,
          createdByUserId: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }),
        currentSnapshot: syncedSnapshot,
      };
      await jsonResponse(route, buildResponse());
      return;
    }

    if (request.method() === "PATCH" && /\/api\/pilot\/daily-close\/\d+$/.test(path)) {
      const body = request.postDataJSON() as { notes?: string } | undefined;
      activeSession = {
        ...(activeSession ?? {
          id: 9,
          organizationId: organization.id,
          locationId: location.id,
          businessDate,
          status: "DRAFT",
          summarySnapshot: {},
          usageSnapshot: {},
          exceptionsSnapshot: [],
          notes: "",
          completedAt: null,
          completedByUserId: null,
          createdByUserId: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          currentSnapshot: baseSnapshot,
        }),
        notes: body?.notes ?? activeSession?.notes ?? "",
        updatedAt: nowIso(),
      };
      await jsonResponse(route, buildResponse());
      return;
    }

    if (request.method() === "POST" && /\/api\/pilot\/daily-close\/\d+\/finalize$/.test(path)) {
      activeSession = {
        ...(activeSession ?? {
          id: 9,
          organizationId: organization.id,
          locationId: location.id,
          businessDate,
          status: "DRAFT",
          summarySnapshot: {},
          usageSnapshot: {},
          exceptionsSnapshot: [],
          notes: "",
          completedAt: null,
          completedByUserId: null,
          createdByUserId: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          currentSnapshot: syncedSnapshot,
        }),
        status: "COMPLETED",
        completedAt: nowIso(),
        completedByUserId: 1,
        currentSnapshot: syncedSnapshot,
        updatedAt: nowIso(),
      };
      await jsonResponse(route, buildResponse());
      return;
    }

    await route.continue();
  });

  await page.goto("/app/square", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Private workspace for Square connection, sync, and mapping" })).toBeVisible();
  await expect(page.getByText("merchant-42")).toBeVisible();
  await expect(page.getByText("Main Dining Room").first()).toBeVisible();
  await expect(page.getByText("Classic Cheeseburger - Regular")).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Sync now completed.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usage variance" })).toBeVisible();
  await expect(page.getByText("Daily sales summaries").first()).toBeVisible();

  await page.goto("/app/daily-close", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Close the day with a clear snapshot" })).toBeVisible();
  await page.getByLabel("Business date").fill(new Date().toLocaleDateString("en-CA"));
  await page.getByRole("button", { name: "Start daily close" }).click();
  await expect(page.getByRole("heading", { name: "Active daily close" })).toBeVisible();
  await page.getByRole("button", { name: "Sync sales" }).click();
  await expect(page.getByText("Synced Square sales for")).toBeVisible();
  await expect(page.getByText("Theoretical usage").first()).toBeVisible();
  await expect(page.getByText("Actual usage").first()).toBeVisible();
  await expect(page.getByText("Exceptions to review", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Add context for unusual sales, waste, or count discrepancies.").fill("Square sales synced before finalize.");
  await page.getByRole("button", { name: "Save notes" }).click();
  await page.getByRole("button", { name: "Finalize daily close" }).click();
  await expect(page.getByRole("heading", { name: "Completed daily close" })).toBeVisible();
  await expect(page.getByText("Read only").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync sales" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save notes" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Finalize daily close" })).toBeDisabled();

  await page.getByRole("button", { name: /^Open / }).first().click();
  await expect(page.getByRole("heading", { name: "Completed daily close" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Add context for unusual sales, waste, or count discrepancies." })).toHaveValue("Square sales synced before finalize.");
  await expect(page.getByText("Read only").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize daily close" })).toBeDisabled();
});

test("owner audit history shows filtered organization activity", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession(),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [
      { id: 1, organizationId: 42, locationId: 7, actorUserId: 1, eventType: "invitation.created", entityType: "organization_invitation", entityId: 11, requestId: null, sourceIp: null, userAgent: null, metadata: { email: "manager@example.com" }, createdAt: nowIso() },
      { id: 2, organizationId: 42, locationId: null, actorUserId: 1, eventType: "square.connection.updated", entityType: "square_connection", entityId: 1, requestId: null, sourceIp: null, userAgent: null, metadata: { syncStatus: "completed" }, createdAt: nowIso() },
    ],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/owner/audit", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Owner audit history" })).toBeVisible();
  await expect(page.getByText("invitation.created")).toBeVisible();
  await page.getByPlaceholder("Search event type, entity or metadata").fill("square");
  await expect(page.getByText("square.connection.updated")).toBeVisible();
});

test("owner reports and exports surface authenticated reporting data", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession(),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [
      { id: 1, organizationId: 42, locationId: 7, actorUserId: 1, eventType: "invoice.completed", entityType: "purchase_invoice", entityId: 101, requestId: null, sourceIp: null, userAgent: null, metadata: { totalAmount: 113 }, createdAt: nowIso() },
    ],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  await installMockApi(page, state);

  await page.goto("/owner/reports", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Reports & exports" })).toBeVisible();
  await expect(page.getByText("Demo Bistro", { exact: true })).toBeVisible();
  await expect(page.getByText("Weekly invoice spend")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download purchase CSV" })).toBeVisible();
  await expect(page.getByText("Dairy Co leads spending this period.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download summary CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("flowtally-owner-report-demo-bistro.csv");
  expect(await download.path()).not.toBeNull();
});

test("empty purchases workspace supports supplier, inventory item, and first receipt setup", async ({ page }) => {
  const organization = makeOrganization({ id: 5, name: "Starter Cafe" });
  const state: MockState = {
    session: makeActiveOwnerSession({
      currentOrganizationId: organization.id,
      currentLocationId: 9,
      organizations: [{ organization, membershipRole: "owner", selected: true }],
    }),
    csrfToken: "csrf-token",
    currentOrganization: organization,
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
  };
  const purchaseFlow = makeEmptyPurchaseFlowState();
  purchaseFlow.suppliers.push({
    id: 20,
    name: "North Bay Dairy",
    categoryFocus: "Dairy",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    orderingNotes: "",
    notes: "",
    isActive: true,
  });
  purchaseFlow.inventoryItems.push(
    { id: 30, name: "2% Milk", stockUnit: "case" },
    { id: 31, name: "Whole Milk", stockUnit: "bag" },
  );
  enableEmptyPurchaseWorkflow(state, purchaseFlow);
  await installMockApi(page, state);

  await page.goto("/app/purchases", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Capture invoices, confirm items, and move stock" })).toBeVisible();

  const editorCard = page.getByTestId("purchase-editor-card");
  const historyCard = page.getByTestId("purchase-history-card");
  await expect(editorCard).toBeVisible();
  await expect(historyCard).toBeVisible();
  await expect(editorCard.getByRole("heading", { name: "New purchase" })).toBeVisible();
  await expect(historyCard.getByRole("heading", { name: "Review queue and purchase history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review queue and purchase history" })).toHaveCount(1);
  await expect(editorCard.getByText("Supplier", { exact: true })).toBeVisible();
  await expect(editorCard.getByLabel("Invoice number")).toHaveCount(1);
  await expect(historyCard.getByLabel("Supplier")).toHaveCount(0);
  await expect(historyCard.getByLabel("Invoice number")).toHaveCount(0);
  const editorBox = await editorCard.boundingBox();
  const historyBox = await historyCard.boundingBox();
  const mainBox = await page.locator("main").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(editorBox!.width).toBeGreaterThan(historyBox!.width);
  expect(editorBox!.x).toBeLessThan(historyBox!.x);
  expect(Math.abs(historyBox!.y - editorBox!.y)).toBeLessThan(32);

  const editorHeading = page.getByRole("heading", { name: "New purchase" });
  await page.getByRole("button", { name: "New purchase" }).click();
  await expect(editorHeading).toBeInViewport();
  await expect(editorCard.getByRole("heading", { name: "New purchase" })).toBeVisible();
  await expect(editorCard.getByLabel("Supplier")).toBeVisible();
  await expect(editorCard.getByLabel("Invoice number")).toBeVisible();
  await page.getByLabel("Supplier").selectOption("North Bay Dairy");
  await expect(page.getByLabel("Supplier")).toHaveValue("North Bay Dairy");
  await page.getByRole("tab", { name: "Invoice items" }).click();
  await expect(page.getByTestId("purchase-lines-panel")).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveCount(1);

  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByLabel("Description")).toHaveCount(2);

  const descriptions = page.getByLabel("Description");
  const inventoryItems = page.getByLabel("Inventory item");
  await descriptions.nth(0).fill("2% Milk");
  await descriptions.nth(1).fill("Whole Milk");
  await inventoryItems.nth(0).selectOption("30");
  await inventoryItems.nth(1).selectOption("31");
  await expect(inventoryItems.nth(0)).toHaveValue("30");
  await expect(inventoryItems.nth(1)).toHaveValue("31");
  await page.locator('label:has-text("Purchase unit") input').nth(0).fill("case");
  await page.locator('label:has-text("Purchase unit") input').nth(1).fill("case");
  await page.locator('label:has-text("Inventory unit") input').nth(0).fill("bag");
  await page.locator('label:has-text("Inventory unit") input').nth(1).fill("bag");
  await page.locator('label:has-text("Conversion") input').nth(0).fill("1");
  await page.locator('label:has-text("Conversion") input').nth(1).fill("1");
  await page.locator('label:has-text("Qty / price / total") input').nth(0).fill("2");
  await page.locator('label:has-text("Qty / price / total") input').nth(1).fill("4.50");
  await page.locator('label:has-text("Qty / price / total") input').nth(3).fill("1");
  await page.locator('label:has-text("Qty / price / total") input').nth(4).fill("5.25");

  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByLabel("Description")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove" }).nth(2).click();
  await expect(page.getByLabel("Description")).toHaveCount(2);
  await expect(inventoryItems.nth(0)).toHaveValue("30");
  await expect(inventoryItems.nth(1)).toHaveValue("31");

  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByTestId("purchase-review-panel")).toBeVisible();
  await page.getByRole("button", { name: "Save ready" }).click();
  await expect(page.getByText(/Invoice .*saved successfully\./)).toBeVisible();
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByTestId("purchase-review-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Receive into inventory" })).toBeEnabled({ timeout: 10000 });

  await page.getByRole("button", { name: "Receive into inventory" }).click();
  await expect(page.getByText(/Invoice .*received into inventory\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: "New purchase" })).toBeVisible();
  await expect(page.getByTestId("purchase-details-panel")).toBeVisible();
});
