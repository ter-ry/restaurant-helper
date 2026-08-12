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
  importJobs: any[];
  importJob: any | null;
  menuState?: any;
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

    if (path === "/api/onboarding/organizations" && method === "POST") {
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

    if (path === "/api/organizations/current" && method === "GET") {
      if (!state.currentOrganization) {
        return jsonResponse(route, { error: "Organization not found." }, 404);
      }
      return jsonResponse(route, {
        organization: state.currentOrganization,
        restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
        currentLocation: { id: 7, name: "Main Dining Room" },
        membershipRole: "owner",
      });
    }

    if (path === "/api/organizations" && method === "GET") {
      const organization = state.currentOrganization ?? makeOrganization();
      const selected = state.session?.currentOrganizationId ?? organization.id;
      return jsonResponse(route, {
        organizations: [
          {
            organization,
            membershipRole: "owner",
            selected: selected === organization.id,
          },
        ],
        currentOrganizationId: selected,
        currentMembershipId: 1,
      });
    }

    if (path === "/api/organizations/select" && method === "POST") {
      const organizationId = Number(body.organizationId ?? state.currentOrganization?.id ?? 42);
      const organization = state.currentOrganization ?? makeOrganization({ id: organizationId });
      state.currentOrganization = { ...organization, id: organizationId };
      if (state.session) {
        state.session = {
          ...state.session,
          currentOrganizationId: organizationId,
          organizations: [{ organization: state.currentOrganization, membershipRole: "owner", selected: true }],
        };
      }
      return jsonResponse(route, {
        organization: state.currentOrganization,
        restaurantLocations: [{ id: 7, name: "Main Dining Room", city: "Toronto", region: "ON" }],
        currentLocation: { id: 7, name: "Main Dining Room" },
        membershipRole: "owner",
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
      return jsonResponse(route, { connection: state.squareConnection });
    }

    if (state.menuState) {
      if (path === "/api/pilot/inventory" && method === "GET") {
        return jsonResponse(route, {
          items: state.menuState.inventory,
          summary: { inventoryItemCount: state.menuState.inventory.length },
          reorderPlan: { suggestions: [] },
        });
      }

      if (path === "/api/pilot/menu-costing" && method === "GET") {
        return jsonResponse(route, state.menuState.snapshot);
      }

      if (path === "/api/pilot/menu-items" && method === "POST") {
        const body = (() => {
          const raw = route.request().postData();
          if (!raw) return {};
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })();
        const nextId = state.menuState.nextId++;
        const item = {
          id: nextId,
          organizationId: state.menuState.organizationId,
          locationId: state.menuState.locationId,
          name: String(body.name ?? "Menu item"),
          normalizedName: String(body.name ?? "Menu item").toLowerCase(),
          category: String(body.category ?? "Other"),
          sellingPrice: Number(body.sellingPrice ?? 0),
          active: Boolean(body.active ?? true),
          notes: String(body.notes ?? ""),
          recipe: {
            id: nextId + 1000,
            organizationId: state.menuState.organizationId,
            locationId: state.menuState.locationId,
            menuItemId: nextId,
            notes: "",
            lineCount: Array.isArray(body.recipeLines) ? body.recipeLines.length : 0,
            lines: Array.isArray(body.recipeLines)
              ? body.recipeLines.map((line: any, index: number) => ({
                  id: nextId + 2000 + index,
                  organizationId: state.menuState.organizationId,
                  locationId: state.menuState.locationId,
                  recipeId: nextId + 1000,
                  inventoryItemId: line.inventoryItemId ?? null,
                  inventoryItemName: String(line.ingredientName ?? ""),
                  lineIndex: index,
                  ingredientName: String(line.ingredientName ?? ""),
                  quantity: Number(line.quantity ?? 0),
                  unit: String(line.unit ?? "each"),
                  inventoryUnit: String(line.inventoryUnit ?? "each"),
                  purchaseUnit: String(line.purchaseUnit ?? "each"),
                  conversionFactor: Number(line.conversionFactor ?? 1),
                  unitCost: null,
                  lineCost: null,
                  notes: String(line.notes ?? ""),
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
                }))
              : [],
            createdAt: nowIso(),
            updatedAt: nowIso(),
          },
          salesUnits: 0,
          salesNetAmount: 0,
          recipeCost: Array.isArray(body.recipeLines) && body.recipeLines.length ? 0 : null,
          grossProfit: Array.isArray(body.recipeLines) && body.recipeLines.length ? Number(body.sellingPrice ?? 0) : null,
          marginPercent: null,
          foodCostPercent: null,
          costingComplete: Array.isArray(body.recipeLines) && body.recipeLines.length > 0,
          usageComplete: Array.isArray(body.recipeLines) && body.recipeLines.length > 0,
          mappingStatus: "Unmapped",
          squareCatalogObjectId: null,
          dataIssues: Array.isArray(body.recipeLines) && body.recipeLines.length ? [] : ["Recipe missing", "Untracked ingredients", "Incomplete costing"],
          createdByUserId: state.session?.user.id ?? null,
          updatedByUserId: state.session?.user.id ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        state.menuState.items.push(item);
        state.menuState.snapshot = { ...state.menuState.snapshot, menuItems: state.menuState.items, summary: { ...state.menuState.snapshot.summary, menuItemCount: state.menuState.items.length } };
        return jsonResponse(route, state.menuState.snapshot, 201);
      }

      if (path.startsWith("/api/pilot/menu-items/") && (method === "PATCH" || method === "DELETE")) {
        const itemId = Number(path.split("/").pop());
        const item = state.menuState.items.find((entry: any) => entry.id === itemId) ?? null;
        if (!item) {
          return jsonResponse(route, { error: "Menu item not found." }, 404);
        }
        const body = (() => {
          const raw = route.request().postData();
          if (!raw) return {};
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })();
        if (method === "PATCH") {
          item.name = String(body.name ?? item.name);
          item.normalizedName = item.name.toLowerCase();
          item.category = String(body.category ?? item.category);
          item.sellingPrice = Number(body.sellingPrice ?? item.sellingPrice);
          item.active = Boolean(body.active ?? item.active);
          item.notes = String(body.notes ?? item.notes);
        } else {
          item.active = false;
        }
        item.updatedAt = nowIso();
        state.menuState.snapshot = { ...state.menuState.snapshot, menuItems: state.menuState.items };
        return jsonResponse(route, state.menuState.snapshot);
      }
    }

    throw new Error(`Unhandled API route: ${method} ${path}`);
  });
}

test("anonymous demo access stays open to the public demo", async ({ page }) => {
  await page.goto("/demo/cafe/purchases");
  await expect(page).toHaveURL(/\/demo\/cafe\/purchases/);
  await expect(page.locator("main")).toContainText("Purchases");
});

test("local browser journeys do not request Google Analytics", async ({ page }) => {
  const analyticsRequests: string[] = [];
  await page.route(/googletagmanager\.com|google-analytics\.com/i, async (route) => {
    analyticsRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto("/demo/cafe/purchases");
  await page.goto("/auth/google/complete");

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
  await page.goto("/auth/google/complete?status=error&message=Session%20expired.");
  await page.getByRole("button", { name: "Try Google again" }).click();
  const request = await requestPromise;

  expect(request.url()).toBe(requestUrl);
  expect(new URL(request.url()).origin).toBe(expectedApiOrigin);
  expect(new URL(request.url()).pathname).toBe("/api/auth/google/start");
  expect(new URL(request.url()).searchParams.get("purpose")).toBe("login");
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

  await page.goto("/auth/google/complete");
  await expect(page.getByRole("heading", { name: "Set up your first restaurant" })).toBeVisible();
  await page.getByLabel("Business name").fill("Demo Bistro");
  await page.getByLabel("Location name").fill("Main Dining Room");
  await page.getByRole("button", { name: "Create your workspace" }).click();
  await expect(page.getByText("Logged-in prospect")).toBeVisible();
  await expect(page.getByText("Welcome back, owner@example.com")).toBeVisible();
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

  await page.goto("/imports");
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

  await page.goto("/platform/setup");
  await expect(page.getByRole("heading", { level: 1, name: "Internal setup console" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Demo Bistro" })).toBeVisible();
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
    session: makeActiveOwnerSession(),
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

  await page.goto("/owner/team");
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

  await page.goto("/imports");
  await expect(page.getByRole("heading", { name: "Upload a migration file" })).toBeVisible();
  await expect(page.getByText("Support access active")).toBeVisible();
  await page.getByRole("button", { name: "Suggest mappings" }).click();
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Execute" })).toBeEnabled();
});

test("Square Sandbox connection and synchronization are visible to the owner", async ({ page }) => {
  const state: MockState = {
    session: makeActiveOwnerSession(),
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

  await page.goto("/integrations/square");
  await expect(page.getByRole("heading", { level: 1, name: "Square Sandbox" })).toBeVisible();
  await page.getByRole("button", { name: "Sync locations" }).click();
  await page.getByRole("button", { name: "Sync catalog" }).click();
  await page.getByRole("button", { name: "Sync orders" }).click();
  await expect(page.getByText("Connected and ready to sync locations, catalog objects, and orders.")).toBeVisible();
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

  await page.goto("/owner/audit");
  await expect(page.getByRole("heading", { name: "Owner audit history" })).toBeVisible();
  await expect(page.getByText("invitation.created")).toBeVisible();
  await page.getByPlaceholder("Search event type, entity or metadata").fill("square");
  await expect(page.getByText("square.connection.updated")).toBeVisible();
});

test("menu costing browser journey can create edit deactivate and refetch a persisted menu item", async ({ page }) => {
  const burgerMenuItem = {
    id: 501,
    organizationId: 42,
    locationId: 7,
    name: "Burger",
    normalizedName: "burger",
    category: "Burgers",
    sellingPrice: 15,
    active: true,
    notes: "",
    recipe: {
      id: 601,
      organizationId: 42,
      locationId: 7,
      menuItemId: 501,
      notes: "",
      lineCount: 3,
      lines: [
        {
          id: 701,
          organizationId: 42,
          locationId: 7,
          recipeId: 601,
          inventoryItemId: 1,
          inventoryItemName: "Burger Beef",
          lineIndex: 0,
          ingredientName: "Burger Beef",
          quantity: 180,
          unit: "g",
          inventoryUnit: "kg",
          purchaseUnit: "kg",
          conversionFactor: 1,
          unitCost: 11.11,
          lineCost: 2,
          notes: "",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        {
          id: 702,
          organizationId: 42,
          locationId: 7,
          recipeId: 601,
          inventoryItemId: 2,
          inventoryItemName: "Burger Bun",
          lineIndex: 1,
          ingredientName: "Burger Bun",
          quantity: 1,
          unit: "each",
          inventoryUnit: "each",
          purchaseUnit: "each",
          conversionFactor: 1,
          unitCost: 0.5,
          lineCost: 0.5,
          notes: "",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        {
          id: 703,
          organizationId: 42,
          locationId: 7,
          recipeId: 601,
          inventoryItemId: 3,
          inventoryItemName: "Burger Sauce",
          lineIndex: 2,
          ingredientName: "Burger Sauce",
          quantity: 1,
          unit: "each",
          inventoryUnit: "each",
          purchaseUnit: "each",
          conversionFactor: 1,
          unitCost: 0.25,
          lineCost: 0.25,
          notes: "",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    salesUnits: 10,
    salesNetAmount: 150,
    recipeCost: 2.75,
    grossProfit: 12.25,
    marginPercent: 81.7,
    foodCostPercent: 18.3,
    costingComplete: true,
    usageComplete: true,
    mappingStatus: "Mapped",
    squareCatalogObjectId: 9001,
    dataIssues: [],
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const plainCoffee = {
    id: 502,
    organizationId: 42,
    locationId: 7,
    name: "Plain Coffee",
    normalizedName: "plain coffee",
    category: "Drinks",
    sellingPrice: 3,
    active: true,
    notes: "",
    recipe: null,
    salesUnits: 0,
    salesNetAmount: 0,
    recipeCost: null,
    grossProfit: null,
    marginPercent: null,
    foodCostPercent: null,
    costingComplete: false,
    usageComplete: false,
    mappingStatus: "Unmapped",
    squareCatalogObjectId: null,
    dataIssues: ["Recipe missing", "Untracked ingredients", "Incomplete costing"],
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const menuState = {
    organizationId: 42,
    locationId: 7,
    nextId: 600,
    inventory: [
      { id: 1, name: "Burger Beef", stockUnit: "kg" },
      { id: 2, name: "Burger Bun", stockUnit: "each" },
      { id: 3, name: "Burger Sauce", stockUnit: "each" },
    ],
    items: [burgerMenuItem, plainCoffee],
    snapshot: null as any,
  };

  const rebuildSnapshot = () => {
    menuState.snapshot = {
      summary: {
        menuItemCount: menuState.items.length,
        recipeCount: menuState.items.filter((item: any) => item.recipe?.lineCount).length,
        mappedMenuItemCount: menuState.items.filter((item: any) => item.mappingStatus === "Mapped").length,
        salesUnits: 10,
        salesNetAmount: 150,
        recipeCost: 2.75,
        grossProfit: 12.25,
        inventoryVarianceCount: 1,
        estimatedCostVariance: -2.3,
        receivedPurchasesCount: 1,
        incompleteCostingCount: menuState.items.filter((item: any) => !item.costingComplete).length,
        incompleteUsageCount: menuState.items.filter((item: any) => !item.usageComplete).length,
        unmappedSalesCount: 1,
        openingCountSessionId: 11,
        latestCountSessionId: 12,
      },
      menuItems: menuState.items,
      inventoryUsage: [
        {
          inventoryItemId: 1,
          inventoryItemName: "Burger Beef",
          stockUnit: "kg",
          referenceInventory: 10,
          referenceInventorySessionId: 11,
          referenceInventoryCompletedAt: nowIso(),
          receivedPurchases: 0,
          theoreticalUsage: 1.8,
          expectedInventory: 8.2,
          actualStockCount: 5.5,
          variance: -2.7,
          estimatedCostVariance: -29.99,
          latestCountSessionId: 12,
          latestCountCompletedAt: nowIso(),
          calculationComplete: true,
        },
      ],
      unmappedSales: [
        {
          squareOrderId: "ORDER-UNMAPPED-1",
          squareItemVariationId: "VAR-FRIES",
          name: "Fries",
          quantity: 1,
          netAmount: 5,
        },
      ],
      openingCountSession: {
        id: 11,
        organizationId: 42,
        locationId: 7,
        status: "Completed",
        countedBy: "Opening cashier",
        itemCount: 3,
        varianceTotal: 0,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      },
      latestCountSession: {
        id: 12,
        organizationId: 42,
        locationId: 7,
        status: "Completed",
        countedBy: "Closing cashier",
        itemCount: 3,
        varianceTotal: -2.7,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      },
      salesStartDate: "2026-07-13",
      salesEndDate: "2026-08-12",
    };
  };

  rebuildSnapshot();

  const state: MockState = {
    session: makeActiveOwnerSession(),
    csrfToken: "csrf-token",
    currentOrganization: makeOrganization(),
    invitations: [],
    auditEvents: [],
    supportGrants: [],
    squareConnection: null,
    importJobs: [],
    importJob: null,
    menuState,
  };
  await installMockApi(page, state);

  await page.goto("/app/menu-costing");
  await expect(page.getByRole("heading", { name: "Sales, recipes, usage, and stock variance." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Burger" })).toBeVisible();
  await expect(page.getByText("1.8 kg")).toBeVisible();
  await expect(page.getByText("Unmapped Square sales")).toBeVisible();
  await expect(page.getByText("Fries").first()).toBeVisible();

  await page.getByRole("button", { name: "New menu item" }).click();
  await page.getByLabel("Menu item name").fill("Pesto Pasta");
  await page.getByLabel("Category").fill("Pasta");
  await page.getByLabel("Selling price").fill("17");
  await page.getByLabel("Ingredient name").fill("Burger Beef");
  await page.getByLabel("Inventory item").selectOption({ label: "Burger Beef - kg" });
  await page.getByLabel("Quantity").fill("180");
  await page.getByRole("textbox", { name: "Unit", exact: true }).fill("g");
  await page.getByRole("button", { name: "Save menu item" }).click();
  await expect(page.getByText("Menu item created.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pesto Pasta" })).toBeVisible();

  await page.getByLabel("Selling price").fill("18");
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Updated after tasting.");
  await page.getByRole("button", { name: "Save menu item" }).click();
  await expect(page.getByText("Menu item updated.")).toBeVisible();

  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("Menu item deactivated.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Pesto Pasta" }).click();
  await expect(page.getByLabel("Selling price")).toHaveValue("18");
  await expect(page.getByLabel("Active")).toHaveValue("false");
});
