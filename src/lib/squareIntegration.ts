import { buildApiUrl } from "./apiBase";
import { CustomerApiError, getCustomerCsrfToken } from "./customerAuth";

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

export interface SquareLocationSummary {
  id: number;
  squareLocationId: string;
  name: string;
  status: string;
  rawPayload: Record<string, unknown>;
  mappings: Array<{
    id: number;
    squareLocationId: number;
    restaurantLocationId: number;
    restaurantLocation: { id: number; name: string; city?: string } | null;
    mappedByUserId: number | null;
    mappedAt: string | null;
  }>;
}

export interface SquareCatalogObjectSummary {
  id: number;
  squareObjectId: string;
  objectType: string;
  version: number;
  isDeleted: boolean;
  rawPayload: Record<string, unknown>;
  mappings: Array<{
    id: number;
    squareCatalogObjectId: number;
    mappingType: string;
    flowtallyEntityType: string;
    flowtallyEntityId: string;
    status: string;
  }>;
}

export interface SquareOrderLineSummary {
  id: number;
  lineUid: string;
  lineIndex: number;
  squareItemVariationId: string;
  name: string;
  quantity: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  netAmount: number;
  rawPayload: Record<string, unknown>;
}

export interface SquareOrderSummary {
  id: number;
  squareOrderId: string;
  squareLocationId: string;
  restaurantLocationId: number | null;
  orderState: string;
  currency: string;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  refundAmount: number;
  netAmount: number;
  itemQuantity: number;
  lineCount: number;
  orderedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  isDeleted: boolean;
  rawPayload: Record<string, unknown>;
  lines: SquareOrderLineSummary[];
}

export interface SquareDailySalesSummary {
  id: number;
  squareLocationId: string;
  restaurantLocationId: number | null;
  saleDate: string;
  currency: string;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  refundAmount: number;
  netAmount: number;
  orderCount: number;
  cancelledOrderCount: number;
  rawPayload: Record<string, unknown>;
}

export interface SquareSyncJobSummary {
  id: number;
  jobType: string;
  status: string;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string;
  cursorJson: Record<string, unknown>;
}

export interface SquareWebhookEventSummary {
  id: number;
  eventId: string;
  eventType: string;
  status: string;
  processedAt: string | null;
  errorMessage: string;
  rawPayload: Record<string, unknown>;
}

export interface SquareConnectionSummary {
  id: number;
  organizationId: number;
  organization: { id: number; name: string } | null;
  environment: string;
  squareMerchantId: string;
  status: string;
  tokenExpiresAt: string | null;
  revokedAt: string | null;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string;
  catalogCount: number;
  orderCount: number;
  locationCount: number;
  dailySalesCount: number;
  locations: SquareLocationSummary[];
  catalogObjects: SquareCatalogObjectSummary[];
  orders: SquareOrderSummary[];
  dailySales: SquareDailySalesSummary[];
  syncJobs: SquareSyncJobSummary[];
  webhookEvents: SquareWebhookEventSummary[];
}

export async function fetchSquareStatus(organizationId: number) {
  return requestJson<{ connection: SquareConnectionSummary | null }>(`/api/integrations/square/status?organizationId=${organizationId}`);
}

export function getSquareConnectionStartUrl(organizationId: number) {
  return buildApiUrl(`/api/integrations/square/start?organizationId=${organizationId}`);
}

export async function beginSquareConnection(organizationId: number) {
  window.location.assign(getSquareConnectionStartUrl(organizationId));
}

export async function disconnectSquare(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ connection: SquareConnectionSummary }>(`/api/integrations/square/disconnect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ organizationId }),
  });
}

export async function syncSquareLocations(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ connection: SquareConnectionSummary; job: SquareSyncJobSummary }>(`/api/integrations/square/locations/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ organizationId }),
  });
}

export async function syncSquareCatalog(organizationId: number) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ connection: SquareConnectionSummary; job: SquareSyncJobSummary }>(`/api/integrations/square/catalog/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ organizationId }),
  });
}

export async function syncSquareOrders(payload: { organizationId: number; startAt: string; endAt: string; locationIds?: string[] }) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ connection: SquareConnectionSummary; job: SquareSyncJobSummary }>(`/api/integrations/square/orders/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function updateSquareLocationMapping(payload: { organizationId: number; squareLocationId: number; restaurantLocationId: number }) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ connection: SquareConnectionSummary }>(`/api/integrations/square/location-mappings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function updateSquareCatalogMapping(payload: {
  organizationId: number;
  squareCatalogObjectId: number;
  mappingType?: string;
  flowtallyEntityType?: string;
  flowtallyEntityId?: string;
  status?: string;
}) {
  const csrfToken = await getCustomerCsrfToken();
  return requestJson<{ connection: SquareConnectionSummary }>(`/api/integrations/square/catalog/mappings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify(payload),
  });
}
