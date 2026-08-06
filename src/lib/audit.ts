import { CustomerApiError } from "./customerAuth";

export interface CustomerAuditEvent {
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
}

export interface CustomerAuditResponse {
  events: CustomerAuditEvent[];
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
  const response = await fetch(new URL(path, window.location.origin).toString(), {
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

export async function fetchCustomerAuditEvents() {
  return requestJson<CustomerAuditResponse>("/api/pilot/audit-events");
}
