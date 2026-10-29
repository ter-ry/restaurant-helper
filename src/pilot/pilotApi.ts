import { demoReadOnly, pilotApiBaseUrl } from "./pilotConfig";
import { clearPilotDataCache, getPilotCached } from "./pilotDataCache";
import {
  beginSquareConnection,
  disconnectSquare,
  fetchSquareStatus,
  fetchSquareCatalogMappings,
  previewSquareMenuImport,
  importSquareMenu,
  syncSquareCatalog,
  syncSquareLocations,
  syncSquareOrders,
  updateSquareCatalogMapping,
  updateSquareLocationMapping,
  type SquareCatalogMappingSummary,
  type SquareCatalogObjectSummary,
  type SquareConnectionSummary,
  type SquareDailySalesSummary,
  type SquareLocationSummary,
  type SquareOrderSummary,
  type SquareSyncJobSummary,
  type SquareWebhookEventSummary,
} from "../lib/squareIntegration";

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
  lifecycleStatus?: string;
  setupStatus?: string;
  subscriptionStatus?: string;
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
  enabledModuleKeys: string[];
  membershipRole?: "owner" | "manager" | string;
}

export interface PilotOrganizationMembershipSummary {
  membership: {
    id: number;
    organizationId: number;
    role: string;
    createdAt: string | null;
  };
  organization: PilotOrganization;
  membershipRole: "owner" | "manager" | string;
  selected: boolean;
}

export interface PilotAuthMeResponse {
  user: PilotUser;
  membershipRole: "owner" | "manager" | string | null;
  currentOrganizationId: number | null;
  currentLocationId: number | null;
  enabledModuleKeys: string[];
  organizations?: PilotOrganizationMembershipSummary[];
  csrfToken: string;
}

export interface PilotLoginResponse {
  user: PilotUser;
  membershipRole: "owner" | "manager" | string | null;
  currentOrganization: PilotOrganization | null;
  currentLocationId: number | null;
  enabledModuleKeys: string[];
  organizations?: PilotOrganizationMembershipSummary[];
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

async function requestJsonUncached<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  if (demoReadOnly && method !== "GET" && method !== "HEAD" && !path.startsWith("/api/auth/")) {
    throw new PilotApiError("Demo mode is read-only; changes are disabled.", 403);
  }
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

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const cacheable = method === "GET" && (path.startsWith("/api/pilot/") || path.startsWith("/api/organizations") || path.startsWith("/api/locations"));
  if (cacheable) return getPilotCached(path, () => requestJsonUncached<T>(path, init));
  const response = await requestJsonUncached<T>(path, init);
  if (method !== "GET" && method !== "HEAD") clearPilotDataCache();
  return response;
}

/** Warm only the two most likely operational destinations during browser idle time. */
export function prefetchPilotData(paths: string[]) {
  for (const path of paths.slice(0, 2)) {
    void requestJson(path).catch(() => undefined);
  }
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

export async function loginToDemo() {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<PilotLoginResponse>("/api/auth/demo-login", {
    method: "POST",
    headers: { "X-CSRFToken": csrfToken },
  });
}

export async function logoutOfPilot(existingCsrfToken?: string | null) {
  const csrfToken = existingCsrfToken || await getPilotCsrfToken();
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

export async function fetchPilotOrganizations() {
  return requestJson<{ organizations: PilotOrganizationMembershipSummary[]; currentOrganizationId: number | null; currentMembershipId: number | null }>("/api/organizations");
}

export async function selectPilotOrganization(organizationId: number) {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<PilotOrganizationBundle>("/api/organizations/select", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ organizationId }),
  });
}

export async function switchPilotLocation(locationId: number) {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<{ currentLocation: PilotLocation }>("/api/locations/select", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },
    body: JSON.stringify({ locationId }),
  });
}

export async function updatePilotLocation(locationId: number, payload: Pick<PilotLocation, "name" | "addressLine1" | "addressLine2" | "city" | "region" | "postalCode" | "country" | "timezone">) {
  const csrfToken = await getPilotCsrfToken();
  return requestJson<{ location: PilotLocation }>(`/api/pilot/locations/${locationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken },
    body: JSON.stringify(payload),
  });
}

export interface PilotSupplier {
  id: number;
  organizationId: number;
  name: string;
  normalizedName: string;
  categoryFocus: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  orderingNotes: string;
  notes: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotSupplierRecentInvoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  totalAmount: number;
}

export interface PilotSupplierRecentMapping {
  id: number;
  supplierItemName: string;
  inventoryItemName: string;
  purchaseUnit: string;
  inventoryUnit: string;
  conversionFactor: number;
  lastSeenAt: string | null;
}

export interface PilotSupplierSummary extends PilotSupplier {
  inventoryItemCount: number;
  purchaseInvoiceCount: number;
  supplierItemMappingCount: number;
  latestInvoiceDate: string | null;
  historicalReferenceCount: number;
  recentInvoices: PilotSupplierRecentInvoice[];
  recentMappings: PilotSupplierRecentMapping[];
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
  averageUnitCost?: number;
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

export interface PilotInventoryItemDetail {
  item: PilotInventoryItem;
  purchaseHistory: PilotInvoiceLine[];
  movementHistory: PilotInventoryMovement[];
  supplierMappings: PilotSupplierItemMapping[];
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
  normalizedQuantity?: number;
  normalizedUnitCost?: number;
  reviewState?: "ready" | "review" | "blocked";
}

export interface PilotPurchaseReviewSummary {
  state: "READY" | "REVIEW" | "BLOCKING" | string;
  blockers: string[];
  warnings: string[];
  readyToReceive: boolean;
  mappedLineCount: number;
  lineCount: number;
  autoResolvedCount?: number;
  items?: Array<{ code: string; severity: "review" | "blocking"; lineId?: number; message: string }>;
  reconciliation?: {
    lineSubtotal: number;
    invoiceSubtotal: number;
    subtotalDifference: number;
    subtotalPlusTax: number;
    invoiceTotal: number;
    totalDifference: number;
    status: "matched" | "mismatch" | string;
  };
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
  reviewSummary?: PilotPurchaseReviewSummary;
}

export interface PilotPurchasePreview {
  invoiceId: number;
  reviewSummary: PilotPurchaseReviewSummary;
  mutatesInventory: boolean;
  lines: Array<{
    lineId: number;
    description: string;
    inventoryItemId: number | null;
    inventoryItemName: string | null;
    unit: string;
    quantityDelta: number;
    currentOnHand: number | null;
    afterOnHand: number | null;
    averageUnitCostBefore: number | null;
    averageUnitCostAfter: number | null;
    receiptUnitCost: number | null;
    priceChangePercent: number | null;
  }>;
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

export interface PilotInventoryWasteEvent {
  id: number;
  organizationId: number;
  locationId: number;
  inventoryItemId: number;
  inventoryItemName: string;
  inventoryMovementId: number;
  quantity: number;
  unit: string;
  reason: string;
  occurredAt: string | null;
  note: string;
  unitCost: number | null;
  totalCost: number | null;
  createdByUserId: number | null;
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
  latestPurchasePrice: number | null;
  purchaseUnit?: string;
  conversionFactor?: number;
  suggestedPurchaseQuantity?: number | null;
  estimateStatus?: "complete" | "unknown" | "partial";
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
  estimateStatus?: "complete" | "partial";
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
  pendingDraftDailyCloseSessions: PilotDailyCloseSession[];
  pendingDraftReorderPlans: PilotReorderPlan[];
  supplierSpend: Array<Record<string, unknown>>;
  reorderSuggestions: PilotReorderSuggestion[];
  workflow: Record<string, string>;
  operationalAttention?: {
    reorder: { count: number; severity: string };
    square: { syncErrorCount: number; unmappedVariationCount: number; severity: string };
    dailyClose: { count: number; severity: string };
  };
  insights?: PilotDashboardInsights;
}

export interface PilotDashboardInsights {
  today: { totalCollected: number; orderCount: number; topMenuItem: Record<string, unknown> | null };
  week: { totalCollected: number; salesChange: Record<string, unknown> | null; purchaseSpendChange: Record<string, unknown> | null };
  estimatedFoodCost: { estimatedFoodCostPercent: number | null; costCoveragePercent: number; costReadySalesAmount: number; totalMappedMenuSalesAmount: number };
  exceptions: Array<Record<string, unknown>>;
}

export interface PilotReportResponse {
  scope: Record<string, unknown>;
  period: Record<string, unknown>;
  sales: {
    grossItemSales: number;
    totalCollected: number;
    orderCount: number;
    unitsSold: number | null;
    byMenuItem: Array<Record<string, any>>;
    unmappedLines: Array<Record<string, any>>;
  };
  purchasing: Record<string, unknown>;
  inventory: Record<string, unknown>;
  costing: { estimatedFoodCostPercent: number | null; costCoveragePercent: number; costReadySalesAmount: number; totalMappedMenuSalesAmount: number };
  variance: Record<string, unknown>;
  usageVariance: { valid: boolean; rows: Array<Record<string, any>> };
  changes: { sales?: Record<string, any> | null; orders?: Record<string, any> | null; purchaseSpend?: Record<string, any> | null; menuMovers: Array<Record<string, any>> };
  exceptions: Array<Record<string, unknown>>;
  generatedAt: string;
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
      estimateStatus?: "complete" | "partial";
    }>;
  };
  summary: Record<string, number>;
}

export interface PilotMenuCostingRecipeIngredient {
  id: number;
  organizationId: number;
  recipeId: number;
  inventoryItemId: number;
  quantityRequired: number;
  unit: string;
  notes: string;
  sortOrder: number;
  inventoryItem: PilotInventoryItem | null;
  inventoryItemCostPerStockUnit: number | null;
  costBasis?: "weighted_average" | "latest_purchase" | null;
  lineCost: number | null;
  warnings: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotMenuCostingRecipe {
  id: number;
  organizationId: number;
  locationId: number;
  name: string;
  normalizedName: string;
  description: string;
  yieldQuantity: number;
  yieldUnit: string;
  active: boolean;
  notes: string;
  ingredientCount: number;
  ingredients: PilotMenuCostingRecipeIngredient[];
  totalCost: number | null;
  costPerYield: number | null;
  costAvailable: boolean;
  warnings: string[];
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotMenuCostingMenuItem {
  id: number;
  organizationId: number;
  locationId: number;
  recipeId: number | null;
  name: string;
  normalizedName: string;
  category: string;
  sellingPrice: number;
  active: boolean;
  notes: string;
  recipe: PilotMenuCostingRecipe | null;
  recipeCostPerYield: number | null;
  grossProfit: number | null;
  foodCostPercent: number | null;
  grossMarginPercent: number | null;
  costAvailable: boolean;
  warnings: string[];
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PilotMenuCostingResponse {
  organizationId: number;
  locationId: number;
  recipes: PilotMenuCostingRecipe[];
  menuItems: PilotMenuCostingMenuItem[];
}

export interface PilotReorderPlansResponse {
  plans: PilotReorderPlan[];
  activeDraftPlanId: number | null;
}

export interface PilotDailyCloseSession {
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
  currentSnapshot?: PilotDailyCloseSnapshot;
}

export interface PilotDailyCloseSnapshot {
  healthStatus: string;
  inventoryValue: number;
  sales: Record<string, unknown>;
  usage: {
    period: { startAt: string; endAt: string } | null;
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
  variance: {
    quantity: number | null;
    percent: number | null;
    value: number;
  };
  cashReconciliation?: CashReconciliation;
  manualReconciliation?: { countedCash?: number };
  attentionItems?: Array<{ type: string; title: string; severity: string; href?: string; detail?: string }>;
  reconciliation?: {
    recordedWasteQuantity?: number;
    recordedWasteCost?: number;
    otherAdjustmentQuantity?: number;
  };
  square: Record<string, unknown>;
  readyToFinalize: boolean;
}

export interface CashReconciliation {
  status: "available" | "unavailable" | string;
  mode: "drawer_shift" | "payments" | null | string;
  basis?: "square_expected_cash" | "calculated_drawer_cash" | "cash_payments" | string;
  expectedCash: number | null;
  expectedCashTakings?: number | null;
  reconciledExpectedCash?: number | null;
  countedCash?: number | null;
  overShort?: number | null;
  openingFloat: number | null;
  cashPayments: number | null;
  cashRefunds: number | null;
  paidIn: number | null;
  paidOut: number | null;
  closedCash: number | null;
  shiftCount?: number;
  openShiftCount?: number;
  closedShiftCount?: number;
  reconciledShiftCount?: number;
  unreconciledShiftCount?: number;
  paymentCount?: number;
  reason?: string;
  reconnectRequired?: boolean;
  possibleMatches?: Array<{
    type: string;
    amount: number;
    createdAt?: string | null;
    description?: string;
    differenceFromVariance?: number;
    shiftId?: string;
  }>;
  shifts?: Array<{ id?: string; state?: string; openedAt?: string; closedAt?: string; expectedCash?: number | null; closedCash?: number | null }>;
}

export interface PilotDailyCloseResponse {
  session: PilotDailyCloseSession | null;
  snapshot: PilotDailyCloseSnapshot;
  usage: PilotDailyCloseSnapshot["usage"];
  exceptions: string[];
  history: PilotDailyCloseSession[];
  location: { id: number; name: string; timezone: string };
  businessDate: string;
  square: Record<string, unknown>;
}

export type PilotSquareConnectionSummary = SquareConnectionSummary;
export type PilotSquareLocationSummary = SquareLocationSummary;
export type PilotSquareCatalogObjectSummary = SquareCatalogObjectSummary;
export type PilotSquareDailySalesSummary = SquareDailySalesSummary;
export type PilotSquareOrderSummary = SquareOrderSummary;
export type PilotSquareSyncJobSummary = SquareSyncJobSummary;
export type PilotSquareWebhookEventSummary = SquareWebhookEventSummary;
export type PilotSquareCatalogMappingSummary = SquareCatalogMappingSummary;

export type PilotCloverConnectionSummary = {
  id?: number;
  organizationId?: number;
  environment: string;
  region: string;
  merchantId?: string;
  merchantName?: string;
  status: "disconnected" | "connected" | "reauthorization_required";
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  lastConnectionCheckAt?: string | null;
  reconnectRequired?: boolean;
  error?: string | null;
};

export type PilotCloverCatalogItem = {
  id: string;
  name: string;
  priceCents: number | null;
  active: boolean;
  deleted: boolean;
  hidden: boolean;
  available: boolean | null;
  itemGroupId: string | null;
  optionIds: string[];
  categories: Array<{ id: string; name: string; active: boolean }>;
  modifierGroups: Array<{ id: string; name: string; active: boolean; modifiers: Array<{ id: string; name: string; priceCents: number | null; active: boolean }> }>;
};

export type PilotCloverCatalogPreview = {
  readOnly: true;
  merchantName: string;
  location: { id: string; name: string } | null;
  itemCount: number;
  items: PilotCloverCatalogItem[];
};

export async function fetchPilotCloverStatus(organizationId: number) {
  return requestJson<{ enabled: boolean; catalogEnabled?: boolean; mappingEnabled?: boolean; connection: PilotCloverConnectionSummary | null }>(`/api/integrations/clover/status?organizationId=${organizationId}`);
}

export async function fetchPilotCloverCatalog(organizationId: number) {
  return requestJson<PilotCloverCatalogPreview>(`/api/integrations/clover/catalog?organizationId=${organizationId}`);
}


export type PilotCloverShadowOrderLine = {
  id: number;
  cloverLineItemId: string;
  cloverItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  mappingStatus: "mapped" | "unmapped" | "missing_recipe";
  recipePreview: { recipeId?: number; recipeName?: string; ingredients?: Array<{ inventoryItemId: number; name: string; quantity: string; unit: string }> };
  modifiers: Array<Record<string, unknown>>;
};
export type PilotCloverShadowOrder = {
  id: number;
  cloverOrderId: string;
  providerStatus: string;
  status: "paid" | "pending" | "cancelled" | "refunded" | "review";
  paymentStatus: string;
  potentiallyEligible: boolean;
  requiresReview: boolean;
  createdAt: string | null;
  modifiedAt: string | null;
  closedAt: string | null;
  totalCents: number | null;
  currency: string;
  lines: PilotCloverShadowOrderLine[];
};
export async function fetchPilotCloverShadowOrders(organizationId: number, locationId: number, options: { startDate?: string; endDate?: string } = {}) {
  return requestCsrfJson<{ readOnly: true; previewOnly: true; count: number; orders: PilotCloverShadowOrder[] }>("/api/integrations/clover/shadow-orders/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, locationId, ...options }),
  });
}


export interface PilotCloverLocationMapping { id: number; organizationId: number; restaurantLocationId: number; cloverMerchantId: string; cloverLocationId: string | null; confirmedAt: string | null; }
export interface PilotCloverMenuMapping { id: number; organizationId: number; restaurantLocationId: number; cloverMerchantId: string; cloverItemId: string; cloverItemGroupId: string | null; cloverOptionIds: string[]; cloverModifierGroupIds: string[]; flowtallyMenuItemId: number; flowtallyMenuItemName: string | null; hasRecipe: boolean; status: string; }
export async function fetchPilotCloverMappings(organizationId: number, locationId: number) { return requestJson<{ enabled: boolean; locationMapping: PilotCloverLocationMapping | null; menuMappings: PilotCloverMenuMapping[] }>(`/api/integrations/clover/mappings?organizationId=${organizationId}&locationId=${locationId}`); }
export async function savePilotCloverLocationMapping(organizationId: number, locationId: number, cloverLocationId: string | null) { return requestCsrfJson<{ locationMapping: PilotCloverLocationMapping }>("/api/integrations/clover/location-mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, locationId, cloverLocationId, confirm: true }) }); }
export async function deletePilotCloverLocationMapping(organizationId: number, locationId: number) { return requestCsrfJson<{ ok: true }>(`/api/integrations/clover/location-mapping?organizationId=${organizationId}&locationId=${locationId}`, { method: "DELETE" }); }
export async function savePilotCloverMenuMapping(payload: { organizationId: number; locationId: number; cloverItemId: string; flowtallyMenuItemId: number; mappingId?: number }) { const path = payload.mappingId ? `/api/integrations/clover/menu-mappings/${payload.mappingId}` : "/api/integrations/clover/menu-mappings"; return requestCsrfJson<{ mapping: PilotCloverMenuMapping }>(path, { method: payload.mappingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, confirm: true }) }); }
export async function deletePilotCloverMenuMapping(organizationId: number, mappingId: number) { return requestCsrfJson<{ ok: true }>(`/api/integrations/clover/menu-mappings/${mappingId}?organizationId=${organizationId}`, { method: "DELETE" }); }

export async function beginPilotCloverConnection(organizationId: number) {
  window.location.assign(`${pilotApiBaseUrl}/api/integrations/clover/start?organizationId=${organizationId}`);
}

export async function resumePilotCloverLaunch(organizationId: number) {
  window.location.assign(`${pilotApiBaseUrl}/api/integrations/clover/launch/resume?organizationId=${organizationId}`);
}

export async function disconnectPilotClover(organizationId: number) {
  return requestCsrfJson<{ connection: PilotCloverConnectionSummary; remoteRevocation: string }>("/api/integrations/clover/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
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

export async function fetchPilotReport(
  view: "daily" | "weekly",
  selection?: string | { startDate?: string; endDate?: string },
) {
  const params = new URLSearchParams({ view });
  if (typeof selection === "string" && selection) params.set("date", selection);
  if (typeof selection === "object" && selection) {
    if (selection.startDate) params.set("startDate", selection.startDate);
    if (selection.endDate) params.set("endDate", selection.endDate);
  }
  return requestJson<PilotReportResponse>(`/api/pilot/reports?${params.toString()}`);
}

export type PilotAttentionResponse = {
  reorder: { count: number };
};

export async function fetchPilotAttention() {
  return requestJson<PilotAttentionResponse>("/api/pilot/attention");
}

export async function fetchPilotDailyClose(locationId?: number | null, businessDate?: string | null) {
  const params = new URLSearchParams();
  if (locationId != null) {
    params.set("locationId", String(locationId));
  }
  if (businessDate) {
    params.set("businessDate", businessDate);
  }
  const query = params.toString();
  return requestJson<PilotDailyCloseResponse>(`/api/pilot/daily-close${query ? `?${query}` : ""}`);
}

export async function openPilotDailyClose(payload: { locationId: number; businessDate?: string }) {
  return requestCsrfJson<PilotDailyCloseResponse>("/api/pilot/daily-close", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotDailyClose(sessionId: number, payload: { notes: string; reconciliation?: { countedCash: number | null } }) {
  return requestCsrfJson<PilotDailyCloseResponse>(`/api/pilot/daily-close/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function finalizePilotDailyClose(sessionId: number) {
  return requestCsrfJson<PilotDailyCloseResponse>(`/api/pilot/daily-close/${sessionId}/finalize`, {
    method: "POST",
  });
}

export async function syncPilotDailyCloseSales(sessionId: number, payload: { businessDate?: string }) {
  return requestCsrfJson<PilotDailyCloseResponse>(`/api/pilot/daily-close/${sessionId}/sync-sales`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchPilotSquareStatus(organizationId: number) {
  return fetchSquareStatus(organizationId);
}

export async function fetchPilotSquareCatalogMappings(organizationId: number, locationId?: number | null) {
  return fetchSquareCatalogMappings({ organizationId, locationId });
}

export async function previewPilotSquareMenuImport(organizationId: number, locationId: number) {
  return previewSquareMenuImport(organizationId, locationId);
}

export async function importPilotSquareMenu(organizationId: number, locationId: number) {
  return importSquareMenu(organizationId, locationId);
}

export async function beginPilotSquareConnection(organizationId: number) {
  return beginSquareConnection(organizationId);
}

export async function disconnectPilotSquare(organizationId: number) {
  return disconnectSquare(organizationId);
}

export async function syncPilotSquareLocations(organizationId: number) {
  return syncSquareLocations(organizationId);
}

export async function syncPilotSquareCatalog(organizationId: number) {
  return syncSquareCatalog(organizationId);
}

export async function syncPilotSquareOrders(payload: { organizationId: number; startAt: string; endAt: string; locationIds?: string[] }) {
  return syncSquareOrders(payload);
}

export async function updatePilotSquareLocationMapping(payload: { organizationId: number; squareLocationId: number; restaurantLocationId: number }) {
  return updateSquareLocationMapping(payload);
}

export async function updatePilotSquareCatalogMapping(payload: {
  organizationId: number;
  squareCatalogObjectId: number;
  mappingType?: string;
  flowtallyEntityType?: string;
  flowtallyEntityId?: string;
  status?: string;
}) {
  return updateSquareCatalogMapping(payload);
}

export async function fetchPilotPurchases() {
  return requestJson<PilotPurchasesResponse>("/api/pilot/purchases");
}

export interface PilotInvoiceOcrField {
  value: string | number | null;
  confidence: number;
  needsReview: boolean;
  evidence?: string;
}

export interface PilotInvoiceOcrLine {
  itemName: string;
  originalDescription?: string;
  packaging?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  confidence: number;
  needsReview: boolean;
  rawSourceLine?: string;
  calculatedLineTotal?: number;
  lineTotalDifference?: number;
}

export interface PilotInvoiceOcrResponse {
  provider: string;
  fileName: string;
  contentType: string;
  rawText: string;
  fields: {
    supplier: PilotInvoiceOcrField;
    invoiceDate: PilotInvoiceOcrField;
    invoiceNumber: PilotInvoiceOcrField;
    subtotal: PilotInvoiceOcrField;
    tax: PilotInvoiceOcrField;
    total: PilotInvoiceOcrField;
  };
  lineItems: PilotInvoiceOcrLine[];
  warnings: string[];
  overallConfidence: number;
  needsReview: boolean;
}

export async function uploadPilotInvoiceOcr(file: File) {
  const csrfToken = await getPilotCsrfToken();
  const body = new FormData();
  body.append("file", file);
  return requestJson<PilotInvoiceOcrResponse>("/api/pilot/purchases/ocr", {
    method: "POST",
    headers: { "X-CSRFToken": csrfToken },
    body,
  });
}

export async function fetchPilotPurchaseInvoice(invoiceId: number) {
  return requestJson<PilotPurchaseInvoice>(`/api/pilot/purchases/invoices/${invoiceId}`);
}

export async function fetchPilotPurchasePreview(invoiceId: number) {
  return requestJson<PilotPurchasePreview>(`/api/pilot/purchases/invoices/${invoiceId}/preview`);
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

export async function correctPilotPurchaseInvoice(invoiceId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotPurchaseInvoice>(`/api/pilot/purchases/invoices/${invoiceId}/correct`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchPilotInventory() {
  return requestJson<PilotInventoryResponse>("/api/pilot/inventory");
}

export async function fetchPilotInventoryItem(itemId: number) {
  return requestJson<PilotInventoryItemDetail>(`/api/pilot/inventory/items/${itemId}`);
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

export async function fetchPilotInventoryWasteEvents() {
  return requestJson<{ wasteEvents: PilotInventoryWasteEvent[] }>("/api/pilot/inventory/waste-events");
}

export async function createPilotInventoryWasteEvent(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotInventoryWasteEvent>("/api/pilot/inventory/waste-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  return requestJson<{ suggestions: PilotReorderSuggestion[]; groupedBySupplier: PilotInventoryResponse["reorderPlan"]["groupedBySupplier"]; inventoryItems?: PilotInventoryItem[]; activeInventoryItemCount?: number; refreshedAt?: string }>("/api/pilot/reorder-plan");
}

export async function markPilotReorderOrdered(itemId: number) {
  return requestCsrfJson<Record<string, unknown>>(`/api/pilot/reorder-plan/${itemId}/ordered`, {
    method: "POST",
  });
}

export async function fetchPilotReorderPlans() {
  return requestJson<PilotReorderPlansResponse>("/api/pilot/reorder-plans");
}

export async function fetchPilotMenuCosting(locationId?: number) {
  const query = locationId != null ? `?locationId=${locationId}` : "";
  return requestJson<PilotMenuCostingResponse>(`/api/pilot/menu-costing${query}`);
}

export async function createPilotMenuCostingRecipe(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotMenuCostingRecipe>("/api/pilot/menu-costing/recipes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotMenuCostingRecipe(recipeId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotMenuCostingRecipe>(`/api/pilot/menu-costing/recipes/${recipeId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function deletePilotMenuCostingRecipe(recipeId: number) {
  return requestCsrfJson<{ ok: true }>(`/api/pilot/menu-costing/recipes/${recipeId}`, {
    method: "DELETE",
  });
}

export async function createPilotMenuCostingRecipeIngredient(recipeId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotMenuCostingRecipe>(`/api/pilot/menu-costing/recipes/${recipeId}/ingredients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotMenuCostingRecipeIngredient(recipeId: number, ingredientId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotMenuCostingRecipe>(`/api/pilot/menu-costing/recipes/${recipeId}/ingredients/${ingredientId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function deletePilotMenuCostingRecipeIngredient(recipeId: number, ingredientId: number) {
  return requestCsrfJson<PilotMenuCostingRecipe>(`/api/pilot/menu-costing/recipes/${recipeId}/ingredients/${ingredientId}`, {
    method: "DELETE",
  });
}

export async function createPilotMenuCostingMenuItem(payload: Record<string, unknown>) {
  return requestCsrfJson<PilotMenuCostingMenuItem>("/api/pilot/menu-costing/menu-items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function updatePilotMenuCostingMenuItem(menuItemId: number, payload: Record<string, unknown>) {
  return requestCsrfJson<PilotMenuCostingMenuItem>(`/api/pilot/menu-costing/menu-items/${menuItemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function deletePilotMenuCostingMenuItem(menuItemId: number) {
  return requestCsrfJson<{ ok: true }>(`/api/pilot/menu-costing/menu-items/${menuItemId}`, {
    method: "DELETE",
  });
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
