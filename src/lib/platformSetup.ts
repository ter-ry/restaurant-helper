import { buildApiUrl } from "./apiBase";
import { CustomerApiError, getCustomerCsrfToken } from "./customerAuth";

export interface PlatformModuleEntitlement {
  key: string;
  displayName: string;
  description: string;
  backendReady: boolean;
  dependencies: string[];
  status: string;
  configuration: Record<string, unknown>;
  enabledAt: string | null;
  hasOrganizationRow: boolean;
  missingDependencies: string[];
}

export interface PlatformSetupOrganizationSummary {
  organization: {
    id: number;
    name: string;
    lifecycleStatus: string;
    onboardingStatus: string;
    setupStatus: string;
    subscriptionStatus: string;
    setupTemplateKey: string;
    setupFeeStatus: string;
    isProspect: boolean;
    activeAt: string | null;
    setupCompletedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  checklist: {
    ownerCount: number;
    locationCount: number;
    setupFeeStatus: string;
    setupStatus: string;
    subscriptionStatus: string;
    launchBlockers: string[];
    missingModules: string[];
    squareRequired: boolean;
    squareComplete: boolean;
    customerApproved: boolean;
    readyForActivation: boolean;
  };
  locations: Array<Record<string, unknown>>;
  modules: PlatformModuleEntitlement[];
  customerIdentity?: PlatformCustomerIdentity;
}

export interface PlatformCustomerIdentity {
  organizationId: number;
  organizationName: string;
  owner: { userId: number; email: string; role: string; createdAt: string | null } | null;
  locations: Array<Record<string, unknown>>;
  signedUpAt: string | null;
  setupRequestedAt: string | null;
}

export interface PlatformSetupDetail extends PlatformSetupOrganizationSummary {
  memberships: Array<Record<string, unknown>>;
  configuration: Record<string, unknown>;
  auditEvents: Array<Record<string, unknown>>;
  platformRole: string | null;
  customerIdentity?: PlatformCustomerIdentity;
}

export interface PlatformSetupListResponse {
  organizations: PlatformSetupOrganizationSummary[];
}

export interface PlatformSupportGrantSummary {
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
}

export interface PlatformSupportGrantsResponse {
  grants: PlatformSupportGrantSummary[];
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await readJsonResponse<{ error?: string }>(response);
  if (!response.ok) {
    throw new CustomerApiError(payload?.error || `Request failed with status ${response.status}`, response.status);
  }
  return payload as T;
}

export async function fetchSetupOrganizations(search = "", state = "") {
  const query = new URLSearchParams();
  if (search.trim()) {
    query.set("search", search.trim());
  }
  if (state.trim()) {
    query.set("state", state.trim());
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<PlatformSetupListResponse>(`/api/platform/setup/organizations${suffix}`);
}

export async function fetchSetupOrganization(organizationId: number) {
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}`);
}

export async function updateSetupTemplate(organizationId: number, templateKey: string) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/template`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ templateKey }),
  });
}

export async function updateSetupState(organizationId: number, payload: Record<string, string>) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function updateModuleEntitlements(organizationId: number, modules: Array<{ moduleKey: string; status: string }>) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/modules`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ modules }),
  });
}

export async function updateLocations(organizationId: number, locations: Array<Record<string, unknown>>) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/locations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ locations }),
  });
}

export async function updateDashboardLayout(organizationId: number, payload: { layoutKey: string; locationId?: number | null; widgets: string[] }) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/dashboard-layout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function updateCustomFields(organizationId: number, fields: Record<string, unknown>) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/custom-fields`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ fields }),
  });
}

export async function updateInternalNotes(organizationId: number, notes: string[]) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ notes }),
  });
}

export async function updateLaunchBlockers(organizationId: number, blockers: string[]) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/blockers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ blockers }),
  });
}

export async function updateImports(organizationId: number, imports: Array<Record<string, unknown>>) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/imports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ imports }),
  });
}

export async function updateSquareStatus(organizationId: number, square: Record<string, unknown>) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/square`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ square }),
  });
}

export async function requestCustomerReview(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/review`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function approveCustomerReview(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/review/approve`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function activateSetupOrganization(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<PlatformSetupDetail>(`/api/platform/setup/organizations/${organizationId}/activate`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function fetchSupportGrants(params: { organizationId?: number; supportUserId?: number; status?: string } = {}) {
  const query = new URLSearchParams();
  if (params.organizationId !== undefined) {
    query.set("organizationId", String(params.organizationId));
  }
  if (params.supportUserId !== undefined) {
    query.set("supportUserId", String(params.supportUserId));
  }
  if (params.status) {
    query.set("status", params.status);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<PlatformSupportGrantsResponse>(`/api/platform/support/grants${suffix}`);
}

export async function createSupportGrant(payload: { organizationId: number; supportUserEmail: string; reason: string; caseReference?: string; startsAt?: string; expiresAt?: string }) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ grant: PlatformSupportGrantSummary }>("/api/platform/support/grants", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function revokeSupportGrant(grantId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ grant: PlatformSupportGrantSummary }>(`/api/platform/support/grants/${grantId}/revoke`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}
