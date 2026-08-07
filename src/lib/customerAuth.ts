export interface CustomerUser {
  id: number;
  email: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CustomerOrganizationSummary {
  id: number;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  lifecycleStatus?: string;
  setupStatus?: string;
  subscriptionStatus?: string;
  setupTemplateKey?: string | null;
  isProspect?: boolean;
}

export interface CustomerOrganizationMembershipSummary {
  organization: CustomerOrganizationSummary;
  membershipRole: string;
  selected: boolean;
}

export interface CustomerSessionResponse {
  user: CustomerUser;
  platformRole?: string | null;
  membershipRole: string | null;
  currentOrganizationId: number | null;
  currentLocationId: number | null;
  supportAccessGrant?: {
    id: number;
    organizationId: number;
    reason: string;
    caseReference: string;
    status: string;
    startsAt: string | null;
    expiresAt: string | null;
  } | null;
  organizations?: CustomerOrganizationMembershipSummary[];
  csrfToken: string;
}

export interface CustomerCreateOrganizationPayload {
  name: string;
  templateKey?: string;
  locationName: string;
  city: string;
  region?: string;
  postalCode?: string;
  country?: string;
  timezone?: string;
  addressLine1?: string;
  addressLine2?: string;
}

export class CustomerApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CustomerApiError";
    this.status = status;
  }
}

function buildUrl(path: string) {
  return buildApiUrl(path);
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
  const response = await fetch(buildUrl(path), {
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

export async function getCustomerCsrfToken() {
  const payload = await requestJson<{ csrfToken: string }>("/api/auth/csrf");
  return payload.csrfToken;
}

export async function fetchCustomerSession() {
  return requestJson<CustomerSessionResponse>("/api/auth/me");
}

export async function createCustomerProspectOrganization(payload: CustomerCreateOrganizationPayload) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ organization: CustomerOrganizationSummary; membershipRole: string; currentLocationId: number }>("/api/onboarding/organizations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function requestCustomerSetup(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ organization: CustomerOrganizationSummary }>(`/api/onboarding/organizations/${organizationId}/request-setup`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function acceptCustomerInvitation(token: string) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ ok: true; accepted: true; organizationId: number; role: string }>(`/api/organization-invitations/${token}/accept`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function logoutCustomer() {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export function startGoogleLogin() {
  window.location.assign("/api/auth/google/start?purpose=login");
}
import { buildApiUrl } from "./apiBase";
