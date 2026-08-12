import { buildApiUrl } from "./apiBase";
import { CustomerApiError, getCustomerCsrfToken } from "./customerAuth";

export interface CustomerInvitation {
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
}

export interface CustomerInvitationListResponse {
  invitations: CustomerInvitation[];
}

export interface CustomerInvitationCreateResponse {
  invitation: CustomerInvitation;
  invitationUrl: string;
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

export async function fetchCustomerInvitations() {
  return requestJson<CustomerInvitationListResponse>("/api/organization-invitations");
}

export async function createCustomerInvitation(email: string, role: string = "manager") {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<CustomerInvitationCreateResponse>("/api/organization-invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ email, role }),
  });
}

export async function cancelCustomerInvitation(invitationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ invitation: CustomerInvitation }>(`/api/organization-invitations/${invitationId}/cancel`, {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}
