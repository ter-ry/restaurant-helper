import { pilotApiBaseUrl } from "./pilotConfig";

export interface PilotUser {
  id: number;
  email: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotOrganization {
  id: number;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotLocation {
  id: number;
  organizationId: number;
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  timezone: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotOrganizationBundle {
  organization: PilotOrganization;
  restaurantLocations: PilotLocation[];
  currentLocation: PilotLocation | null;
  membershipRole?: "owner" | "manager" | string;
}

export interface PilotAuthMeResponse {
  user: PilotUser;
  membershipRole: "owner" | "manager" | string | null;
  currentOrganizationId: number | null;
  currentLocationId: number | null;
  csrfToken: string;
}

export interface PilotLoginResponse {
  user: PilotUser;
  membershipRole: "owner" | "manager" | string | null;
  currentOrganization: PilotOrganization | null;
  currentLocationId: number | null;
  csrfToken: string;
}

export interface PilotApiErrorPayload {
  error: string;
  errors?: Record<string, string>;
}

export class PilotApiError extends Error {
  status: number;
  errors?: Record<string, string>;

  constructor(message: string, status: number, errors?: Record<string, string>) {
    super(message);
    this.name = "PilotApiError";
    this.status = status;
    this.errors = errors;
  }
}

function buildUrl(path: string) {
  return new URL(path, `${pilotApiBaseUrl}/`).toString();
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
  const payload = await readJsonResponse<PilotApiErrorPayload>(response);

  if (!response.ok) {
    throw new PilotApiError(payload?.error || `Request failed with status ${response.status}`, response.status, payload?.errors);
  }

  return payload as T;
}

export async function getPilotCsrfToken() {
  const payload = await requestJson<{ csrfToken: string }>("/api/auth/csrf");
  return payload.csrfToken;
}

export async function fetchPilotSession() {
  return requestJson<PilotAuthMeResponse>("/api/auth/me");
}

export async function loginToPilot(email: string, password: string) {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<PilotLoginResponse>("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutOfPilot() {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function fetchCurrentOrganization() {
  return requestJson<PilotOrganizationBundle>("/api/organizations/current");
}

export async function switchPilotLocation(locationId: number) {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<{ currentLocation: PilotLocation }>("/api/locations/current", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ locationId }),
  });
}

export interface PilotSupplier {
  id: number;
  organizationId: number;
  name: string;
  normalizedName: string;
  categoryFocus: string;
  notes: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotSupplierSummary extends PilotSupplier {
  inventoryItemCount: number;
  purchaseInvoiceCount: number;
  latestInvoiceDate: string | null;
}

export interface PilotInventoryItem {
  id: number;
  organizationId: number;
  locationId: number;
  supplierId: number | null;
  name: string;
  normalizedName: string;
  category: string;
  stockUnit: string;
  currentOnHand: number;
  minQuantity: number;
  parLevel: number;
  preferredSupplierName: string;
  latestPurchasePrice: number;
  lastPurchaseUnit: string;
  lastPurchaseConversionFactor: number;
  lastReceivedAt: string | null;
  lastCountedAt: string | null;
  averageDailyUsage: number | null;
  estimatedCostMethod: string;
  active: boolean;
  notes: string;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotSupplierItemMapping {
  id: number;
  organizationId: number;
  supplierId: number;
  inventoryItemId: number;
  supplierItemName: string;
  normalizedSupplierItemName: string;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotInvoiceLine {
  id: number;
  invoiceId: number;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  inventoryItemId: number | null;
  supplierItemMappingId: number | null;
  lineIndex: number;
  description: string;
  normalizedDescription: string;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  confidence: number;
  needsReview: boolean;
  previousUnitPrice: number | null;
  priceChangePercent: number | null;
  note: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotPurchaseInvoice {
  id: number;
  organizationId: number;
  locationId: number;
  supplierId: number;
  supplier: PilotSupplier | null;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  notes: string;
  status: string;
  sourceFileName: string;
  sourceFileType: string;
  sourceFileKey: string;
  extractedText: string;
  extractionStatus: string;
  receivedAt: string | null;
  receivedByUserId: number | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  postedAt: string | null;
  lineItems: PilotInvoiceLine[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotInventoryMovement {
  id: number;
  organizationId: number;
  locationId: number;
  inventoryItemId: number;
  inventoryItemName: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unit: string;
  sourceType: string;
  sourceRecordId: string;
  sourceLineId: string;
  reason: string;
  actorUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotCountSessionLine {
  id: number;
  sessionId: number;
  inventoryItemId: number;
  lineIndex: number;
  itemNameSnapshot: string;
  stockUnitSnapshot: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  resultingQuantity: number | null;
  note: string;
  status: string;
  movementCountSinceStart: number;
  hasMovementSinceStart: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotCountSession {
  id: number;
  organizationId: number;
  locationId: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  countedBy: string;
  notes: string;
  itemCount: number;
  countedLineCount: number;
  uncountedLineCount: number;
  varianceTotal: number;
  movementCountSinceStart: number;
  hasMovementSinceStart: boolean;
  createdByUserId: number | null;
  finalizedByUserId: number | null;
  lines: PilotCountSessionLine[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotReorderSuggestion {
  id: number;
  inventoryItemId: number;
  inventoryItemName: string;
  category: string;
  supplier: string;
  currentQuantity: number;
  unit: string;
  minimumQuantity: number;
  parLevel: number;
  suggestedQuantity: number;
  adjustedQuantity: number;
  latestPurchasePrice: number;
  estimatedCost: number | null;
  stockStatus: string;
  status: string;
  daysRemaining: number | null;
}

export interface PilotReorderPlanLine {
  id: number;
  planId: number;
  inventoryItemId: number;
  supplierId: number | null;
  lineIndex: number;
  inventoryItemName: string;
  supplierName: string;
  category: string;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
  currentOnHand: number;
  minimumQuantity: number;
  parLevel: number;
  suggestedQuantity: number;
  orderQuantity: number;
  excluded: boolean;
  estimatedUnitCost: number | null;
  estimatedLineCost: number | null;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotReorderPlan {
  id: number;
  organizationId: number;
  locationId: number;
  name: string;
  status: string;
  notes: string;
  createdByUserId: number | null;
  preparedByUserId: number | null;
  completedByUserId: number | null;
  preparedAt: string | null;
  completedAt: string | null;
  lineCount: number;
  supplierCount: number;
  estimatedCost: number;
  includedCost: number;
  excludedCount: number;
  lines: PilotReorderPlanLine[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotDashboardResponse {
  summary: Record<string, number>;
  recentInvoices: PilotPurchaseInvoice[];
  recentMovements: PilotInventoryMovement[];
  recentPriceChanges: Array<Record<string, unknown>>;
  pendingDraftInvoices: PilotPurchaseInvoice[];
  pendingDraftCountSessions: PilotCountSession[];
  pendingDraftReorderPlans: PilotReorderPlan[];
  supplierSpend: Array<Record<string, unknown>>;
  reorderSuggestions: PilotReorderSuggestion[];
  workflow: Record<string, string>;
}

export interface PilotPurchasesResponse {
  invoices: PilotPurchaseInvoice[];
  suppliers: PilotSupplier[];
  purchaseLines: PilotInvoiceLine[];
  priceChanges: Array<Record<string, unknown>>;
  summary: Record<string, number>;
  exportReadiness: {
    readyForCsv: number;
    needsReview: number;
    needsMapping: number;
    quickBooksFutureOnly: boolean;
  };
}

export interface PilotInventoryResponse {
  items: PilotInventoryItem[];
  movements: PilotInventoryMovement[];
  countSessions: PilotCountSession[];
  suppliers?: PilotSupplierSummary[];
  reorderPlan: {
    suggestions: PilotReorderSuggestion[];
    groupedBySupplier: Array<{
      supplier: string;
      lines: PilotReorderSuggestion[];
      itemCount: number;
      estimatedOrderTotal: number;
    }>;
  };
  summary: Record<string, number>;
}

export interface PilotReorderPlansResponse {
  plans: PilotReorderPlan[];
  activeDraftPlanId: number | null;
}

async function requestCsrfJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<T>(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-CSRFToken": csrfToken,
    },
  });
}

export async function fetchPilotDashboard() {
  return requestJson<PilotDashboardResponse>("/api/pilot/dashboard");
}

export async function fetchPilotPurchases() {
  return requestJson<PilotPurchasesResponse>("/api/pilot/purchases");
}

export async function fetchPilotPurchaseInvoice(invoiceId: number) {
  return requestJson<PilotPurchaseInvoice>(`/api/pilot/purchases/invoices/${invoiceId}`);
}

export async function createPilotPurchaseInvoice(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotPurchaseInvoice>("/api/pilot/purchases/invoices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotPurchaseInvoice(invoiceId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotPurchaseInvoice>(`/api/pilot/purchases/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function receivePilotPurchaseInvoice(invoiceId: number) {
  return requestCsrfJson<PilotPurchaseInvoice>(`/api/pilot/purchases/invoices/${invoiceId}/receive`, {
    method: "POST",
  });
}

export async function fetchPilotInventory() {
  return requestJson<PilotInventoryResponse>("/api/pilot/inventory");
}

export async function fetchPilotSuppliers() {
  return requestJson<{ suppliers: PilotSupplierSummary[] }>("/api/pilot/suppliers");
}

export async function createPilotSupplier(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotSupplierSummary>("/api/pilot/suppliers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotSupplier(supplierId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotSupplierSummary>(`/api/pilot/suppliers/${supplierId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function createPilotInventoryItem(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotInventoryItem>("/api/pilot/inventory/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotInventoryItem(itemId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotInventoryItem>(`/api/pilot/inventory/items/${itemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function createPilotInventoryAdjustment(itemId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotInventoryMovement>(`/api/pilot/inventory/items/${itemId}/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchPilotCountSessions() {
  return requestJson<{ countSessions: PilotCountSession[] }>("/api/pilot/inventory/count-sessions");
}

export async function createPilotCountSession(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotCountSession>("/api/pilot/inventory/count-sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchPilotCountSession(sessionId: number) {
  return requestJson<PilotCountSession>(`/api/pilot/inventory/count-sessions/${sessionId}`);
}

export async function updatePilotCountSession(sessionId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotCountSession>(`/api/pilot/inventory/count-sessions/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function finalizePilotCountSession(sessionId: number, payload: Record<string, unknown> = {}) {
  return requestCsrfJson<PilotCountSession>(`/api/pilot/inventory/count-sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchPilotReorderPlan() {
  return requestJson<{ suggestions: PilotReorderSuggestion[]; groupedBySupplier: PilotInventoryResponse["reorderPlan"]["groupedBySupplier"] }>("/api/pilot/reorder-plan");
}

export async function markPilotReorderOrdered(itemId: number) {
  return requestCsrfJson<Record<string, unknown>>(`/api/pilot/reorder-plan/${itemId}/ordered`, {
    method: "POST",
  });
}

export async function fetchPilotReorderPlans() {
  return requestJson<PilotReorderPlansResponse>("/api/pilot/reorder-plans");
}

export async function createPilotReorderPlan() {
  return requestCsrfJson<PilotReorderPlan>("/api/pilot/reorder-plans", {
    method: "POST",
  });
}

export async function fetchPilotReorderPlanDetail(planId: number) {
  return requestJson<PilotReorderPlan>(`/api/pilot/reorder-plans/${planId}`);
}

export async function updatePilotReorderPlan(planId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotReorderPlan>(`/api/pilot/reorder-plans/${planId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function preparePilotReorderPlan(planId: number) {
  return requestCsrfJson<PilotReorderPlan>(`/api/pilot/reorder-plans/${planId}/prepare`, {
    method: "POST",
  });
}

export async function completePilotReorderPlan(planId: number) {
  return requestCsrfJson<PilotReorderPlan>(`/api/pilot/reorder-plans/${planId}/complete`, {
    method: "POST",
  });
}
